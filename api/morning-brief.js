// api/morning-brief.js — Vercel Serverless Function (CommonJS)
// Cron: Mon-Fri 7h Paris | Token: via env vars

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT_ID;
const FH_KEY         = process.env.FINNHUB_KEY || 'd7an9p9r01qtpbh952vgd7an9p9r01qtpbh95300';

const TOP15 = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','ASML','NFLX','COST','AMD','AMAT','QCOM','INTC'];

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
  "Amateurs focus on gains. Pros focus on losses.",
  "Protect your capital first, profits second.",
  "Setups don't fail, traders do.",
  "Never risk more than you can afford to lose.",
  "Confidence comes from preparation.",
  "The trend is your friend until it ends.",
];

async function safeFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return r.json();
  } catch(e) {
    clearTimeout(timer);
    return null;
  }
}

async function buildMessage() {
  const now    = new Date();
  const today  = now.toISOString().slice(0, 10);
  const days   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const months = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aout','Sep','Oct','Nov','Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
  const quote   = QUOTES[now.getDate() % QUOTES.length];

  const [qqq, spy, gld, earningsData, newsData] = await Promise.all([
    safeFetch(`https://finnhub.io/api/v1/quote?symbol=QQQ&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/quote?symbol=GLD&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${today}&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/news?category=general&token=${FH_KEY}`),
  ]);

  const fmt = (q, label) => {
    if (!q || !q.c) return `- *${label}* : indisponible`;
    const sign = (q.dp||0) >= 0 ? '+' : '';
    const icon = (q.dp||0) >= 0 ? 'UP' : 'DOWN';
    return `- *${label}* : ${q.c.toLocaleString('en-US', {maximumFractionDigits:2})} (${sign}${(q.dp||0).toFixed(2)}%) ${icon}`;
  };

  const earnings = (earningsData && earningsData.earningsCalendar || []).filter(e => TOP15.includes(e.symbol));
  const news = Array.isArray(newsData) ? newsData.slice(0, 4) : [];

  const parisH = parseInt(new Date().toLocaleString('en-US', {timeZone:'Europe/Paris', hour:'numeric', hour12:false}));
  let session;
  if      (parisH >= 15 && parisH < 18) session = 'OVERLAP London + NY (volume max)';
  else if (parisH >= 9  && parisH < 18) session = 'London OUVERTE';
  else if (parisH >= 18 && parisH < 22) session = 'New York OUVERTE';
  else                                   session = 'Pre-market - London ouvre a 9h Paris';

  let msg = `NQ MORNING BRIEF\n`;
  msg += `${dateStr}\n`;
  msg += `------------------\n\n`;
  msg += `Session: ${session}\n\n`;
  msg += `MARCHES:\n`;
  msg += `${fmt(qqq, 'QQQ/NQ')}\n`;
  msg += `${fmt(spy, 'SPY/SP500')}\n`;
  msg += `${fmt(gld, 'GLD/Gold')}\n\n`;

  if (earnings.length > 0) {
    msg += `EARNINGS DU JOUR:\n`;
    earnings.forEach(e => {
      const w = e.hour === 'bmo' ? 'Pre-mkt' : e.hour === 'amc' ? 'After-hrs' : 'Pendant';
      const est = e.epsEstimate != null ? ` | Est $${e.epsEstimate.toFixed(2)}` : '';
      msg += `- ${e.symbol} (${w})${est}\n`;
    });
    msg += '\n';
  }

  if (news.length > 0) {
    msg += `HEADLINES:\n`;
    news.forEach(n => {
      msg += `- ${(n.headline || n.title || '').slice(0, 80)}\n`;
    });
    msg += '\n';
  }

  msg += `CHECKLIST:\n`;
  msg += `[ ] ForexFactory - events USD\n`;
  msg += `[ ] Biais HTF du jour\n`;
  msg += `[ ] Niveaux cles\n`;
  msg += `[ ] Respecter le plan\n\n`;
  msg += `------------------\n`;
  msg += `"${quote}"\n\n`;
  msg += `Bonne session Steph !`;

  return msg;
}

module.exports = async function handler(req, res) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    return res.status(500).json({ error: 'Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID env var' });
  }
  try {
    const message = await buildMessage();
    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: message, disable_web_page_preview: true }),
    });
    const tg = await tgRes.json();
    res.status(200).json({ success: true, telegram_ok: tg.ok, preview: message.slice(0, 200) });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};
