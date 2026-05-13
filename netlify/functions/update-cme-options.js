// netlify/functions/update-cme-options.js
// Fetch daily ag options from CME's public CmeWS JSON endpoints (free, ~10 min delayed)
// + FRED 10Y, commit JSON to repo

const https = require('https');

// CME product IDs (confirmed from cmegroup.com URL patterns)
// Each commodity has a futures product ID and an options product ID.
const PRODUCTS = [
  { slug:'corn',         label:'Corn',          futId:300, optId:301, exchange:'G', unit:'cents/bu',  tickSize:0.25 },
  { slug:'wheat',        label:'SRW Wheat',     futId:323, optId:324, exchange:'G', unit:'cents/bu',  tickSize:0.25 },
  { slug:'hrw_wheat',    label:'HRW Wheat',     futId:348, optId:349, exchange:'G', unit:'cents/bu',  tickSize:0.25 },
  { slug:'soybeans',     label:'Soybeans',      futId:320, optId:321, exchange:'G', unit:'cents/bu',  tickSize:0.25 },
  { slug:'soybean_meal', label:'Soybean Meal',  futId:325, optId:326, exchange:'G', unit:'$/ton',     tickSize:0.10 },
  { slug:'soybean_oil',  label:'Soybean Oil',   futId:312, optId:313, exchange:'G', unit:'cents/lb',  tickSize:0.005 },
];

const FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10';

function httpGetJson(url, extraHeaders) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.cmegroup.com/'
    };
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const req = https.get(url, { headers, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGetJson(res.headers.location, extraHeaders).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (e) { resolve(text); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout: ' + url)); });
  });
}

function httpPut(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'PUT',
      headers: Object.assign({
        'User-Agent': 'jhd-cme-updater/1.0',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'application/vnd.github.v3+json'
      }, headers),
      timeout: 25000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          return reject(new Error('HTTP ' + res.statusCode + ': ' + text));
        }
        try { resolve(JSON.parse(text)); } catch (e) { resolve(text); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout PUT ' + url)); });
    req.write(data);
    req.end();
  });
}

// ============================================================
// FETCH ONE COMMODITY
// ============================================================
async function fetchCommodity(p) {
  console.log('  ' + p.slug + ': fetching futures (id=' + p.futId + ')...');

  // 1. Futures quotes
  let futures = [];
  try {
    const futUrl = 'https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/' + p.futId + '/' + p.exchange + '?pageSize=50';
    const futData = await httpGetJson(futUrl);
    if (futData && futData.quotes) {
      futures = futData.quotes.map(q => ({
        expiry: q.expirationMonth || q.expirationCode || q.productCode,
        last: parseFloat(q.last) || null,
        priorSettle: parseFloat(q.priorSettle) || null,
        settle: parseFloat(q.priorSettle) || null,   // CmeWS exposes prior settle on delayed feed
        change: parseFloat(q.change) || null,
        open: parseFloat(q.open) || null,
        high: parseFloat(q.high) || null,
        low: parseFloat(q.low) || null,
        volume: parseInt(q.volume) || null,
        openInterest: parseInt(q.priorOpenInterest) || null,
        priorOI: parseInt(q.priorOpenInterest) || null
      }));
    }
    console.log('    futures: ' + futures.length);
  } catch (e) {
    console.warn('    futures fetch failed: ' + e.message);
  }

  // 2. Get option expiry list
  console.log('  ' + p.slug + ': fetching option expiries (id=' + p.optId + ')...');
  let expiries = [];
  try {
    const expUrl = 'https://www.cmegroup.com/CmeWS/mvc/Options/Categories/List/' + p.optId + '/' + p.exchange + '?optionTypeFilter=';
    const expData = await httpGetJson(expUrl);
    // expData is an array of category objects with options inside
    if (Array.isArray(expData)) {
      for (const cat of expData) {
        if (cat.options && Array.isArray(cat.options)) {
          for (const opt of cat.options) {
            if (opt.expiration && opt.label) {
              expiries.push({
                id: opt.expiration,
                label: opt.label,
                isWeekly: (cat.name || '').toLowerCase().includes('weekly') || (cat.name || '').toLowerCase().includes('short')
              });
            }
          }
        }
      }
    }
    console.log('    expiries found: ' + expiries.length);
  } catch (e) {
    console.warn('    expiry list failed: ' + e.message);
  }

  // 3. For each expiry, get full chain. Cap to first 6 to keep function under timeout.
  const options = [];
  const expiriesByLabel = {};
  const targetExpiries = expiries.filter(e => !e.isWeekly).slice(0, 6);
  console.log('  ' + p.slug + ': fetching ' + targetExpiries.length + ' option chains...');

  for (const exp of targetExpiries) {
    try {
      const chainUrl = 'https://www.cmegroup.com/CmeWS/mvc/Quotes/Option/' + p.optId + '/' + p.exchange + '/' + exp.id + '/ALL?optionProductId=' + p.optId + '&strikeRange=ALL';
      const chainData = await httpGetJson(chainUrl);
      let count = 0;
      if (chainData && chainData.optionContractQuotes) {
        for (const row of chainData.optionContractQuotes) {
          // Each row has strikePrice plus call and put sub-objects
          const strike = parseFloat(row.strikePrice);
          if (isNaN(strike)) continue;
          if (row.call) {
            options.push({
              expiry: exp.label,
              expiryId: exp.id,
              side: 'CALL',
              strike,
              last: parseFloat(row.call.last) || null,
              priorSettle: parseFloat(row.call.priorSettle) || null,
              settle: parseFloat(row.call.priorSettle) || null,
              change: parseFloat(row.call.change) || null,
              volume: parseInt(row.call.volume) || null,
              openInterest: parseInt(row.call.priorOpenInterest) || null,
              priorOI: parseInt(row.call.priorOpenInterest) || null,
              high: parseFloat(row.call.high) || null,
              low: parseFloat(row.call.low) || null
            });
            count++;
          }
          if (row.put) {
            options.push({
              expiry: exp.label,
              expiryId: exp.id,
              side: 'PUT',
              strike,
              last: parseFloat(row.put.last) || null,
              priorSettle: parseFloat(row.put.priorSettle) || null,
              settle: parseFloat(row.put.priorSettle) || null,
              change: parseFloat(row.put.change) || null,
              volume: parseInt(row.put.volume) || null,
              openInterest: parseInt(row.put.priorOpenInterest) || null,
              priorOI: parseInt(row.put.priorOpenInterest) || null,
              high: parseFloat(row.put.high) || null,
              low: parseFloat(row.put.low) || null
            });
            count++;
          }
        }
      }
      console.log('    ' + exp.label + ': ' + count + ' strikes');
    } catch (e) {
      console.warn('    chain ' + exp.label + ' failed: ' + e.message);
    }
  }

  return {
    label: p.label,
    futureId: p.futId,
    optionId: p.optId,
    unit: p.unit,
    tickSize: p.tickSize,
    futures,
    options
  };
}

