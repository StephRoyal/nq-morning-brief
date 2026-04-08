// api/morning-brief.js
// Vercel Cron Function — runs Mon-Fri at 7h Paris (6h UTC)
// Sends a morning trading brief to Telegram

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FINNHUB_KEY = process.env.FINNHUB_KEY || 'd7an9p9r01qtpbh952vgd7an9p9r01qtpbh95300';

const QUOTES = [
  "Trade what you see, not what you think.",
  "The market rewards patience, not activity.",
  "Cut your losses. Let your profits run.",
  "Your edge is only as good as your execution.",
  "Process over outcome. Every single day.",
  "Discipline is the bridge between goals and accomplishment.",
  "The goal is to make the best trades. Money is secondary.",
  "Risk comes from not knowing what you're doing.",
  "Think in probabilities, not certainties.",
  "Every loss is a tuition fee.",
  "Size kills traders. Trade small, stay in the game.",
  "The best trade is sometimes no trade at all.",
  "Fear and greed are your biggest enemies.",
  "Journal every trade. Learn every day.",
  "Small wins compound into big results.",
  "Follow the plan. Trust the process.",
  "Consistency beats intensity every time.",
  "Be patient with winners, impatient with losers.",
  "Amateurs think about how much they can make. Pros think about how much they can lose.",
  "Protect your capital first, profits second.",
  "Setups don't fail, traders do.",
  "Never risk more than you can afford to lose.",
  "Confidence comes from preparation.",
  "The trend is your friend until it ends.",
];

const TOP15 = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','ASML','NFLX','COST','AMD','AMAT','QCOM','INTC'];

async function fetchWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function getMarketData() {
  // Fetch NQ, SP500, Gold, VIX prices via Finnhub quotes
  const symbols = ['QQQ','SPY','GLD','UVXY'];
  const results = {};
  for (const sym of symbols) {
    try {
      const r = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`);
      const d = await r.json();
      results[sym] = d;
    } catch(e) { results[sym] = null; }
  }
  return results;
}

async function getEarningsToday() {
  const today = new Date().toISOString().slice(0,10);
  try {
    const r = await fetchWithTimeout(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${today}&token=${FINNHUB_KEY}`);
    const d = await r.json();
    return (d.earningsCalendar || []).filter(e => TOP15.includes(e.symbol));
  } catch(e) { return []; }
}

async function getNews() {
  try {
    const r = await fetchWithTimeout(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB_KEY}`);
    const d = await r.json();
    return (Array.isArray(d) ? d : []).slice(0, 5);
  } catch(e) { return []; }
}

function formatPrice(quote, symbol) {
  if (!quote || !quote.c) return '—';
  const price = quote.c;
  const change = quote.d || 0;
  const changePct = quote.dp || 0;
  const arrow = change >= 0 ? '📈' : '📉';
  const sign = change >= 0 ? '+' : '';
  return `${arrow} *${symbol}* : ${price.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${sign}${changePct.toFixed(2)}%)`;
}

function getSessionStatus() {
  const now = new Date();
  const londonTime = new Date(now.toLocaleString('en-GB', {timeZone: 'Europe/London'}));
  const nyTime = new Date(now.toLocaleString('en-US', {timeZone: 'America/New_York'}));
  const lH = londonTime.getHours(), lM = londonTime.getMinutes();
  const nH = nyTime.getHours(), nM = nyTime.getMinutes();
  const lTot = lH * 60 + lM;
  const nTot = nH * 60 + nM;
  const ldnOpen = lTot >= 480 && lTot < 1020;  // 08:00-17:00
  const nyOpen  = nTot >= 570 && nTot < 960;   // 09:30-16:00

  let status = '';
  if (ldnOpen && nyOpen) status = '🟢 London + NY *OUVERTES* (Overlap)';
  else if (ldnOpen) status = '🟡 London *OUVERTE* · NY ouvre à 14h30 Paris';
  else if (nyOpen)  status = '🟡 NY *OUVERTE* · London fermée';
  else {
    // Next open
    const minsToLdn = lTot < 480 ? 480 - lTot : (24*60 - lTot + 480);
    const h = Math.floor(minsToLdn/60), m = minsToLdn%60;
    status = `⏳ Marchés fermés — London ouvre dans ${h}h${m>0?m+'min':''}`;
  }
  return status;
}

function getDayOfWeek() {
  const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const months = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  const now = new Date();
  return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

async function buildMessage() {
  const [marketData, earnings, news] = await Promise.all([
    getMarketData(),
    getEarningsToday(),
    getNews(),
  ]);

  const quote = QUOTES[new Date().getDate() % QUOTES.length];
  const dateStr = getDayOfWeek();
  const sessionStatus = getSessionStatus();

  let msg = '';

  // Header
  msg += `🌅 *NQ MORNING BRIEF*\n`;
  msg += `📅 ${dateStr}\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;

  // Session status
  msg += `${sessionStatus}\n\n`;

  // Market data
  msg += `📊 *MARCHÉS*\n`;
  if (marketData['QQQ']) msg += `${formatPrice(marketData['QQQ'], 'QQQ (NQ)')}\n`;
  if (marketData['SPY']) msg += `${formatPrice(marketData['SPY'], 'SPY (SP500)')}\n`;
  if (marketData['GLD']) msg += `${formatPrice(marketData['GLD'], 'GLD (Gold)')}\n`;
  msg += '\n';

  // Earnings today
  if (earnings.length > 0) {
    msg += `📈 *EARNINGS AUJOURD\'HUI*\n`;
    earnings.forEach(e => {
      const when = e.hour === 'bmo' ? '🌅 Pré-mkt' : e.hour === 'amc' ? '🌙 After-hrs' : '📅';
      const est = e.epsEstimate != null ? ` · Est $${e.epsEstimate.toFixed(2)}` : '';
      msg += `• *${e.symbol}* — ${when}${est}\n`;
    });
    msg += '\n';
  } else {
    msg += `📈 *EARNINGS* : Aucun aujourd\'hui sur le top 15\n\n`;
  }

  // Top news
  if (news.length > 0) {
    msg += `📰 *HEADLINES*\n`;
    news.slice(0, 4).forEach(n => {
      const title = (n.headline || n.title || '').slice(0, 80);
      msg += `• ${title}\n`;
    });
    msg += '\n';
  }

  // Key levels reminder
  msg += `📋 *CHECKLIST AVANT DE TRADER*\n`;
  msg += `☐ Vérifier calendar → forexfactory.com\n`;
  msg += `☐ Identifier les niveaux clés HTF\n`;
  msg += `☐ Définir le biais du jour\n`;
  msg += `☐ Respecter le plan, pas les émotions\n\n`;

  // Quote
  msg += `━━━━━━━━━━━━━━━━━\n`;
  msg += `💭 _"${quote}"_\n\n`;
  msg += `🎯 Bonne session, Steph. 💪`;

  return msg;
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  return res.json();
}

export default async function handler(req) {
  // Security: verify it's called by Vercel cron (or manually with ?test=1)
  const url = new URL(req.url, 'https://example.com');
  const isTest = url.searchParams.get('test') === '1';
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!isTest && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    return new Response(JSON.stringify({ error: 'Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID env vars' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const message = await buildMessage();
    const result = await sendTelegram(message);

    return new Response(JSON.stringify({
      success: true,
      telegram: result,
      preview: message.slice(0, 200) + '...'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
