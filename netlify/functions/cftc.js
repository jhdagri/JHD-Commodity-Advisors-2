exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  
  // Route to different USDA APIs based on source param
  const source = params.source || 'cftc';
  delete params.source;
  
  let url;
  if (source === 'esr') {
    // USDA FAS Export Sales API
    const { endpoint, ...rest } = params;
    const qs = new URLSearchParams(rest).toString();
    url = `https://apps.fas.usda.gov/opendataweb/api/esr/${endpoint}${qs ? '?' + qs : ''}`;
  } else if (source === 'esrweekly') {
    // Weekly ESR summary
    const qs = new URLSearchParams(params).toString();
    url = `https://apps.fas.usda.gov/opendataweb/api/esr/weeklyData${qs ? '?' + qs : ''}`;
  } else {
    // Default: CFTC Disaggregated COT
    const qs = new URLSearchParams(params).toString();
    url = `https://publicreporting.cftc.gov/resource/kh3c-gbw2.json?${qs}`;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JHD-Commodity-Advisors/1.0'
      }
    });
    if (!res.ok) throw new Error(`API returned ${res.status} for ${url}`);
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
      body: JSON.stringify({ error: e.message, url })
    };
  }
};
