import pdf from 'pdf-parse/lib/pdf-parse.js';

const PDF_URL = 'https://www.cmegroup.com/trading/agricultural/files/ht_charts/grnxpts_cbt.pdf';

// Parse a number string like "2,069,632" -> 2069632
function parseNum(s) {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Parse a pct string like "74.8%" -> 74.8
function parsePct(s) {
  if (!s) return null;
  const n = parseFloat(s.replace('%', ''));
  return isNaN(n) ? null : n;
}

function parseSummary(text) {
  // Match summary rows: "Corn 2,069,632 60,000 2,129,632 Above 83,839,991 74.8% 69.2%"
  const commodities = ['Corn', 'Soybeans', 'Soymeal', 'Soybean Oil', 'Wheat', 'Cotton'];
  const results = {};

  for (const comm of commodities) {
    // Escape special chars for regex
    const esc = comm.replace(' ', '\\s+');
    const rx = new RegExp(
      esc + '\\s+([\\d,]+)\\s+([\\d,]+)\\s+([\\d,]+)\\s+(Above|Below|Inside|-)\\s+([\\d,]+)\\s+([\\d.]+%)\\s+([\\d.]+%)',
      'i'
    );
    const m = text.match(rx);
    if (m) {
      results[comm] = {
        current:    parseNum(m[1]),
        next:       parseNum(m[2]),
        total:      parseNum(m[3]),
        vs_est:     m[4],
        cumulative: parseNum(m[5]),
        pct_usda:   parsePct(m[6]),
        pct_5yr:    parsePct(m[7]),
      };
    }
  }
  return results;
}

function parseHistory(text, commodity) {
  // Match weekly history rows after the commodity name
  // e.g. "5-Feb 2,069,632 60,000 2,129,632 60,804,585 26,070,718 74.8% 69.2% 692,405"
  const weekRow = /(\d{1,2}-[A-Za-z]{3})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+%)\s+([\d.]+%)\s+([\d,]+)/g;

  // Find section for this commodity in the text
  const esc = commodity.replace(' ', '\\s+');
  const sectionRx = new RegExp(esc + '[\\s\\S]{0,2000}?(?=Soybeans|Soybean Meal|Soybean Oil|Wheat|Cotton|$)', 'i');
  const section = text.match(sectionRx);
  if (!section) return [];

  const rows = [];
  let m;
  while ((m = weekRow.exec(section[0])) !== null) {
    rows.push({
      week:        m[1],
      current:     parseNum(m[2]),
      next:        parseNum(m[3]),
      total:       parseNum(m[4]),
      cumulative:  parseNum(m[5]),
      outstanding: parseNum(m[6]),
      pct_usda:    parsePct(m[7]),
      pct_5yr:     parsePct(m[8]),
      pace_to_hit: parseNum(m[9]),
    });
    if (rows.length >= 4) break; // 4 weeks of history
  }
  return rows;
}

function parseTopBuyers(text, commodity) {
  // Find destination summary table for this commodity
  const esc = commodity.replace(' ', '\\s+');
  const sectionRx = new RegExp(
    esc + '\\s*-\\s*Top Buyers[\\s\\S]{0,800}?(?=Corn -|Soybeans -|Soymeal -|Soybean Oil -|Wheat -|Cotton -|USDA WEEKLY|$)',
    'i'
  );
  const sec = text.match(sectionRx);
  if (!sec) return [];

  const rowRx = /^([A-Z][a-zA-Z\s]+?)\s+([\d,]+|-[\d,]+)\s+(\d+)\s+([\d,]+|-[\d,]+)/gm;
  const buyers = [];
  let m;
  while ((m = rowRx.exec(sec[0])) !== null) {
    const name = m[1].trim();
    if (['Total', 'Destination', 'Current'].includes(name)) continue;
    buyers.push({ destination: name, current: parseNum(m[2]), next: parseNum(m[3]), total: parseNum(m[4]) });
    if (buyers.length >= 5) break;
  }
  return buyers;
}

function parseReportDate(text) {
  const m = text.match(/USDA WEEKLY EXPORT SALES\s+([A-Za-z]+ \d+,\s*\d{4})/i);
  return m ? m[1].trim() : null;
}

export const handler = async () => {
  try {
    const resp = await fetch(PDF_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JHD-Agri/1.0)' }
    });

    if (!resp.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: `CME fetch failed: ${resp.status}` })
      };
    }

    const buffer = await resp.arrayBuffer();
    const data = await pdf(Buffer.from(buffer));
    const text = data.text;

    const summary   = parseSummary(text);
    const reportDate = parseReportDate(text);

    const history = {
      Corn:         parseHistory(text, 'Corn'),
      Soybeans:     parseHistory(text, 'Soybeans'),
      Wheat:        parseHistory(text, 'Wheat'),
      Soymeal:      parseHistory(text, 'Soymeal'),
    };

    const topBuyers = {
      Corn:     parseTopBuyers(text, 'Corn'),
      Soybeans: parseTopBuyers(text, 'Soybeans'),
      Wheat:    parseTopBuyers(text, 'Wheat'),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600', // cache 1 hour
      },
      body: JSON.stringify({ reportDate, summary, history, topBuyers, fetchedAt: new Date().toISOString() })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
