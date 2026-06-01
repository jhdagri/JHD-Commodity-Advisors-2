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
    'commentary-wheat':       'Wheat Commentary',
    'commentary-corn':        'Corn Commentary',
    'commentary-soy':         'Soy Commentary',
    'market-outlook':         'Market Outlook',
    'technical':              'Technical Analysis',
    'trade-ideas':            'Trade Ideas',
    'research-supply-demand': 'Supply & Demand',
    'research-cftc':          'CFTC Analysis',
    'research-macro':         'Macro Outlook',
    'research-fob':           'FOB & Basis',
    'research-options':       'Options Analytics',
    'research-freight':       'Freight Markets',
    'research-technicals':    'Technical Analysis'
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
  var isPremiumPost = /^\[PREMIUM/.test(postSummary || '');
  var premiumCostMatch = (postSummary || '').match(/^\[PREMIUM:(\d+)\]/);
  var premiumCost = premiumCostMatch ? premiumCostMatch[1] : null;
  var accessLabel = isPremiumPost ? ('&#128274; Premium' + (premiumCost ? ' &middot; ' + premiumCost + ' bu' : '')) : 'Free';
  var accessColor = isPremiumPost ? '#ffb347' : '#2ecfaa';
  var pubDate = new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});

  var emailHtml = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border-radius:8px;overflow:hidden;border:1px solid #1e2230;">'
    + '<div style="background:#0a0c10;padding:18px 32px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1e2230;">'
    + '<div><span style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#ffffff;">JHD </span><span style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#ffb347;">Commodity Advisors</span></div>'
    + '<div style="display:inline-flex;align-items:center;gap:7px;background:#141720;border:1px solid #2a2f40;border-radius:6px;padding:6px 14px;">'
    + '<span style="font-size:11px;">&#128273;</span>'
    + '<span style="font-family:monospace;font-size:10px;font-weight:600;color:#ffb347;letter-spacing:0.16em;text-transform:uppercase;">The Bushel</span>'
    + '</div>'
    + '</div>'
    + '<div style="background:#0d0f12;padding:32px 32px 28px;">'
    + '<div style="font-family:monospace;font-size:9px;color:#0D7377;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:12px;">' + categoryLabel + '</div>'
    + '<h1 style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#e8eaf0;margin:0 0 14px;line-height:1.25;">' + postTitle + '</h1>'
    + '<div style="height:1px;background:linear-gradient(90deg,#ffb347 0%,transparent 65%);margin-bottom:18px;"></div>'
    + (postSummary ? '<p style="font-size:14px;color:#8890a4;line-height:1.65;margin:0 0 28px;">' + postSummary + '</p>' : '<div style="margin-bottom:28px;"></div>')
    + '<a href="' + postUrl + '" style="display:inline-block;background:#ffb347;color:#0d0f12;text-decoration:none;padding:11px 24px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;font-family:monospace;">Read on The Bushel &rarr;</a>'
    + '</div>'
    + '<div style="background:#141720;padding:15px 32px;display:flex;border-top:1px solid rgba(255,255,255,0.05);">'
    + '<div style="flex:1;border-right:1px solid rgba(255,255,255,0.05);padding-right:16px;">'
    + '<div style="font-family:monospace;font-size:9px;color:#555f78;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">Category</div>'
    + '<div style="font-family:monospace;font-size:11px;color:#8890a4;">' + categoryLabel + '</div>'
    + '</div>'
    + '<div style="flex:1;border-right:1px solid rgba(255,255,255,0.05);padding:0 16px;">'
    + '<div style="font-family:monospace;font-size:9px;color:#555f78;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">Published</div>'
    + '<div style="font-family:monospace;font-size:11px;color:#8890a4;">' + pubDate + '</div>'
    + '</div>'
    + '<div style="flex:1;padding-left:16px;">'
    + '<div style="font-family:monospace;font-size:9px;color:#555f78;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:3px;">Access</div>'
    + '<div style="font-family:monospace;font-size:11px;color:' + accessColor + ';">' + accessLabel + '</div>'
    + '</div>'
    + '</div>'
    + '<div style="background:#090b0e;padding:13px 32px;border-top:1px solid #1a1d26;">'
    + '<p style="font-size:10px;color:#2e3344;margin:0;font-family:monospace;">'
    + 'You subscribed to The Bushel &middot; '
    + '<a href="' + postUrl + '" style="color:#555f78;text-decoration:underline;">Unsubscribe</a>'
    + ' &middot; <a href="' + postUrl + '" style="color:#555f78;text-decoration:underline;">thebushel.jhdcommodityadvisors.com</a>'
    + '</p>'
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
