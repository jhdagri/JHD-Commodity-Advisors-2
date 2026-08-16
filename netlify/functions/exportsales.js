// netlify/functions/exportsales.js
// Fetches USDA ESRQS weekly CWR Commodity Summary XML
// Static file updated every Thursday at 8:30am ET — no API key, no IP restrictions
// URL: https://apps.fas.usda.gov/esrqs/StaticReports/CWRCommoditySummary.xml
//
// Fix (Aug 2026): this started intermittently failing with "Error: fetch
// failed" after ~10.7s — right at Netlify's synchronous function execution
// ceiling. That's not USDA cleanly rejecting the request (no HTTP status
// like 403/429 was ever logged); the connection just wasn't completing
// from Netlify's network until the platform killed the function. Fetching
// the same URL directly from a normal client worked fine, which points at
// USDA's server/WAF filtering the request based on how it looks in transit
// — the request previously had no User-Agent at all, a common bot-
// detection trigger. Two changes: (1) send browser-like headers so the
// request looks like an ordinary page load, and (2) an explicit
// AbortController timeout so a bad connection fails fast with a clear
// message instead of running the function out the clock.
var XML_URL = 'https://apps.fas.usda.gov/esrqs/StaticReports/CWRCommoditySummary.xml';
var FETCH_TIMEOUT_MS = 8500; // headroom inside Netlify's ~10s ceiling

// Commodity codes we want
var TARGET_CODES = {
  '401': 'Corn',
  '107': 'All Wheat',
  '801': 'Soybeans',
  '901': 'Soy Meal',
  '902': 'Soy Oil',
};

// ── XML attribute extractor ─────────────────────────────────────
function attr(str, name) {
  var re = new RegExp(name + '="([^"]*)"');
  var m = str.match(re);
  return m ? m[1] : null;
}

