// netlify/functions/pdf-convert.js
// Proxies PDF-to-HTML conversion through Anthropic API server-side
// Requires ANTHROPIC_API_KEY in Netlify environment variables

exports.handler = async (event) => {
  var noCache = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: noCache, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: noCache, body: JSON.stringify({ error: 'Method not allowed' }) };

  var apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return { statusCode: 500, headers: noCache, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Netlify environment variables' }) };

  var body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: noCache, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  var systemPrompt = body.system || '';
  var base64       = body.base64 || '';
  var filename     = body.filename || 'document.pdf';

  console.log('pdf-convert: processing ' + filename + ' system length: ' + systemPrompt.length);

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [{
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 }
          },{
            type: 'text',
            text: 'Convert this market commentary PDF to styled HTML. File: ' + filename
          }]
        }]
      })
    });

    var text = await resp.text();
    console.log('Anthropic status: ' + resp.status + ' body[:100]: ' + text.slice(0, 100));

    if (!resp.ok) {
      return { statusCode: 500, headers: noCache, body: JSON.stringify({ error: 'Anthropic API error ' + resp.status + ': ' + text.slice(0, 200) }) };
    }

    return { statusCode: 200, headers: noCache, body: text };

  } catch(e) {
    console.error('pdf-convert error: ' + e.message);
    return { statusCode: 500, headers: noCache, body: JSON.stringify({ error: e.message }) };
  }
};
