exports.handler = async (event) => {
  const params = { ...event.queryStringParameters } || {};
  const endpoint = params.endpoint || '';
  delete params.endpoint;
  const qs = new URLSearchParams(params).toString();

  // USDA FAS OpenData API — correct base URL is OpenData not opendataweb
  const url = `https://apps.fas.usda.gov/OpenData/api/esr/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`USDA ESR returned ${res.status}`);
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
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
