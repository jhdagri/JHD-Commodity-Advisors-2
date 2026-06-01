// netlify/functions/notify-subscribers.js
// Triggered after a new post is published from the admin panel
// Fetches all subscribers from Supabase and sends via Resend
//
// Environment variables required (Netlify dashboard → Site configuration → Environment variables):
//   RESEND_API_KEY     = your Resend API key (re_...)
//   SUPABASE_URL       = https://raiaqevgkfxvdlcblutc.supabase.co
//   SUPABASE_SERVICE_KEY = your Supabase service role key (eyJ...)

exports.handler = async function(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CORS headers
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  var RESEND_KEY    = process.env.RESEND_API_KEY;
  var SUPABASE_URL  = process.env.SUPABASE_URL;
  var SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!RESEND_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Missing environment variables' }) };
  }

  // Parse post details from request body
  var body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  var postTitle    = body.title    || 'New Post';
  var postSummary  = body.summary  || '';
  var postCategory = body.category || '';
  var postUrl      = 'https://thebushel.jhdcommodityadvisors.com';

  // Strip any [PREMIUM:X] prefix from summary for email display
  postSummary = postSummary.replace(/^\[PREMIUM(:\d+)?\]\s*/, '');

  // Friendly category label
  var categoryLabels = {
    'commentary-wheat': 'Wheat Commentary',
    'commentary-corn':  'Corn Commentary',
    'commentary-soy':   'Soy Commentary',
    'market-outlook':   'Market Outlook',
    'technical':        'Technical Analysis',
    'trade-ideas':      'Trade Ideas'
  };
  var categoryLabel = categoryLabels[postCategory] || postCategory;

  // 1 — Fetch all subscribers from Supabase
  var subsResp;
  try {
    subsResp = await fetch(
      SUPABASE_URL + '/rest/v1/subscribers?select=email&order=created_at.asc',
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch(e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Supabase fetch failed: ' + e.message }) };
  }

  var subscribers;
  try {
    subscribers = await subsResp.json();
  } catch(e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Supabase response parse failed' }) };
  }

  if (!Array.isArray(subscribers) || subscribers.length === 0) {
    return { statusCode: 200, headers: headers, body: JSON.stringify({ message: 'No subscribers to notify', sent: 0 }) };
  }

  var emails = subscribers.map(function(s) { return s.email; }).filter(Boolean);

  // 2 — Build the email HTML
  var emailHtml = '<div style="font-family:\'DM Sans\',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0A2445;color:#ffffff;border-radius:8px;overflow:hidden;">'
    + '<div style="padding:32px 40px;border-bottom:1px solid rgba(255,255,255,0.1);">'
    + '<div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#0D7377;font-weight:700;margin-bottom:8px;">The Bushel</div>'
    + '<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8899aa;">JHD Commodity Advisors</div>'
    + '</div>'
    + '<div style="padding:40px;">'
    + '<div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#0D7377;margin-bottom:16px;">' + categoryLabel + '</div>'
    + '<h1 style="font-size:24px;font-weight:700;color:#ffffff;margin:0 0 16px 0;line-height:1.3;">' + postTitle + '</h1>'
    + (postSummary ? '<p style="font-size:15px;color:#8899aa;line-height:1.6;margin:0 0 32px 0;">' + postSummary + '</p>' : '')
    + '<a href="' + postUrl + '" style="display:inline-block;background:#0D7377;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:13px;font-weight:600;letter-spacing:0.05em;">Read on The Bushel</a>'
    + '</div>'
    + '<div style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;color:#556677;">'
    + 'You are receiving this because you subscribed to The Bushel. '
    + '<a href="' + postUrl + '" style="color:#0D7377;">Unsubscribe</a>'
    + '</div>'
    + '</div>';

  // 3 — Send via Resend (batch to all subscribers)
  var resendResp;
  try {
    resendResp = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        emails.map(function(email) {
          return {
            from: 'The Bushel <thebushel@jhdcommodityadvisors.com>',
            to:   [email],
            subject: categoryLabel + ': ' + postTitle,
            html: emailHtml
          };
        })
      )
    });
  } catch(e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Resend fetch failed: ' + e.message }) };
  }

  var resendData;
  try {
    resendData = await resendResp.json();
  } catch(e) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Resend response parse failed' }) };
  }

  if (!resendResp.ok) {
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Resend error', detail: resendData }) };
  }

  return {
    statusCode: 200,
    headers: headers,
    body: JSON.stringify({ message: 'Notifications sent', sent: emails.length })
  };
};
