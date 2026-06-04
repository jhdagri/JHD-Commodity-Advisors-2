// netlify/functions/exportsales.js
// Fetches USDA weekly export sales from the FAS OpenData API
// No API key required — public data
//
// Commodity codes: 107=AllWheat, 401=Corn, 801=Soybeans, 901=SoyMeal, 902=SoyOil
// API base: https://apps.fas.usda.gov/OpenData/api/esr/exports/
// Endpoint: /commodityCode/{code}/allCountries/marketYear/{year}
// Data units: thousands of metric tonnes (x1000 to get MT)
// ================================================================

var COMMODITIES = [
  { name: 'Corn',      code: '401' },
  { name: 'All Wheat', code: '107' },
  { name: 'Soybeans',  code: '801' },
  { name: 'Soy Meal',  code: '901' },
  { name: 'Soy Oil',   code: '902' },
];

var FAS_BASE = 'https://apps.fas.usda.gov/OpenData/api/esr/exports';
var ESRQS_BASE = 'https://apps.fas.usda.gov/esrqs/api/esr/exports';

// ── Helper: get current marketing year for each commodity ──────────
function getMarketingYear(commodityName) {
  var now = new Date();
  var month = now.getMonth() + 1; // 1-12
  var year = now.getFullYear();
  // Corn/Soybeans/SoyMeal/SoyOil: MKY starts Sep 1 → use next year from Sep onwards
  // Wheat: MKY starts Jun 1 → use next year from Jun onwards
  if (commodityName === 'All Wheat') {
    return month >= 6 ? year + 1 : year;
  }
  return month >= 9 ? year + 1 : year;
}

// ── Helper: flexible field getter for API response rows ────────────
// FAS API field names can vary slightly — try multiple candidates
function getField(row, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var k = candidates[i];
    if (row[k] !== undefined && row[k] !== null) return parseFloat(row[k]) || 0;
    // Try lowercase variant
    var kl = k.charAt(0).toLowerCase() + k.slice(1);
    if (row[kl] !== undefined && row[kl] !== null) return parseFloat(row[kl]) || 0;
  }
  return 0;
}

function getDateField(row) {
  var candidates = ['weeklyExportSalesDate','periodEndingDate','reportDate',
                    'weekEndingDate','WeeklyExportSalesDate','PeriodEndingDate'];
  for (var i = 0; i < candidates.length; i++) {
    if (row[candidates[i]]) return row[candidates[i]];
  }
  return null;
}

// ── Fetch one commodity from FAS API ──────────────────────────────
async function fetchCommodity(name, code, marketYear) {
  var urls = [
    FAS_BASE + '/commodityCode/' + code + '/allCountries/marketYear/' + marketYear,
    ESRQS_BASE + '/commodityCode/' + code + '/allCountries/marketYear/' + marketYear,
  ];

  var lastErr = null;
  for (var i = 0; i < urls.length; i++) {
    try {
      var resp = await fetch(urls[i], {
        headers: { 'Accept': 'application/json', 'User-Agent': 'JHD-Bushel/1.0' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
      });
      if (!resp.ok) { lastErr = 'HTTP ' + resp.status; continue; }
      var data = await resp.json();
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error('Failed to fetch ' + name + ' (code ' + code + '): ' + lastErr);
}

// ── Process rows into summary + 4-week history ───────────────────
function processRows(name, rows) {
  if (!rows || rows.length === 0) return null;

  // Sort by date descending
  rows.sort(function(a, b) {
    var da = new Date(getDateField(a) || 0);
    var db = new Date(getDateField(b) || 0);
    return db - da;
  });

  var recent = rows.slice(0, 4);
  var latest = recent[0];

  // Extract field values (API returns in 1000s MT — multiply by 1000)
  function extract(row) {
    var netCurr   = getField(row, ['netSalesCurrMktYear','NetSalesCurrMktYear','netSales','NetSales']) * 1000;
    var netNext   = getField(row, ['netSalesNextMktYear','NetSalesNextMktYear','grossSalesNextMktYear','nextMktYearNetSales']) * 1000;
    var weekExp   = getField(row, ['weeklyExportsCurrMktYear','WeeklyExportsCurrMktYear','weeklyExports']) * 1000;
    var accExp    = getField(row, ['accumulatedExportsCurrMktYear','AccumulatedExportsCurrMktYear','accumulatedExports']) * 1000;
    var outstand  = getField(row, ['outstandingSalesCurrMktYear','OutstandingSalesCurrMktYear','outstandingSales']) * 1000;
    var proj      = getField(row, ['officialProjection','OfficialProjection','usdaProjection','cumulativeOutlookInKTons','usda_projection']) * 1000;
    var dateStr   = getDateField(row);
    var d         = dateStr ? new Date(dateStr) : null;
    var pctUsda   = (proj > 0 && accExp > 0) ? Math.round((accExp / proj) * 1000) / 10 : null;

    return {
      date:        d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '--',
      netSales:    netCurr,
      nextNet:     netNext,
      total:       netCurr + netNext,
      weeklyExp:   weekExp,
      accumulated: accExp,
      outstanding: outstand,
      projection:  proj,
      pct_usda:    pctUsda !== null ? pctUsda.toFixed(1) : '--',
      pct_5yr:     '--',  // Phase 2 — requires historical calculation
    };
  }

  var latestData = extract(latest);

  return {
    summary: {
      netSales:    latestData.netSales,
      nextNet:     latestData.nextNet,
      total:       latestData.total,
      accumulated: latestData.accumulated,
      outstanding: latestData.outstanding,
      projection:  latestData.projection,
      pctUsda:     latestData.pct_usda !== '--' ? parseFloat(latestData.pct_usda) : null,
      pct_usda:    latestData.pct_usda,
      vsYrAgo:     null,
    },
    history:  recent.map(extract),
    dateStr:  latestData.date,
  };
}

// ── Main handler ──────────────────────────────────────────────────
exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=1800'  // cache 30 mins
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: headers, body: '' };
  }

  try {
    var summary = {};
    var history = {};
    var reportDate = null;

    // Fetch all commodities in parallel
    var fetches = COMMODITIES.map(async function(c) {
      var yr = getMarketingYear(c.name);
      var rows = await fetchCommodity(c.name, c.code, yr);
      return { name: c.name, rows: rows };
    });

    var results = await Promise.all(fetches);

    results.forEach(function(r) {
      var processed = processRows(r.name, r.rows);
      if (!processed) return;
      summary[r.name] = processed.summary;
      history[r.name]  = processed.history;
      if (!reportDate && processed.dateStr !== '--') {
        reportDate = processed.dateStr;
      }
    });

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        reportDate:  reportDate || 'Latest',
        summary:     summary,
        history:     history,
        topBuyers:   {},   // Phase 2 — country-level API calls
        fetchedAt:   new Date().toISOString(),
        source:      'USDA FAS OpenData API',
        note:        'pct_5yr column requires historical calc — Phase 2'
      })
    };

  } catch (e) {
    console.error('exportsales function error:', e.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({
        error:   e.message,
        hint:    'Check FAS API availability at apps.fas.usda.gov/OpenData/api/esr/'
      })
    };
  }
};
