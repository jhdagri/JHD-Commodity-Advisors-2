// netlify/functions/exportinspections.js
// Fetches USDA FGIS weekly export grain inspection data
// Source: https://fgisonline.ams.usda.gov/ExportGrainReport/CY2026.csv
// Public static CSV — updated weekly (Monday/Tuesday after weekly cutoff)
// Covers: Corn, Wheat, Soybeans (bulk grain only — soymeal/soyoil not in FGIS)

var CSV_URL_2026 = 'https://fgisonline.ams.usda.gov/ExportGrainReport/CY2026.csv';
var CSV_URL_2025 = 'https://fgisonline.ams.usda.gov/ExportGrainReport/CY2025.csv';

// Commodity name patterns to match in the CSV
var COMMODITY_MAP = {
  'Corn':      ['CORN YELLOW','CORN WHITE','CORN'],
  'All Wheat': ['WHEAT HRW','WHEAT SRW','WHEAT HRS','WHEAT WHITE','WHEAT DURUM',
                'WHEAT MIXED','WHEAT PRODUCTS','WHEAT'],
  'Soybeans':  ['SOYBEANS','SOYBEAN'],
};

// ── Simple CSV parser ───────────────────────────────────────────
function parseCsv(text) {
  var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  if (lines.length < 2) return [];
  // Parse header
  var headers = splitCsvLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = splitCsvLine(lines[i]);
    var row = {};
    headers.forEach(function(h, idx) {
      row[h.trim().replace(/^"|"$/g,'')] = (vals[idx] || '').trim().replace(/^"|"$/g,'');
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// ── Detect quantity column (might vary by year) ─────────────────
function findQtyCol(headers) {
  var candidates = ['Metric Ton','Metric Tons','1000 Bushels','Pounds',
    'Inspection Quantity (Metric Tons)','Inspections (Metric Tons)',
    'MT','Quantity','QUANTITY','metric_tons','Inspection Quantity',
    'Net Weight Kilograms','Weight','Bushels'];
  for (var i = 0; i < candidates.length; i++) {
    if (headers.indexOf(candidates[i]) > -1) return candidates[i];
  }
  // Case-insensitive partial
  var numWords = ['ton','weight','quant','metric','bushel','pound','kg'];
  for (var i = 0; i < numWords.length; i++) {
    for (var j = 0; j < headers.length; j++) {
      if (headers[j].toLowerCase().indexOf(numWords[i]) > -1) return headers[j];
    }
  }
  return headers[headers.length - 1];
}

// ── Detect date and commodity columns ──────────────────────────
function findCol(headers, candidates) {
  // Exact match first
  for (var i = 0; i < candidates.length; i++) {
    if (headers.indexOf(candidates[i]) > -1) return candidates[i];
  }
  // Case-insensitive partial match
  for (var i = 0; i < candidates.length; i++) {
    var cl = candidates[i].toLowerCase();
    for (var j = 0; j < headers.length; j++) {
      if (headers[j].toLowerCase().indexOf(cl) > -1) return headers[j];
    }
  }
  return null;
}

// ── Match commodity name to our groups ─────────────────────────
function matchCommodity(name) {
  var upper = (name || '').toUpperCase();
  var keys = Object.keys(COMMODITY_MAP);
  for (var i = 0; i < keys.length; i++) {
    var patterns = COMMODITY_MAP[keys[i]];
    for (var j = 0; j < patterns.length; j++) {
      if (upper.indexOf(patterns[j]) === 0) return keys[i];
    }
  }
  return null;
}

// ── Aggregate CSV rows into weekly totals by commodity ──────────
function aggregateWeekly(rows, headers) {
  // Strip surrounding quotes from all header names (FGIS CSV uses quoted headers)
  headers = headers.map(function(h){ return h.replace(/^"+|"+$/g,'').trim(); });

  var dateCol  = findCol(headers, ['Thursday','Week Ending Date','Week Ending','Cert Date','DATE','Date']);
  var commCol  = findCol(headers, ['Grain','Commodity','COMMODITY','commodity','GRAIN']);
  var qtyCol   = findQtyCol(headers);

  console.log('Columns — date:' + dateCol + ' comm:' + commCol + ' qty:' + qtyCol);
  console.log('All headers: ' + headers.join(' | '));
  console.log('First row sample: ' + JSON.stringify(rows[0]));
  if (!dateCol || !commCol) {
    return {};
  }

  var byWeek = {};  // { dateStr: { Corn:0, AllWheat:0, Soybeans:0 } }

  rows.forEach(function(row) {
    var dateStr = row[dateCol] || '';
    var commRaw = row[commCol] || '';
    var qty     = parseFloat((row[qtyCol] || '0').replace(/,/g,'')) || 0;

    var group = matchCommodity(commRaw);
    if (!group || !dateStr) return;

    if (!byWeek[dateStr]) {
      byWeek[dateStr] = { Corn:0, 'All Wheat':0, Soybeans:0 };
    }
    byWeek[dateStr][group] = (byWeek[dateStr][group] || 0) + qty;
  });

  return byWeek;
}

// ── Sort dates descending and return 4-week slice ───────────────
function parseDate(str) {
  // Handle YYYYMMDD format (e.g. 20260101)
  if (/^\d{8}$/.test(str)) {
    return new Date(str.slice(0,4) + '-' + str.slice(4,6) + '-' + str.slice(6,8));
  }
  // Handle MM/DD/YYYY format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    var p = str.split('/');
    return new Date(p[2] + '-' + p[0] + '-' + p[1]);
  }
  return new Date(str);
}

function fmtDate(str) {
  var dt = parseDate(str);
  if (isNaN(dt)) return str;
  return dt.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function buildHistory(byWeek) {
  var dates = Object.keys(byWeek).sort(function(a, b) {
    return parseDate(b) - parseDate(a);
  });

  var recent = dates.slice(0, 4);
  return recent.map(function(d) {
    var totals = byWeek[d];
    return {
      date:     fmtDate(d),
      rawDate:  d,
      corn:     totals['Corn']      || 0,
      wheat:    totals['All Wheat'] || 0,
      soybeans: totals['Soybeans']  || 0,
    };
  });
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
    console.log('Fetching FGIS CY2026 CSV...');
    var resp = await fetch(CSV_URL_2026, {
      headers: { 'Accept': 'text/csv, text/plain, */*' }
    });
    console.log('FGIS CSV response: HTTP ' + resp.status);
    if (!resp.ok) throw new Error('FGIS CSV fetch failed: HTTP ' + resp.status);

    var text = await resp.text();
    console.log('CSV length: ' + text.length + ' chars, first 200: ' + text.slice(0,200));

    var rows = parseCsv(text);
    console.log('Parsed ' + rows.length + ' rows');
    if (rows.length === 0) throw new Error('Empty CSV');

    var csvHeaders = Object.keys(rows[0]);
    var byWeek = aggregateWeekly(rows, csvHeaders);
    var history = buildHistory(byWeek);

    console.log('Weeks found: ' + Object.keys(byWeek).length);
    console.log('Latest week: ' + (history[0] ? history[0].rawDate : 'none'));

    // Also fetch prior year for YoY comparison (best effort)
    var priorYearWeek = null;
    try {
      var resp25 = await fetch(CSV_URL_2025, { headers: { 'Accept': 'text/csv, */*' } });
      if (resp25.ok) {
        var text25 = await resp25.text();
        var rows25 = parseCsv(text25);
        var byWeek25 = aggregateWeekly(rows25, Object.keys(rows25[0] || {}));
        // Find same calendar week from last year
        if (history[0]) {
          var latestDate = new Date(history[0].rawDate);
          var targetDate = new Date(latestDate);
          targetDate.setFullYear(targetDate.getFullYear() - 1);
          // Find closest week in prior year
          var priorDates = Object.keys(byWeek25).sort(function(a,b){ return new Date(a)-new Date(b); });
          var closest = priorDates.reduce(function(prev, curr) {
            return Math.abs(new Date(curr) - targetDate) < Math.abs(new Date(prev) - targetDate) ? curr : prev;
          }, priorDates[0]);
          if (closest) priorYearWeek = byWeek25[closest];
        }
      }
    } catch(e) {
      console.log('Prior year fetch failed: ' + e.message);
    }

    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        reportDate:    history[0] ? history[0].date : 'Latest',
        history:       history,
        priorYearWeek: priorYearWeek,
        fetchedAt:     new Date().toISOString(),
        source:        'USDA FGIS ExportGrainReport CY2026.csv',
        note:          'Soy Meal and Soy Oil not available — FGIS covers bulk grain only'
      })
    };

  } catch(e) {
    console.error('exportinspections error: ' + e.message);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
