// netlify/functions/update-cme-options.js
// Scheduled function: fetches CME stlags_v2 + FRED DGS10 daily,
// parses corn/wheat/soybeans/soymeal/soyoil/hrw_wheat options chains,
// writes cme-ags-options.json to repo via GitHub API.
//
// Schedule: weekdays 19:45 London (after CME 1:15pm CT settle).
// Requires Netlify env vars: GITHUB_TOKEN, GITHUB_REPO (e.g. user/repo), GITHUB_BRANCH (default 'main').

const CME_URL  = 'https://www.cmegroup.com/ftp/pub/settle/stlags_v2';
const FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10';

// Product code mapping in stlags_v2 -> our slug
// CME product codes per fact card: corn future = C / option = OC, etc.
// stlags_v2 uses CME Globex symbols. We match by product name strings in the headers.
const PRODUCTS = [
  { slug:'corn',         label:'Corn',          futureCode:'ZC',  optionCode:'OZC',  match:'CORN' },
  { slug:'wheat',        label:'SRW Wheat',     futureCode:'ZW',  optionCode:'OZW',  match:'WHEAT' },        // matches Chicago SRW first
  { slug:'hrw_wheat',    label:'HRW Wheat',     futureCode:'KE',  optionCode:'OKE',  match:'HRW WHEAT' },
  { slug:'soybeans',     label:'Soybeans',      futureCode:'ZS',  optionCode:'OZS',  match:'SOYBEAN' },
  { slug:'soybean_meal', label:'Soybean Meal',  futureCode:'ZM',  optionCode:'OZM',  match:'SOYBEAN MEAL' },
  { slug:'soybean_oil',  label:'Soybean Oil',   futureCode:'ZL',  optionCode:'OZL',  match:'SOYBEAN OIL' },
];

const MONTH_CODES = {F:1,G:2,H:3,J:4,K:5,M:6,N:7,Q:8,U:9,V:10,X:11,Z:12};

exports.handler = async () => {
  try {
    // 1. Fetch CME settlement file
    const cmeResp = await fetch(CME_URL);
    if (!cmeResp.ok) throw new Error('CME fetch failed: ' + cmeResp.status);
    const cmeText = await cmeResp.text();

    // 2. Fetch 10Y Treasury from FRED CSV
    let riskFreeRate = 0.045; // sensible fallback
    try {
      const fredResp = await fetch(FRED_URL);
      if (fredResp.ok) {
        const csv = await fredResp.text();
        const lines = csv.trim().split('\n').reverse();
        for (const line of lines) {
          const [date, val] = line.split(',');
          if (val && val !== '.' && !isNaN(parseFloat(val))) {
            riskFreeRate = parseFloat(val) / 100;
            break;
          }
        }
      }
    } catch (e) { console.error('FRED fail, using fallback', e.message); }

    // 3. Parse CME file
    const parsed = parseSettlementFile(cmeText);

    // 4. Build final structure
    const out = {
      generatedAt: new Date().toISOString(),
      tradeDate: parsed.tradeDate || extractDate(cmeText),
      riskFreeRate,
      source: 'CME Group stlags_v2 + FRED DGS10',
      commodities: {}
    };

    for (const p of PRODUCTS) {
      const futures = parsed.futures.filter(f => f.product === p.slug);
      const options = parsed.options.filter(o => o.product === p.slug);
      out.commodities[p.slug] = {
        label: p.label,
        futureCode: p.futureCode,
        optionCode: p.optionCode,
        futures,
        options
      };
    }

    // 5. Push to GitHub
    const result = await pushToGithub('cme-ags-options.json', JSON.stringify(out, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        tradeDate: out.tradeDate,
        riskFreeRate,
        contracts: Object.fromEntries(
          Object.entries(out.commodities).map(([k,v]) => [k, {futures:v.futures.length, options:v.options.length}])
        ),
        github: result
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: e.message }) };
  }
};

