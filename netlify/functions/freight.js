// Freight function - reads from Supabase freight_data table
// Updated manually via admin or automatically when a scrape source is available
const SUPABASE_URL  = 'https://raiaqevgkfxvdlcblutc.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhaWFxZXZna2Z4dmRsY2JsdXRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4OTQ5NDEsImV4cCI6MjA5MjQ3MDk0MX0.CdHIhZtVieywyxbQipQoQWd42z7ewW3NZTUpDjICZdM';

// Fallback static data - update this weekly if Supabase row not present
const STATIC_DATA = {
  date: '30 Apr 2026',
  bdi:  { level: 2686, change: 16,  earnings: null },
  bci:  { level: 4327, change: 44,  earnings: 35741 },
  bpi:  { level: 1992, change: 13,  earnings: 17930 },
  bsi:  { level: 1525, change: -9,  earnings: 19278 },
  bhsi: { level: 814,  change: 3,   earnings: 14656 },
  grainRoutes: [
    { route: 'US Gulf - Japan',    vessel: 'Panamax',   desc: 'USGC corn/soy to Japan',          usd_mt: 77.0, note: 'Ref: BPI P6' },
    { route: 'PNW - Japan/Korea',  vessel: 'Panamax',   desc: 'PNW wheat/corn to Far East',       usd_mt: 46.2, note: 'Ref: BPI P3' },
    { route: 'Brazil - China',     vessel: 'Panamax',   desc: 'Santos soybeans to China',         usd_mt: 89.7, note: 'Ref: BPI P4' },
    { route: 'Black Sea - Med',    vessel: 'Supramax',  desc: 'Black Sea wheat to Med/N Africa',  usd_mt: 42.1, note: 'Ref: BSI S2' },
    { route: 'US Gulf - N Europe', vessel: 'Supramax',  desc: 'USGC grains to NW Europe',         usd_mt: 70.3, note: 'Ref: BSI S1B' },
  ]
};

exports.handler = async () => {
  try {
    // Try to get latest from Supabase freight_data table
    const resp = await fetch(
      SUPABASE_URL + '/rest/v1/freight_data?order=created_at.desc&limit=1',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );

    if (resp.ok) {
      const rows = await resp.json();
      if (rows && rows.length > 0 && rows[0].data) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
          body: JSON.stringify({ ...rows[0].data, source: 'Manual update', fetchedAt: rows[0].created_at })
        };
      }
    }
  } catch(e) {
    // Fall through to static data
  }

  // Return static fallback
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify({ ...STATIC_DATA, source: 'Static fallback - update in admin', fetchedAt: new Date().toISOString() })
  };
};
