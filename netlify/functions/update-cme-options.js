// netlify/functions/update-cme-options.js
// Daily fetch of CME ag settlements + FRED 10Y, commit JSON to repo.
// Uses native https module (works on all Node versions).

const https = require('https');

const CME_URL  = 'https://www.cmegroup.com/ftp/pub/settle/stlags_v2';
const FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10';

const PRODUCTS = [
  { slug:'corn',         label:'Corn',          futureCode:'ZC', optionCode:'OZC', match:'CORN' },
  { slug:'wheat',        label:'SRW Wheat',     futureCode:'ZW', optionCode:'OZW', match:'WHEAT' },
  { slug:'hrw_wheat',    label:'HRW Wheat',     futureCode:'KE', optionCode:'OKE', match:'HRW WHEAT' },
  { slug:'soybeans',     label:'Soybeans',      futureCode:'ZS', optionCode:'OZS', match:'SOYBEAN' },
  { slug:'soybean_meal', label:'Soybean Meal',  futureCode:'ZM', optionCode:'OZM', match:'SOYBEAN MEAL' },
  { slug:'soybean_oil',  label:'Soybean Oil',   futureCode:'ZL', optionCode:'OZL', match:'SOYBEAN OIL' },
];

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/plain,text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      }, headers),
      timeout: 25000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, headers).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout fetching ' + url)); });
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
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Timeout PUT ' + url)); });
    req.write(data);
    req.end();
  });
}

exports.handler = async () => {
  console.log('=== update-cme-options START ===');
  console.log('GITHUB_TOKEN: ' + (process.env.GITHUB_TOKEN ? 'SET (' + process.env.GITHUB_TOKEN.slice(0,10) + '...)' : 'MISSING'));
  console.log('GITHUB_REPO: ' + (process.env.GITHUB_REPO || 'MISSING'));
  console.log('GITHUB_BRANCH: ' + (process.env.GITHUB_BRANCH || 'main'));

  try {
    console.log('Fetching CME stlags_v2...');
    const cmeText = await httpGet(CME_URL);
    console.log('CME OK, ' + cmeText.length + ' bytes');

    let riskFreeRate = 0.045;
    try {
      console.log('Fetching FRED DGS10...');
      const csv = await httpGet(FRED_URL);
      const lines = csv.trim().split('\n').reverse();
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

    console.log('Parsing...');
    const parsed = parseSettlementFile(cmeText);
    console.log('Parsed: ' + parsed.futures.length + ' futures, ' + parsed.options.length + ' options, tradeDate=' + parsed.tradeDate);

    const out = {
      generatedAt: new Date().toISOString(),
      tradeDate: parsed.tradeDate || new Date().toISOString().slice(0,10),
      riskFreeRate,
      source: 'CME Group stlags_v2 + FRED DGS10',
      commodities: {}
    };

    for (const p of PRODUCTS) {
      const futures = parsed.futures.filter(f => f.product === p.slug);
      const options = parsed.options.filter(o => o.product === p.slug);
      out.commodities[p.slug] = { label: p.label, futureCode: p.futureCode, optionCode: p.optionCode, futures, options };
      console.log('  ' + p.slug + ': ' + futures.length + ' fut, ' + options.length + ' opt');
    }

    console.log('Pushing to GitHub...');
    const result = await pushToGithub('cme-ags-options.json', JSON.stringify(out, null, 2));
    console.log('GitHub OK: ' + result.commit);

    return { statusCode: 200, body: JSON.stringify({ ok:true, tradeDate: out.tradeDate, riskFreeRate, commit: result.commit }) };
  } catch (e) {
    console.error('FATAL: ' + e.message);
    console.error(e.stack);
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: e.message }) };
  }
};

