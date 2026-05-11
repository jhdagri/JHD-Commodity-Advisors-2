// netlify/functions/wasde.js
// CORS is handled by netlify.toml [[headers]] -- do NOT set CORS headers here
const https = require('https');
const urlMod = require('url');

exports.handler = async (event) => {
  var ct = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: ct, body: '' };

  var params   = event.queryStringParameters || {};
  var endpoint = params.endpoint || '';
  var apiKey   = process.env.USDA_API_KEY || 'bEC1iNBuZZssM4hSrY4X8bFZSJWqEPvcyCo1iV6t';

  console.log('apiKey length: ' + apiKey.length + ' endpoint: ' + endpoint);

  if (!endpoint) return { statusCode: 400, headers: ct, body: JSON.stringify({ error: 'Missing endpoint' }) };

  var urls = [
    'https://apps.fas.usda.gov/psdonline/api/' + endpoint + '?API_KEY=' + apiKey,
    'https://apps.fas.usda.gov/OpenData/api/psd/' + endpoint + '?API_KEY=' + apiKey
  ];

  var lastErr = '';
  for (var i = 0; i < urls.length; i++) {
    try {
      console.log('Trying URL ' + (i+1) + ': ' + urls[i]);
      var data = await get(urls[i], { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' });
      console.log('Success from URL ' + (i+1) + ', records: ' + (Array.isArray(data) ? data.length : typeof data));
      return { statusCode: 200, headers: ct, body: JSON.stringify(data) };
    } catch(e) {
      console.error('URL ' + (i+1) + ' failed: ' + e.message);
      lastErr = e.message;
    }
  }
  return { statusCode: 500, headers: ct, body: JSON.stringify({ error: lastErr }) };
};

function get(apiUrl, headers) {
  return new Promise(function(resolve, reject) {
    var p = urlMod.parse(apiUrl);
    var req = https.request({ hostname: p.hostname, path: p.path, method: 'GET', headers: headers }, function(res) {
      var body = '';
      res.on('data', function(c){ body += c; });
      res.on('end', function() {
        console.log('HTTP status: ' + res.statusCode + ' body[:200]: ' + body.slice(0,200));
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0,200)));
        try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Bad JSON: ' + body.slice(0,80))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
