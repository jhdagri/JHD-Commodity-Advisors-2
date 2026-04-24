exports.handler = async (event) => {
  const params = { ...event.queryStringParameters } || {};
  
  // Support switching between CFTC datasets
  // jun7-fc8e = Legacy Futures Only
  // kh3c-gbw2 = Disaggregated Futures & Options Combined (ag_sof)
  const dataset = params.$dataset || 'kh3c-gbw2';
  delete params.$dataset;

  const qs = new URLSearchParams(params).toString();
  const url = `https://publicreporting.cftc.gov/resource/${dataset}.json?${qs}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'JHD-Commodity-Advisors/1.0' }
    });
    const data = await res.json();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      },
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