// ============================================================
// MAIN
// ============================================================
exports.handler = async () => {
  console.log('=== update-cme-options START ===');
  console.log('GITHUB_TOKEN: ' + (process.env.GITHUB_TOKEN ? 'SET' : 'MISSING'));
  console.log('GITHUB_REPO: ' + (process.env.GITHUB_REPO || 'MISSING'));
  console.log('GITHUB_BRANCH: ' + (process.env.GITHUB_BRANCH || 'main'));

  try {
    // 10Y rate
    let riskFreeRate = 0.045;
    try {
      console.log('Fetching FRED DGS10...');
      const csv = await httpGetJson(FRED_URL);
      const lines = (typeof csv === 'string' ? csv : '').trim().split('\n').reverse();
      for (const line of lines) {
        const parts = line.split(',');
        if (parts[1] && parts[1] !== '.' && !isNaN(parseFloat(parts[1]))) {
          riskFreeRate = parseFloat(parts[1]) / 100;
          break;
        }
      }
      console.log('FRED OK, rate=' + (riskFreeRate*100).toFixed(2) + '%');
    } catch (e) {
      console.warn('FRED failed (using fallback): ' + e.message);
    }

    // Per-commodity fetch
    const out = {
      generatedAt: new Date().toISOString(),
      tradeDate: new Date().toISOString().slice(0,10),
      riskFreeRate,
      source: 'CME Group CmeWS public quotes + FRED DGS10',
      commodities: {}
    };

    for (const p of PRODUCTS) {
      const data = await fetchCommodity(p);
      out.commodities[p.slug] = data;
    }

    console.log('Pushing to GitHub...');
    const result = await pushToGithub('cme-ags-options.json', JSON.stringify(out, null, 2));
    console.log('GitHub OK: ' + result.commit);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok:true,
        tradeDate: out.tradeDate,
        riskFreeRate,
        commit: result.commit,
        counts: Object.fromEntries(Object.entries(out.commodities).map(([k,v]) => [k, {fut:v.futures.length, opt:v.options.length}]))
      })
    };
  } catch (e) {
    console.error('FATAL: ' + e.message);
    console.error(e.stack);
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: e.message }) };
  }
};

// ============================================================
// GITHUB PUSH
// ============================================================
async function pushToGithub(filename, content) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new Error('Missing GITHUB_TOKEN');
  if (!repo) throw new Error('Missing GITHUB_REPO');

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;

  // Get existing SHA
  let sha;
  try {
    const getResp = await httpGetJson(apiUrl + `?ref=${branch}`, {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    });
    sha = getResp.sha;
  } catch (e) {
    console.log('  No existing file (will create)');
  }

  // PUT — note this needs auth header which httpGetJson doesn't carry
  const body = {
    message: `Daily CME ag options update - ${new Date().toISOString().slice(0,10)}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  };
  if (sha) body.sha = sha;

  const result = await httpPut(apiUrl, body, {
    'Authorization': `Bearer ${token}`
  });

  return { commit: result.commit && result.commit.sha, path: result.content && result.content.path };
}