function parseSettlementFile(text) {
  const lines = text.split('\n');
  const futures = [];
  const options = [];
  let tradeDate = null;
  let currentProduct = null;
  let currentMode = null;
  let currentExpiry = null;
  let currentSide = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) continue;

    if (!tradeDate) {
      const dm = line.match(/BUSINESS DATE\s*[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
      if (dm) tradeDate = dm[1];
    }

    const upper = line.toUpperCase();
    const prod = PRODUCTS.find(p => upper.startsWith(p.match) && (upper.includes('FUTURES') || upper.includes('OPTIONS')));
    if (prod) {
      currentProduct = prod.slug;
      currentMode = upper.includes('OPTIONS') ? 'OPT' : 'FUT';
      currentExpiry = null;
      currentSide = null;
      continue;
    }

    if (currentMode === 'OPT') {
      const expM = line.match(/^\s*([A-Z]{3}\d{2})\s+(CALL|PUT|C|P)\s*$/i);
      if (expM) {
        currentExpiry = expM[1].toUpperCase();
        const s = expM[2].toUpperCase();
        currentSide = (s === 'C' || s === 'CALL') ? 'CALL' : 'PUT';
        continue;
      }
      const expM2 = line.match(/ON\s+([A-Z]{3}\d{2})\s+FUTURES/i);
      if (expM2) {
        currentExpiry = expM2[1].toUpperCase();
        currentSide = null;
        continue;
      }
      const sideM = line.match(/^\s*(CALLS?|PUTS?)\s*$/i);
      if (sideM) {
        currentSide = sideM[1].toUpperCase().startsWith('C') ? 'CALL' : 'PUT';
        continue;
      }
    }

    if (!currentProduct) continue;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;

    if (currentMode === 'FUT') {
      const moTok = tokens[0];
      if (!/^[A-Z]{3}\d{2}$/.test(moTok)) continue;
      const nums = parseNumericTokens(tokens.slice(1));
      if (nums.length < 4) continue;
      futures.push({
        product: currentProduct, expiry: moTok,
        open:nums[0], high:nums[1], low:nums[2], last:nums[3],
        settle:nums[4]||null, change:nums[5]||null, volume:nums[6]||null,
        priorSettle:nums[7]||null, priorVol:nums[8]||null, priorOI:nums[9]||null
      });
    } else if (currentMode === 'OPT' && currentExpiry && currentSide) {
      const strikeTok = tokens[0].replace(/[A-Z]+$/i,'');
      const strike = parseFloat(strikeTok);
      if (isNaN(strike) || strike <= 0) continue;
      const nums = parseNumericTokens(tokens.slice(1));
      if (nums.length < 3) continue;
      options.push({
        product: currentProduct, expiry: currentExpiry, side: currentSide, strike,
        open:nums[0], high:nums[1], low:nums[2], last:nums[3]||null,
        settle:nums[4]||null, change:nums[5]||null, volume:nums[6]||null,
        priorSettle:nums[7]||null, priorVol:nums[8]||null, priorOI:nums[9]||null
      });
    }
  }

  return { tradeDate, futures, options };
}

function parseNumericTokens(toks) {
  const out = [];
  for (const t of toks) {
    if (t === '-' || t === '' || t === 'UNCH') { out.push(null); continue; }
    const cleaned = t.replace(/[A-Za-z]+$/,'').replace(/,/g,'');
    if (cleaned === '' || cleaned === '-') { out.push(null); continue; }
    const n = parseFloat(cleaned);
    if (!isNaN(n)) out.push(n);
  }
  return out;
}

async function pushToGithub(filename, content) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new Error('Missing GITHUB_TOKEN env var');
  if (!repo) throw new Error('Missing GITHUB_REPO env var');

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;
  console.log('  GitHub URL: ' + apiUrl + ' on branch ' + branch);

  let sha;
  try {
    const getResp = await httpGet(apiUrl + `?ref=${branch}`, {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    });
    const data = JSON.parse(getResp);
    sha = data.sha;
    console.log('  Existing SHA: ' + sha);
  } catch (e) {
    console.log('  No existing file (will create): ' + e.message);
  }

  const body = {
    message: `Daily CME ag options update - ${new Date().toISOString().slice(0,10)}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  };
  if (sha) body.sha = sha;

  const result = await httpPut(apiUrl, body, {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  });

  return { commit: result.commit && result.commit.sha, path: result.content && result.content.path };
}
