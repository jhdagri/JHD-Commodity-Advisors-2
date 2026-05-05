// Scrapes handybulk.com for daily Baltic indices
const URL = 'https://www.handybulk.com/baltic-dry-index/';

function extractIndex(text, name, abbr) {
  // Match e.g. "Baltic Dry Index (BDI) increased by 16 points to reach 2,686 points"
  // or "decreased by 8 points to reach 1,882 points"
  const rxLevel = new RegExp(abbr + '\\)\\s+(?:increased|decreased|stayed at)\\s+(?:by \\d[\\d,]* points )?(?:to reach|at)\\s+([\\d,]+)\\s+points', 'i');
  const mLevel = text.match(rxLevel);
  const level = mLevel ? parseInt(mLevel[1].replace(/,/g, '')) : null;

  // Match change: "increased by 16 points" or "decreased by 8 points"
  const rxChg = new RegExp(abbr + '\\)\\s+(increased|decreased|stayed)\\s+(?:by ([\\d,]+) points)?', 'i');
  const mChg = text.match(rxChg);
  let change = null;
  if (mChg) {
    const pts = mChg[2] ? parseInt(mChg[2].replace(/,/g, '')) : 0;
    change = mChg[1].toLowerCase() === 'increased' ? pts : mChg[1].toLowerCase() === 'decreased' ? -pts : 0;
  }

  // Daily earnings e.g. "average daily earnings for capesize bulk carriers increased by $401 to $35,741"
  const rxEarn = new RegExp('daily (?:earnings|income) for ' + name + '[^$]+\\$([\\d,]+)', 'i');
  const mEarn = text.match(rxEarn);
  const earnings = mEarn ? parseInt(mEarn[1].replace(/,/g, '')) : null;

  return { level, change, earnings };
}

function extractDate(text) {
  const m = text.match(/(\d{1,2}-[A-Za-z]+-\d{4})/);
  return m ? m[1] : null;
}

exports.handler = async () => {
  try {
    const resp = await fetch(URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JHD-Agri/1.0)' }
    });
    if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);

    const html = await resp.text();

    // Get the first content block (latest day)
    const bodyStart = html.indexOf('<h1>Baltic Dry Index</h1>');
    const relevantText = bodyStart > -1 ? html.slice(bodyStart, bodyStart + 3000) : html.slice(0, 3000);

    // Strip HTML tags for easier parsing
    const text = relevantText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const date    = extractDate(text);
    const bdi     = extractIndex(text, 'dry index', 'BDI');
    const bci     = extractIndex(text, 'capesize bulk carriers', 'BCI');
    const bpi     = extractIndex(text, 'panamax bulk', 'BPI');
    const bsi     = extractIndex(text, 'supramax bulk carriers', 'BSI');
    const bhsi    = extractIndex(text, 'handysize bulk carriers', 'BHSI');

    // Key grain routes - static reference values (update periodically)
    // These reflect typical ranges and are contextual benchmarks
    const grainRoutes = [
      { route: 'US Gulf - Japan', vessel: 'Panamax', desc: 'USGC corn/soy to Japan', usd_mt: null, note: 'Ref: BPI P6' },
      { route: 'PNW - Japan/Korea', vessel: 'Panamax', desc: 'PNW wheat/corn to Far East', usd_mt: null, note: 'Ref: BPI P3' },
      { route: 'Brazil - China', vessel: 'Panamax', desc: 'Santos soybeans to China', usd_mt: null, note: 'Ref: BPI P4' },
      { route: 'Black Sea - Med', vessel: 'Supramax', desc: 'Black Sea wheat to Med/N Africa', usd_mt: null, note: 'Ref: BSI S2' },
      { route: 'US Gulf - N Europe', vessel: 'Supramax', desc: 'USGC grains to NW Europe', usd_mt: null, note: 'Ref: BSI S1B' },
    ];

    // Estimate $/MT grain routes from BPI/BSI daily earnings
    // Rule of thumb: Panamax ~70k MT cargo, Supramax ~55k MT
    if (bpi.earnings) {
      const voyageDays = 30; // approx USGC-Japan
      grainRoutes[0].usd_mt = Math.round((bpi.earnings * voyageDays) / 70000 * 10) / 10;
      grainRoutes[1].usd_mt = Math.round((bpi.earnings * 18) / 70000 * 10) / 10;
      grainRoutes[2].usd_mt = Math.round((bpi.earnings * 35) / 70000 * 10) / 10;
    }
    if (bsi.earnings) {
      grainRoutes[3].usd_mt = Math.round((bsi.earnings * 12) / 55000 * 10) / 10;
      grainRoutes[4].usd_mt = Math.round((bsi.earnings * 20) / 55000 * 10) / 10;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: JSON.stringify({
        date, bdi, bci, bpi, bsi, bhsi,
        grainRoutes,
        source: 'HandyBulk / Baltic Exchange',
        fetchedAt: new Date().toISOString()
      })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
