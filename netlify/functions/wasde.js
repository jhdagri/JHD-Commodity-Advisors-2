exports.handler = async (event) => {
  const params = { ...event.queryStringParameters } || {};
  const endpoint = params.endpoint || '';
  delete params.endpoint;

  // Pass API key as query parameter — USDA FAS requires this format
  params.api_key = 'P89EyAIRlHSpwoTlvk5no6SjWqlsVQhgbZIf27sX';
  const qs = new URLSearchParams(params).toString();

  const url = `https://api.fas.usda.gov/api/psd/${endpoint}?${qs}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'JHD-Commodity-Advisors/1.0' }
    });
    if (!res.ok) throw new Error(`USDA PSD returned ${res.status}`);
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' },
      body: JSON.stringify(data)
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message, url })
    };
  }
};
