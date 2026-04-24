exports.handler = async (event) => {
  const params = new URLSearchParams(event.queryStringParameters || {});
  const url = `https://publicreporting.cftc.gov/resource/jun7-fc8e.json?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'JHD-Agri/1.0' }
    });
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify(data)
    };
  } catch(e) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: e.message }) };
  }
};
