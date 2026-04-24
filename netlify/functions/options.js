exports.handler = async (event) => {
  const { symbol, date } = event.queryStringParameters || {};
  if (!symbol) return { statusCode: 400, body: JSON.stringify({ error: 'Missing symbol' }) };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com'
  };

  try {
    // Step 1: get a crumb cookie
    const cookieRes = await fetch('https://fc.yahoo.com', { headers });
    const rawCookies = cookieRes.headers.get('set-cookie') || '';
    const cookieStr = rawCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');

    // Step 2: fetch the crumb
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/finance/getCrumb', {
      headers: { ...headers, 'Cookie': cookieStr }
    });
    const crumb = (await crumbRes.text()).trim();

    // Step 3: fetch options chain
    let url = `https://query1.finance.yahoo.com/v8/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}`;
    if (date) url += `&date=${date}`;

    const optRes = await fetch(url, {
      headers: { ...headers, 'Cookie': cookieStr }
    });

    if (!optRes.ok) throw new Error(`Yahoo returned ${optRes.status}`);
    const data = await optRes.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60'
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
