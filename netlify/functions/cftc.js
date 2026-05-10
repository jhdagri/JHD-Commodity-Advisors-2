// netlify/functions/cftc.js
// Proxy for CFTC Public Reporting Environment (Disaggregated COT)
// Env var required: CFTC_APP_TOKEN (Socrata app token from publicreporting.cftc.gov)

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  
  // Build query string from frontend params
  const qs = new URLSearchParams(params).toString();
  
  // CFTC Disaggregated COT — Options & Futures Combined (ag_sof report)
  const baseUrl = 'https://publicreporting.cftc.gov/resource/kh3c-gbw2.json';
  const url = qs ? baseUrl + '?' + qs : baseUrl;

  // Socrata app token — bypasses IP throttling on cloud server IPs
  const appToken = process.env.CFTC_APP_TOKEN || '';

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'JHD-Commodity-Advisors/1.0',
    'X-App-Token': appToken
  };

  try {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('CFTC returned ' + res.status + ': ' + body.slice(0, 200));
    }

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

  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: e.message })
    };
  }
};
