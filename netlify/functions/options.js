exports.handler = async (event) => {
  const { symbol, date } = event.queryStringParameters || {};
  if (!symbol) return { statusCode: 400, body: JSON.stringify({ error: 'Missing symbol' }) };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Retry up to 3 times with increasing delays
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await sleep(attempt * 1500);

      // Step 1: get cookie
      const cookieRes = await fetch('https://fc.yahoo.com', { headers });
      const rawCookies = cookieRes.headers.get('set-cookie') || '';
      const cookieStr = rawCookies.split(',').map(c => c.split(';')[0].trim()).join('; ');

      // Step 2: get crumb
      const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/finance/getCrumb', {
        headers: { ...headers, 'Cookie': cookieStr }
      });
      if (crumbRes.status === 429) { await sleep(2000); continue; }
      const crumb = (await crumbRes.text()).trim();
      if (!crumb || crumb.includes('{')) continue;

      // Step 3: fetch options
      let url = `https://query1.finance.yahoo.com/v8/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}&formatted=false&lang=en-US&region=US`;
      if (date) url += `&date=${date}`;

      const optRes = await fetch(url, { headers: { ...headers, 'Cookie': cookieStr } });
      if (optRes.status === 429) { await sleep(2000); continue; }
      if (!optRes.ok) throw new Error(`Yahoo returned ${optRes.status}`);

      const data = await optRes.json();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300'
        },
        body: JSON.stringify(data)
      };
    } catch(e) {
      if (attempt === 2) return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: e.message })
      };
    }
  }

  return {
    statusCode: 429,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'Rate limited by Yahoo — try again in a few seconds' })
  };
};
