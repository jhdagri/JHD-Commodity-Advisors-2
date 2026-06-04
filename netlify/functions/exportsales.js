// netlify/functions/exportsales.js
// Fetches USDA FAS weekly export sales data
// Single sequential fetch per commodity to avoid rate limiting

var COMMODITIES = [
  { name: 'Corn',      code: '401' },
  { name: 'All Wheat', code: '107' },
  { name: 'Soybeans',  code: '801' },
  { name: 'Soy Meal',  code: '901' },
  { name: 'Soy Oil',   code: '902' },
];

var FAS_BASE = 'https://apps.fas.usda.gov/OpenData/api/esr/exports';

function getMarketingYear(name) {
  var now = new Date();
  var month = now.getMonth() + 1;
  var year  = now.getFullYear();
  if (name === 'All Wheat') return month >= 6 ? year + 1 : year;
  return month >= 9 ? year + 1 : year;
}

function getField(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = row[keys[i]];
    if (v !== undefined && v !== null && v !== '') {
      var n = parseFloat(v);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

function getDate(row) {
  var keys = ['weeklyExportSalesDate','periodEndingDate','reportDate','weekEndingDate'];
  for (var i = 0; i < keys.length; i++) {
    if (row[keys[i]]) return row[keys[i]];
  }
  return null;
}

function safe(v) { return (v === null || isNaN(v)) ? 0 : v; }

function processRows(name, rows) {
  if (!rows || rows.length === 0) return null;

  // Log all field keys from first row to help debug
  if (rows[0]) {
    console.log(name + ' fields: ' + Object.keys(rows[0]).join(', '));
  }

  rows.sort(function(a, b) {
    return new Date(getDate(b) || 0) - new Date(getDate(a) || 0);
  });

  var recent = rows.slice(0, 4);

  function extract(row) {
    var netCurr  = getField(row, ['netSalesCurrMktYear','NetSalesCurrMktYear','netSales','net_sales_curr','currMktYrNetSales']);
    var netNext  = getField(row, ['netSalesNextMktYear','NetSalesNextMktYear','grossSalesNextMktYear','nextMktYrNetSales','net_sales_next']);
    var accExp   = getField(row, ['accumulatedExportsCurrMktYear','AccumulatedExportsCurrMktYear','accumulatedExports','accExportsCurrMktYr']);
    var outstand = getField(row, ['outstandingSalesCurrMktYear','OutstandingSalesCurrMktYear','outstandingSales','outstandSalesCurrMktYr']);
    var proj     = getField(row, ['officialProjection','OfficialProjection','usdaProjection','annualProjection','totalProjection','usda_projection','projectedExports','projectedNetExports']);

    // Scale: API returns in 1000s MT
    var nc = safe(netCurr)  * 1000;
    var nn = safe(netNext)  * 1000;
    var ac = safe(accExp)   * 1000;
    var os = safe(outstand) * 1000;
    var pr = safe(proj)     * 1000;

    var pct = (pr > 0 && ac > 0) ? Math.round(ac / pr * 1000) / 10 : null;
    var d   = getDate(row);
    var dt  = d ? new Date(d).toLocaleDateString('en-GB', {day:'2-digit', month:'short'}) : '--';

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
    };
  }

  var latest = extract(recent[0]);
  return {
    summary: {
      netSales:    latest.netSales,
      nextNet:     latest.nextNet,
      total:       latest.total,
      accumulated: latest.accumulated,
      outstanding: latest.outstanding,
      pctUsda:     latest.pct_usda !== '--' ? parseFloat(latest.pct_usda) : null,
      pct_usda:    latest.pct_usda,
    },
    history:  recent.map(extract),
    dateStr:  latest.date,
    rawSample: rows[0],  // for field name debugging
  };
}

function delay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

exports.handler = async function(event) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:headers, body:'' };

  try {
    console.log('exportsales invoked');

    // Try to discover corn code from commodities endpoint
    try {
      var comResp = await fetch('https://apps.fas.usda.gov/OpenData/api/esr/commodities', {
        headers: { 'Accept': 'application/json' }
      });
      if (comResp.ok) {
        var comData = await comResp.json();
        var cornEntry = comData.find(function(c) {
          return c.commodityName && c.commodityName.toLowerCase().indexOf('corn') > -1;
        });
        if (cornEntry) {
          console.log('Corn commodity entry: ' + JSON.stringify(cornEntry));
          // Update corn code if found
          COMMODITIES[0].code = String(cornEntry.commodityCode || cornEntry.code || COMMODITIES[0].code);
        }
        // Log all codes for reference
        console.log('All commodities: ' + comData.slice(0,20).map(function(c){ return c.commodityCode+':'+c.commodityName; }).join(', '));
      } else {
        console.log('Commodities endpoint: HTTP ' + comResp.status);
      }
    } catch(ce) {
      console.log('Commodities lookup failed: ' + ce.message);
    }

    var summary = {};
    var history = {};
    var reportDate = null;
    var debugSamples = {};

    // Sequential fetches with small delay to avoid rate limiting
    for (var i = 0; i < COMMODITIES.length; i++) {
      if (i > 0) await delay(400);
      var c = COMMODITIES[i];
      var yr = getMarketingYear(c.name);
      var url = FAS_BASE + '/commodityCode/' + c.code + '/allCountries/marketYear/' + yr;
      console.log('Fetching ' + c.name + ' from ' + url);

      try {
        var resp = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; JHD/1.0)',
            'Referer': 'https://apps.fas.usda.gov/esrqs/'
          }
        });
        console.log(c.name + ': HTTP ' + resp.status);

        if (!resp.ok) continue;

        var rows = await resp.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          console.log(c.name + ': empty response');
          continue;
        }

        console.log(c.name + ': ' + rows.length + ' rows');
        var processed = processRows(c.name, rows);
        if (!processed) continue;

        summary[c.name] = processed.summary;
        history[c.name] = processed.history;
        debugSamples[c.name] = processed.rawSample;

        if (!reportDate && processed.dateStr !== '--') {
          reportDate = processed.dateStr;
        }
      } catch(e) {
        console.log(c.name + ' error: ' + e.message);
      }
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        reportDate:  reportDate || 'Latest',
        summary:     summary,
        history:     history,
        topBuyers:   {},
        fetchedAt:   new Date().toISOString(),
        _debug:      debugSamples
      })
    };

  } catch(e) {
    console.error('Fatal error: ' + e.message);
    return { statusCode:500, headers:headers, body: JSON.stringify({ error: e.message }) };
  }
};
