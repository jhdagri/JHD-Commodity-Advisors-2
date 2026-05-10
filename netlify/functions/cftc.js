// netlify/functions/cftc.js
// Proxy for CFTC Public Reporting Environment (Disaggregated COT)
// Uses https module (works on all Node versions, no native fetch needed)
// Reflects origin header to handle null from srcdoc iframes

const https = require('https');
const url   = require('url');

exports.handler = async (event) => {

  // Reflect origin back -- handles null from srcdoc iframes and all other origins
  const requestOrigin = (event.headers && (event.headers['origin'] || event.headers['Origin'])) || '*';
  const corsHeaders = {
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

  const params   = event.queryStringParameters || {};
  const appToken = process.env.CFTC_APP_TOKEN || '';

  const qs = new URLSearchParams(params);
  if (appToken) qs.set('$$app_token', appToken);

  const apiUrl = 'https://publicreporting.cftc.gov/resource/kh3c-gbw2.json?' + qs.toString();

  try {
    const data = await httpsGet(apiUrl, {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; JHD-Commodity-Advisors/1.0)',
      'X-App-Token': appToken
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
          return reject(new Error('CFTC returned ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
