exports.handler = async (event) => {
  const params = { ...event.queryStringParameters } || {};
  const endpoint = params.endpoint || '';
  delete params.endpoint;
  const qs = new URLSearchParams(params).toString();

  // USDA FAS PSD Online API — correct base URL
  const url = `https://apps.fas.usda.gov/psdonline/api/psd/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'API_KEY': 'P89EyAIRlHSpwoTlvk5no6SjWqlsVQhgbZIf27sX',
        'User-Agent': 'JHD-Commodity-Advisors/1.0'
      }
    });
    if (!res.ok) throw new Error(`USDA PSD returned ${res.status}`);
    const data = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      },
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
