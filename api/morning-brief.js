// api/morning-brief.js — Vercel Serverless Function (CommonJS)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT  = process.env.TELEGRAM_CHAT_ID;
const FH_KEY         = process.env.FINNHUB_KEY || 'd7an9p9r01qtpbh952vgd7an9p9r01qtpbh95300';

const TOP15  = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','ASML','NFLX','COST','AMD','AMAT','QCOM','INTC'];
const QUOTES = [
  "Trade what you see, not what you think.",
  "The market rewards patience, not activity.",
  "Cut your losses. Let your profits run.",
  "Your edge is only as good as your execution.",
  "Process over outcome. Every single day.",
  "Discipline is the bridge between goals and accomplishment.",
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
  "One bad trade doesn't define you. Your reaction does.",
  "Slow down to speed up.",
];

async function safeFetch(url) {
  const ctrl  = new AbortController();
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
  const now     = new Date();
  const today   = now.toISOString().slice(0, 10);
  const DAYS    = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const MONTHS  = ['Jan','Fev','Mar','Avr','Mai','Jun','Jul','Aout','Sep','Oct','Nov','Dec'];
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  const quote   = QUOTES[now.getDate() % QUOTES.length];

  const [qqq, spy, gld, earningsData, newsData] = await Promise.all([
    safeFetch(`https://finnhub.io/api/v1/quote?symbol=QQQ&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/quote?symbol=SPY&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/quote?symbol=GLD&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${today}&token=${FH_KEY}`),
    safeFetch(`https://finnhub.io/api/v1/news?category=general&token=${FH_KEY}`),
  ]);

  // Format a quote line — no markdown special chars
  const fmt = (q, label) => {
    if (!q || !q.c) return `${label}: N/A`;
    const pct  = (q.dp || 0).toFixed(2);
    const sign = q.dp >= 0 ? '+' : '';
    const arr  = q.dp >= 0 ? '▲' : '▼';
    return `${arr} ${label}: ${q.c.toLocaleString('en-US', {maximumFractionDigits:2})} (${sign}${pct}%)`;
  };

  const earnings = ((earningsData && earningsData.earningsCalendar) || [])
    .filter(e => TOP15.includes(e.symbol));
  const news = Array.isArray(newsData) ? newsData.slice(0, 4) : [];

  // Session (Paris time)
  const parisH = parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'Europe/Paris', hour: 'numeric', hour12: false
  }));
  let session;
  if      (parisH >= 15 && parisH < 18) session = 'OVERLAP London + NY (volume max!)';
  else if (parisH >= 9  && parisH < 18) session = 'London OUVERTE';
  else if (parisH >= 18 && parisH < 22) session = 'New York OUVERTE';
  else                                   session = 'Pre-market — London ouvre a 9h Paris';

  // Build plain text message — NO markdown special chars
  const lines = [];
  lines.push('🌅 NQ MORNING BRIEF');
  lines.push(`📅 ${dateStr}`);
  lines.push('─────────────────');
  lines.push('');
  lines.push(`⏰ Session: ${session}`);
  lines.push('');
  lines.push('📊 MARCHES:');
  lines.push(fmt(qqq, 'QQQ / NQ'));
  lines.push(fmt(spy, 'SPY / SP500'));
  lines.push(fmt(gld, 'GLD / Gold'));
  lines.push('');

  if (earnings.length > 0) {
    lines.push('📈 EARNINGS DU JOUR:');
    earnings.forEach(e => {
      const w   = e.hour === 'bmo' ? 'Pre-market' : e.hour === 'amc' ? 'After-hours' : 'Pendant';
      const est = e.epsEstimate != null ? ` | Est $${e.epsEstimate.toFixed(2)}` : '';
      lines.push(`• ${e.symbol} (${w})${est}`);
    });
    lines.push('');
  } else {
    lines.push('📈 Aucun earnings top 15 aujourd\'hui');
    lines.push('');
  }

  if (news.length > 0) {
    lines.push('📰 HEADLINES:');
    news.forEach(n => {
      lines.push(`• ${(n.headline || n.title || '').slice(0, 80)}`);
    });
    lines.push('');
  }

  lines.push('📋 CHECKLIST:');
  lines.push('☐ ForexFactory — events USD haute importance');
  lines.push('☐ Biais HTF du jour (bullish / bearish / neutre)');
  lines.push('☐ Niveaux cles + zones d\'interet');
  lines.push('☐ Respecter le plan, pas les emotions');
  lines.push('');
  lines.push('─────────────────');
  lines.push(`"${quote}"`);
  lines.push('');
  lines.push('💪 Bonne session Steph!');

  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) {
    return res.status(500).json({
      error: 'Missing env vars',
      has_token: !!TELEGRAM_TOKEN,
      has_chat:  !!TELEGRAM_CHAT,
    });
  }

  try {
    const message = await buildMessage();

    // Send to Telegram — plain text, no parse_mode
    const tgRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:                  TELEGRAM_CHAT,
          text:                     message,
          disable_web_page_preview: true,
          // No parse_mode — plain text avoids all Markdown issues
        }),
      }
    );

    const tg = await tgRes.json();

    return res.status(200).json({
      success:     true,
      telegram_ok: tg.ok,
      tg_error:    tg.ok ? null : tg.description,
      preview:     message.slice(0, 300),
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
