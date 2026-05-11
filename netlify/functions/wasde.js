// netlify/functions/wasde.js — USDA FAS OpenData v2 API
const https = require('https');
const urlMod = require('url');

exports.handler = async (event) => {
  var noCache = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  var cache   = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: noCache, body: '' };

  var params   = event.queryStringParameters || {};
  var endpoint = params.endpoint || '';
  var apiKey   = process.env.USDA_API_KEY || 'g9sNI6gS6smHPA7IfnrK5zqw45f4xlFf0p1XxeNL';

  console.log('START endpoint: ' + endpoint + ' apiKey length: ' + apiKey.length);
  if (!endpoint) return { statusCode: 400, headers: noCache, body: JSON.stringify({ error: 'Missing endpoint' }) };

  // v2 API — no /OpenData/ prefix
  var url = 'https://apps.fas.usda.gov/api/psd/' + endpoint;
  console.log('Trying: ' + url);

  try {
    var data = await get(url, { 'X-Api-Key': apiKey, 'Accept': 'application/json' });
    console.log('Success, records: ' + (Array.isArray(data) ? data.length : typeof data));
    return { statusCode: 200, headers: cache, body: JSON.stringify(data) };
  } catch(e) {
    console.error('Failed: ' + e.message);
    return { statusCode: 500, headers: noCache, body: JSON.stringify({ error: e.message }) };
  }
};

function get(apiUrl, headers) {
  return new Promise(function(resolve, reject) {
    var p = urlMod.parse(apiUrl);
    var req = https.request({ hostname: p.hostname, path: p.path, method: 'GET', headers: headers }, function(res) {
      var body = '';
      res.on('data', function(c){ body += c; });
      res.on('end', function() {
        console.log('HTTP ' + res.statusCode + ' body[:200]: ' + body.slice(0, 200));
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 200)));
        try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Bad JSON: ' + body.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
