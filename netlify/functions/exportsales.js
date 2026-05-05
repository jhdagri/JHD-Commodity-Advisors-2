// USDA ESRQS - CWR (oilseeds/wheat) + CGR (coarse grains incl. corn)
const CWR_URL = 'https://apps.fas.usda.gov/esrqs/StaticReports/CWRCommoditySummary.xml';
const CGR_URL = 'https://apps.fas.usda.gov/esrqs/StaticReports/CGRCommoditySummary.xml';

const LABELS = {
  'ALL WHEAT':             'All Wheat',
  'CORN':                  'Corn',
  'SOYBEANS':              'Soybeans',
  'SOYBEAN CAKE AND MEAL': 'Soy Meal',
  'SOYBEAN OIL':           'Soy Oil',
  'SORGHUM':               'Sorghum',
  'BARLEY':                'Barley',
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

function parseXml(xml) {
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
      nextNet:   num(attr(t, 'NextMKTYearNetSales')),
      wasde:     num(attr(t, 'WASDEReportProjectionsQuantity')),
    });
  }
  return rows;
}

exports.handler = async () => {
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; JHD-Agri/1.0)' };

    // Fetch both reports in parallel
    const [cwrResp, cgrResp] = await Promise.all([
      fetch(CWR_URL, { headers }),
      fetch(CGR_URL, { headers }),
    ]);

    const cwrXml = cwrResp.ok ? await cwrResp.text() : '';
    const cgrXml = cgrResp.ok ? await cgrResp.text() : '';

    // Combine rows from both reports
    const rows = [...parseXml(cwrXml), ...parseXml(cgrXml)];

    const dates = [...new Set(rows.map(r => r.date).filter(Boolean))].sort();
    const latestDate = dates[dates.length - 1];
    const recentDates = dates.slice(-4);

    const WANTED = Object.keys(LABELS);
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