// ============================================================
// PARSER
// ============================================================
function extractDate(text) {
  // Look for "BUSINESS DATE: MM/DD/YYYY" or similar
  const m = text.match(/BUSINESS DATE\s*[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
  return m ? m[1] : new Date().toISOString().slice(0,10);
}

function parseSettlementFile(text) {
  const lines = text.split('\n');
  const futures = [];
  const options = [];
  let tradeDate = null;

  let currentProduct = null;     // slug
  let currentMode = null;        // 'FUT' or 'OPT'
  let currentExpiry = null;      // for options: MMMYY of underlying
  let currentSide = null;        // for options: 'CALL' or 'PUT'

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    // Detect business date
    if (!tradeDate) {
      const dm = line.match(/BUSINESS DATE\s*[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
      if (dm) tradeDate = dm[1];
    }

    // Detect product header — typically "CORN FUTURES" / "CORN OPTIONS"
    // Strategy: match upper-case product name + "FUTURES" or "OPTIONS"
    const upper = line.toUpperCase();
    const prod = PRODUCTS.find(p => upper.startsWith(p.match) && (upper.includes('FUTURES') || upper.includes('OPTIONS')));
    if (prod) {
      currentProduct = prod.slug;
      currentMode = upper.includes('OPTIONS') ? 'OPT' : 'FUT';
      currentExpiry = null;
      currentSide = null;
      continue;
    }

    // Detect option expiry header like "JUL26 CALL" / "JUL26 PUT"
    if (currentMode === 'OPT') {
      const expM = line.match(/^\s*([A-Z]{3}\d{2})\s+(CALL|PUT|C|P)\s*$/i);
      if (expM) {
        currentExpiry = expM[1].toUpperCase();
        const s = expM[2].toUpperCase();
        currentSide = (s === 'C' || s === 'CALL') ? 'CALL' : 'PUT';
        continue;
      }
      // Sometimes expiry block: "OPTIONS ON JUL26 FUTURES"
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

    // Data row detection — must contain numerics
    if (!currentProduct) continue;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) continue;

    // For futures: first token is contract month e.g. MAY26, JUL26 (MMMYY)
    if (currentMode === 'FUT') {
      const moTok = tokens[0];
      if (!/^[A-Z]{3}\d{2}$/.test(moTok)) continue;
      const nums = parseNumericTokens(tokens.slice(1));
      if (nums.length < 4) continue;
      futures.push({
        product: currentProduct,
        expiry: moTok,
        open: nums[0],
        high: nums[1],
        low: nums[2],
        last: nums[3],
        settle: nums[4] ?? null,
        change: nums[5] ?? null,
        volume: nums[6] ?? null,
        priorSettle: nums[7] ?? null,
        priorVol: nums[8] ?? null,
        priorOI: nums[9] ?? null
      });
    } else if (currentMode === 'OPT' && currentExpiry && currentSide) {
      // First token is a strike (integer or decimal)
      const strikeTok = tokens[0].replace(/[A-Z]+$/i,''); // strip optional cabinet flags
      const strike = parseFloat(strikeTok);
      if (isNaN(strike) || strike <= 0) continue;
      const nums = parseNumericTokens(tokens.slice(1));
      if (nums.length < 3) continue;
      options.push({
        product: currentProduct,
        expiry: currentExpiry,
        side: currentSide,
        strike,
        open: nums[0],
        high: nums[1],
        low: nums[2],
        last: nums[3] ?? null,
        settle: nums[4] ?? null,
        change: nums[5] ?? null,
        volume: nums[6] ?? null,
        priorSettle: nums[7] ?? null,
        priorVol: nums[8] ?? null,
        priorOI: nums[9] ?? null
      });
    }
  }

  return { tradeDate, futures, options };
}

function parseNumericTokens(toks) {
  const out = [];
  for (const t of toks) {
    if (t === '-' || t === '' || t === 'UNCH') { out.push(null); continue; }
    // Strip suffix letters like A/B/CAB
    const cleaned = t.replace(/[A-Za-z]+$/,'').replace(/,/g,'');
    if (cleaned === '' || cleaned === '-') { out.push(null); continue; }
    const n = parseFloat(cleaned);
    if (!isNaN(n)) out.push(n);
  }
  return out;
}

// ============================================================
// GITHUB PUSH
// ============================================================
async function pushToGithub(filename, content) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;        // 'user/repo'
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) throw new Error('Missing GITHUB_TOKEN or GITHUB_REPO env vars');

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filename}`;

  // Get current SHA if file exists
  let sha;
  try {
    const get = await fetch(apiUrl + `?ref=${branch}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'jhd-cme-updater' }
    });
    if (get.ok) {
      const data = await get.json();
      sha = data.sha;
    }
  } catch {}

  const body = {
    message: `Daily CME ag options update - ${new Date().toISOString().slice(0,10)}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  };
  if (sha) body.sha = sha;

  const put = await fetch(apiUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json', 'User-Agent':'jhd-cme-updater' },
    body: JSON.stringify(body)
  });

  if (!put.ok) {
    const txt = await put.text();
    throw new Error('GitHub PUT failed: ' + put.status + ' ' + txt);
  }
  const result = await put.json();
  return { commit: result.commit?.sha, path: result.content?.path };
}
