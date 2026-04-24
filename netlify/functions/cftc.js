exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const qs = new URLSearchParams(params).toString();
  
  // CFTC Disaggregated COT — Options & Futures Combined (ag_sof report)
  const url = `https://publicreporting.cftc.gov/resource/kh3c-gbw2.json?${qs}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'JHD-Commodity-Advisors/1.0' }
    });
    if (!res.ok) throw new Error(`CFTC returned ${res.status}`);
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
      body: JSON.stringify({ error: e.message })
    };
  }
};