function numAttr(str, name) {
  var v = attr(str, name);
  if (v === null || v === '') return 0;
  var n = parseFloat(v.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── Parse all Detail elements from XML ─────────────────────────
function parseXml(xml) {
  var rows = [];
  // Match all self-closing Details elements
  var re = /<Details\s[^>]+\/>/g;
  var m;
  while ((m = re.exec(xml)) !== null) {
    var el = m[0];
    var code = attr(el, 'CommodityCode');
    if (!code || !TARGET_CODES[code]) continue;

    rows.push({
      commodityCode:  code,
      commodityName:  TARGET_CODES[code],
      periodEndDate:  attr(el, 'PeriodEndingDate'),
      weekNum:        parseInt(attr(el, 'MarketingYearWeekNumber') || '0'),
      netSales:       numAttr(el, 'NetSales'),       // current MKY (thousands MT)
      nextNetSales:   numAttr(el, 'NextMKTYearNetSales'), // next MKY
      accumulated:    numAttr(el, 'AccumulatedExports'),
      outstanding:    numAttr(el, 'OutstandingSales'),
      weeklyExports:  numAttr(el, 'WeeklyExports'),
      projection:     numAttr(el, 'WASDEReportProjectionsQuantity'), // in MILLIONS MT (not thousands)
      prevAccumulated:numAttr(el, 'PreviousMKTYearAccumulatedExports'),
      prevOutstanding:numAttr(el, 'PreviousMKTYearOutstandingSales'),
    });
  }
  return rows;
}

// ── Group rows by commodity and get 4-week history ──────────────
function buildOutput(rows) {
  var byCode = {};
  rows.forEach(function(r) {
    if (!byCode[r.commodityCode]) byCode[r.commodityCode] = [];
    byCode[r.commodityCode].push(r);
  });

  var summary = {};
  var history = {};
  var reportDate = null;

  Object.keys(byCode).forEach(function(code) {
    var name = TARGET_CODES[code];
    // Sort descending by week number then by date
    var sorted = byCode[code].sort(function(a, b) {
      if (b.weekNum !== a.weekNum) return b.weekNum - a.weekNum;
      return new Date(b.periodEndDate) - new Date(a.periodEndDate);
    });

    var recent = sorted.slice(0, 4);
    var latest = recent[0];

    if (!reportDate && latest.periodEndDate) {
      // Format date from MM/DD/YYYY
      var parts = latest.periodEndDate.split('/');
      if (parts.length === 3) {
        var d = new Date(parts[2], parseInt(parts[0])-1, parts[1]);
        reportDate = d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
      }
    }

    function buildRow(r) {
      // Convert from thousands MT to MT
      var nc  = r.netSales     * 1000;
      var nn  = r.nextNetSales * 1000;
      var ac  = r.accumulated  * 1000;
      var os  = r.outstanding  * 1000;
      var pr  = r.projection   * 1000;
      // WASDEReportProjectionsQuantity is in MILLIONS MT; convert to thousands for comparison
    // % USDA uses TotalCommitment (accumulated + outstanding), not just accumulated
    var prMt = r.projection > 0 ? r.projection * 1000 : 0;  // millions → thousands MT
    var totalCommit = r.accumulated + r.outstanding;           // thousands MT
    var pct = (prMt > 0 && totalCommit > 0) ? Math.round(totalCommit / prMt * 1000) / 10 : null;

    // vs yr ago: compare current TotalCommitment to previous year's
    var prevTotal = r.prevAccumulated + r.prevOutstanding;
    var vsYrAgo  = (prevTotal > 0) ? Math.round((totalCommit - prevTotal) / prevTotal * 1000) / 10 : null;

      // Format date
      var dt = '--';
      if (r.periodEndDate) {
        var parts = r.periodEndDate.split('/');
        if (parts.length === 3) {
          dt = new Date(parts[2], parseInt(parts[0])-1, parts[1])
               .toLocaleDateString('en-GB', {day:'2-digit', month:'short'});
        }
      }

      return {
        date:        dt,
        netSales:    nc,
        nextNet:     nn,
        total:       nc + nn,
        accumulated: ac,
        outstanding: os,
        projection:  pr,
        pct_usda:    pct !== null ? pct.toFixed(1) : '--',
        pct_5yr:     '--',
        vsYrAgo:     vsYrAgo,
      };
    }

    var latestRow = buildRow(latest);

    summary[name] = {
      netSales:    latestRow.netSales,
      nextNet:     latestRow.nextNet,
      total:       latestRow.total,
      accumulated: latestRow.accumulated,
      outstanding: latestRow.outstanding,
      pctUsda:     latestRow.pct_usda !== '--' ? parseFloat(latestRow.pct_usda) : null,
      pct_usda:    latestRow.pct_usda,
      vsYrAgo:     latestRow.vsYrAgo,
    };

    history[name] = recent.map(buildRow);
  });

  return { summary: summary, history: history, reportDate: reportDate };
}

// ── Handler ─────────────────────────────────────────────────────
exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:headers, body:'' };

  try {
    console.log('Fetching ESRQS static XML...');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
    var resp;
    try {
      resp = await fetch(XML_URL, {
        headers: {
          'Accept': 'application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    console.log('XML response: HTTP ' + resp.status);
    if (!resp.ok) throw new Error('XML fetch failed: HTTP ' + resp.status);

    var xml = await resp.text();
    console.log('XML length: ' + xml.length + ' chars');

    var rows = parseXml(xml);
    console.log('Parsed ' + rows.length + ' rows for target commodities');

    var output = buildOutput(rows);
    console.log('Commodities found: ' + Object.keys(output.summary).join(', '));
    console.log('Report date: ' + output.reportDate);

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        reportDate: output.reportDate || 'Latest',
        summary:    output.summary,
        history:    output.history,
        topBuyers:  {},
        fetchedAt:  new Date().toISOString(),
        source:     'USDA ESRQS CWRCommoditySummary.xml'
      })
    };

  } catch(e) {
    var msg = (e && e.name === 'AbortError')
      ? 'Timed out after ' + FETCH_TIMEOUT_MS + 'ms waiting for USDA ESRQS'
      : (e && e.message) || String(e);
    console.error('Error: ' + msg);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: msg })
    };
  }
};
