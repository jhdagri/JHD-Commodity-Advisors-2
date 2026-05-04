// USDA ESRQS - free XML, no auth, updates every Thursday
const XML_URL = 'https://apps.fas.usda.gov/esrqs/StaticReports/CWRCommoditySummary.xml';

const WANTED = [
  'ALL WHEAT', 'CORN', 'SOYBEANS', 'SOYBEAN CAKE AND MEAL',
  'SOYBEAN OIL', 'COTTON - UPLAND'
];

const LABELS = {
  'ALL WHEAT':             'All Wheat',
  'CORN':                  'Corn',
  'SOYBEANS':              'Soybeans',
  'SOYBEAN CAKE AND MEAL': 'Soy Meal',
  'SOYBEAN OIL':           'Soy Oil',
  'COTTON - UPLAND':       'Cotton',
};

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

function num(s) {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

exports.handler = async () => {
  try {
    const resp = await fetch(XML_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JHD-Agri/1.0)' }
    });
    if (!resp.ok) throw new Error('USDA fetch failed: ' + resp.status);

    const xml = await resp.text();
    const tagRx = /<Details\s[^>]+\/?>/g;
    const rows = [];
    let m;
    while ((m = tagRx.exec(xml)) !== null) {
      const t = m[0];
      rows.push({
        name:      attr(t, 'CommodityName'),
        date:      attr(t, 'PeriodEndingDate'),
        myear:     attr(t, 'MarketingYear'),
        week:      attr(t, 'MarketingYearWeekNumber'),
        netSales:  num(attr(t, 'NetSales')),
        exports:   num(attr(t, 'WeeklyExports')),
        outstand:  num(attr(t, 'OutstandingSales')),
        accum:     num(attr(t, 'AccumulatedExports')),
        total:     num(attr(t, 'TotalCommitment')),
        prevAccum: num(attr(t, 'PreviousMKTYearAccumulatedExports')),
        nextOut:   num(attr(t, 'NextMKTYearOutstandingSales')),
        nextNet:   num(attr(t, 'NextMKTYearNetSales')),
        wasde:     num(attr(t, 'WASDEReportProjectionsQuantity')),
      });
    }

    const dates = [...new Set(rows.map(r => r.date))].sort();
    const latestDate = dates[dates.length - 1];
    const recentDates = dates.slice(-4);

    const summary = {};
    const history = {};

    for (const want of WANTED) {
      const commRows = rows.filter(r => r.name === want);
      if (!commRows.length) continue;
      const label = LABELS[want];

      const latest = commRows.find(r => r.date === latestDate);
      if (latest) {
        const pctUsda = (latest.wasde > 0 && latest.accum)
          ? Math.round((latest.accum / (latest.wasde * 1000)) * 1000) / 10
          : null;
        const vsYrAgo = (latest.accum && latest.prevAccum)
          ? Math.round((latest.accum / latest.prevAccum - 1) * 1000) / 10
          : null;

        summary[label] = {
          date: latest.date, week: latest.week, myear: latest.myear,
          netSales: latest.netSales, nextNet: latest.nextNet,
          exports: latest.exports, outstanding: latest.outstand,
          accumulated: latest.accum, totalCommit: latest.total,
          pctUsda, vsYrAgo,
        };
      }

      history[label] = [...recentDates].reverse().map(d => {
        const r = commRows.find(row => row.date === d);
        return r ? { date: r.date, netSales: r.netSales, nextNet: r.nextNet, exports: r.exports, accumulated: r.accum, outstanding: r.outstand } : null;
      }).filter(Boolean).reverse();
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: JSON.stringify({ reportDate: latestDate, summary, history, source: 'USDA ESRQS', fetchedAt: new Date().toISOString() })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
