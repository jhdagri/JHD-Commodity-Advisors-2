// netlify/functions/wasde.js
// Proxy for USDA FAS PSD Online API
// Env var required: USDA_API_KEY

const https = require('https');
const url   = require('url');

exports.handler = async (event) => {

  var requestOrigin = (event.headers && (event.headers['origin'] || event.headers['Origin'])) || '*';
  var corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Cache-Control': 'public, max-age=3600'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  var params   = event.queryStringParameters || {};
  var endpoint = params.endpoint || '';
  var apiKey   = process.env.USDA_API_KEY || '';

  if (!endpoint) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing endpoint parameter' }) };
  }

  // Append API key as query param
  var apiUrl = 'https://apps.fas.usda.gov/psdonline/api/psd/' + endpoint + '?api_key=' + apiKey;

  try {
    var data = await httpsGet(apiUrl, {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; JHD-Commodity-Advisors/1.0)'
    });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }
};

function httpsGet(apiUrl, headers) {
  return new Promise(function(resolve, reject) {
    var parsed = url.parse(apiUrl);
    var options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'GET',
      headers: headers
    };
    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        if (res.statusCode >= 400) {
          return reject(new Error('USDA returned ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
