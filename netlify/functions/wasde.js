// netlify/functions/wasde.js
// Uses native fetch (Node 18+) -- no require() calls, esbuild safe

exports.handler = async (event) => {
  var ct = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: ct, body: '' };

  var params   = event.queryStringParameters || {};
  var endpoint = params.endpoint || '';
  var apiKey   = process.env.USDA_API_KEY || 'g9sNI6gS6smHPA7IfnrK5zqw45f4xlFf0p1XxeNL';

  console.log('endpoint: ' + endpoint + ' apiKey length: ' + apiKey.length);

  if (!endpoint) return { statusCode: 400, headers: ct, body: JSON.stringify({ error: 'Missing endpoint' }) };

  var url = 'https://apps.fas.usda.gov/OpenData/api/psd/' + endpoint + '?API_KEY=' + apiKey;

  try {
    console.log('Trying: ' + url);
    var resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    var text = await resp.text();
    console.log('Status: ' + resp.status + ' body[:200]: ' + text.slice(0, 200));
    if (resp.ok) {
      return { statusCode: 200, headers: ct, body: text };
    }
    return { statusCode: 500, headers: ct, body: JSON.stringify({ error: 'HTTP ' + resp.status + ': ' + text.slice(0, 200) }) };
  } catch(e) {
    console.error('Fetch error: ' + e.message);
    return { statusCode: 500, headers: ct, body: JSON.stringify({ error: e.message }) };
  }
};
