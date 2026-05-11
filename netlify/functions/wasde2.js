// netlify/functions/wasde2.js
// Fetches USDA WASDE CSV -- free, no API key, no auth
// www.usda.gov/sites/default/files/documents/oce-wasde-report-data-YYYY-MM.csv
const https = require('https');
const urlMod = require('url');

var TABLES = {
  corn_us:    'U.S. Feed Grain and Corn Supply and Use',
  corn_world: 'World Corn Supply and Use',
  wheat_us:   'U.S. Wheat Supply and Use',
  wheat_world:'World Wheat Supply and Use',
  soy_us:     'U.S. Soybeans and Products Supply and Use (Domestic Measure)',
  soy_world:  'World Soybean Supply and Use'
};
var YEARS        = ['2023/24','2024/25','2025/26'];
var US_ATTRS     = ['Beginning Stocks','Production','Imports','Supply, Total','Domestic, Total','Exports','Ending Stocks','Avg. Farm Price'];
var WORLD_ATTRS  = ['Beginning Stocks','Production','Imports','Domestic Total','Exports','Ending Stocks'];
var WORLD_REGIONS= ['World','United States','Brazil','Argentina','China','European Union','Ukraine','Russia','Australia','Canada'];

exports.handler = async (event) => {
  var noCache = { 'Content-Type':'application/json','Cache-Control':'no-store' };
  var cache   = { 'Content-Type':'application/json','Cache-Control':'public, max-age=7200' };
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:noCache, body:'' };

  // Build candidate CSV URLs (current month then previous 2)
  var now = new Date();
  var candidates = [];
  for (var i = 0; i < 3; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var yr = d.getFullYear();
    var mo = d.getMonth() + 1;
    candidates.push('https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-' + yr + '-' + (mo<10?'0':'') + mo + '.csv');
  }

  var csvText = '';
  var usedUrl = '';
  for (var j = 0; j < candidates.length; j++) {
    try {
      console.log('Trying: ' + candidates[j]);
      csvText = await getText(candidates[j]);
      if (csvText.length > 1000) { usedUrl = candidates[j]; break; }
    } catch(e) { console.log('Failed: ' + e.message); }
  }

  if (!csvText) return { statusCode:500, headers:noCache, body:JSON.stringify({ error:'Could not fetch WASDE CSV' }) };

  try {
    var rows = parseCSV(csvText);
    console.log('CSV rows: ' + rows.length);

    var reportDate = rows.length ? rows[0]['ReportDate'] : '';
    var result = { reportDate:reportDate, source:usedUrl };

    for (var key in TABLES) {
      var title = TABLES[key];
      var trows = rows.filter(function(r){ return r['ReportTitle'] === title; });
      var isWorld = key.indexOf('world') > -1;
      var attrs = isWorld ? WORLD_ATTRS : US_ATTRS;

      if (isWorld) {
        result[key] = {};
        for (var ri = 0; ri < WORLD_REGIONS.length; ri++) {
          var region = WORLD_REGIONS[ri];
          var rrows = trows.filter(function(r){ return r['Region'] === region; });
          if (!rrows.length) continue;
          result[key][region] = { unit: rrows[0]['Unit'] };
          for (var yi = 0; yi < YEARS.length; yi++) {
            var yr2 = YEARS[yi];
            result[key][region][yr2] = {};
            for (var ai = 0; ai < attrs.length; ai++) {
              var attr = attrs[ai];
              var match = rrows.filter(function(r){ return r['Attribute'] === attr && r['MarketYear'] === yr2; });
              if (match.length) result[key][region][yr2][attr] = match[0]['Value'];
            }
          }
        }
      } else {
        var usRows = trows.filter(function(r){ return r['Region'] === 'United States'; });
        result[key] = { unit: usRows.length ? usRows[0]['Unit'] : '' };
        for (var yi2 = 0; yi2 < YEARS.length; yi2++) {
          var yr3 = YEARS[yi2];
          result[key][yr3] = {};
          for (var ai2 = 0; ai2 < attrs.length; ai2++) {
            var attr2 = attrs[ai2];
            var match2 = usRows.filter(function(r){ return r['Attribute'] === attr2 && r['MarketYear'] === yr3; });
            if (match2.length) result[key][yr3][attr2] = match2[0]['Value'];
          }
        }
      }
    }

    console.log('Built result for: ' + Object.keys(result).join(', '));
    return { statusCode:200, headers:cache, body:JSON.stringify(result) };

  } catch(e) {
    console.error('Error: ' + e.message);
    return { statusCode:500, headers:noCache, body:JSON.stringify({ error:e.message }) };
  }
};

function getText(url) {
  return new Promise(function(resolve, reject) {
    var p = urlMod.parse(url);
    var req = https.request({ hostname:p.hostname, path:p.path, method:'GET',
      headers:{ 'User-Agent':'Mozilla/5.0','Accept':'*/*' }
    }, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return getText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
      var body = '';
      res.on('data', function(c){ body += c; });
      res.on('end', function(){ resolve(body); });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseCSV(text) {
  var lines = text.split('\n');
  if (lines.length < 2) return [];
  var headers = splitLine(lines[0]);
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var vals = splitLine(line);
    var obj = {};
    for (var j = 0; j < headers.length; j++) obj[headers[j].trim()] = (vals[j]||'').trim();
    out.push(obj);
  }
  return out;
}

function splitLine(line) {
  var res=[]; var cur=''; var inQ=false;
  for (var i=0;i<line.length;i++) {
    var ch=line[i];
    if(ch==='"'){inQ=!inQ;}
    else if(ch===','&&!inQ){res.push(cur);cur='';}
    else{cur+=ch;}
  }
  res.push(cur);
  return res;
}
