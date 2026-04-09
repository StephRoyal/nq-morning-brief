// NQ Morning Brief — Trading Desk Institutionnel FINAL
// Vercel Cron: 0 6 * * 1-5

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT  = process.env.TELEGRAM_CHAT_ID;
const FH    = process.env.FINNHUB_KEY || 'd7an9p9r01qtpbh952vgd7an9p9r01qtpbh95300';

// QQQ/NQ ratio: QQQ ≈ NQ / 40.5 (updated periodically, close enough)
const QQQ_TO_NQ_RATIO = 40.5;
// MNQ: 1 point = $2 | NQ: 1 point = $20
const MNQ_TICK_VALUE = 2;

const TOP15  = ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','AVGO','ASML','NFLX','COST','AMD','AMAT','QCOM','INTC'];
const MOVERS = ['NVDA','AAPL','MSFT','AMZN','META','GOOGL','TSLA','AVGO','NFLX'];
const NQ_DRV = ['NVDA','AAPL','MSFT','AMZN','META','GOOGL','TSLA'];
const SECTORS = [
  {sym:'XLK',name:'Tech'},{sym:'XLF',name:'Finance'},{sym:'XLE',name:'Energie'},
  {sym:'XLV',name:'Sante'},{sym:'XLI',name:'Industrie'},{sym:'XLC',name:'Media'},
  {sym:'XLY',name:'Conso.Disc'},{sym:'XLP',name:'Conso.Stable'},{sym:'XLU',name:'Utilities'},
];
const HIGH_KW = ['fomc','federal reserve','minutes','nonfarm','nfp','cpi','pce','interest rate','gdp','powell'];
const GEO_KW  = ['iran','russia','ukraine','china','taiwan','war','ceasefire','sanction','tariff','trump',
                  'missile','attack','conflict','geopolit','middle east','nato','opec','nuclear'];

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
  "Setups don't fail. Traders do.",
  "Never risk more than you can afford to lose.",
  "Confidence comes from preparation.",
  "The trend is your friend until it ends.",
  "One bad trade won't ruin you. One bad habit will.",
  "Slow is smooth. Smooth is fast.",
  "You don't need to trade every day. You need to trade well.",
  "The market is always right.",
  "Patience is not waiting. It's knowing when to act.",
  "Risk management is the only thing you can control.",
  "React, don't predict.",
  "A great entry without a stop is just a gamble.",
  "The less you trade, the more you wait for the perfect setup.",
];

// ─── FETCH ─────────────────────────────────────────────────────────
async function get(url, hdrs = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: hdrs });
    clearTimeout(t);
    return r.ok ? r.json() : null;
  } catch(e) { clearTimeout(t); return null; }
}

async function yahooQuote(sym) {
  const d = await get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m`,
    { 'User-Agent': 'Mozilla/5.0' }
  );
  const m = d?.chart?.result?.[0]?.meta;
  if (!m) return null;
  const c = m.regularMarketPrice || 0, p = m.chartPreviousClose || m.previousClose || 0;
  return { c, pc: p, dp: p ? (c-p)/p*100 : 0, d: c-p };
}

async function yahooWeekly(sym) {
  const d = await get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`,
    { 'User-Agent': 'Mozilla/5.0' }
  );
  const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean);
  if (!closes || closes.length < 2) return null;
  return (closes[closes.length-1] - closes[0]) / closes[0] * 100;
}

async function coinbase(pair) {
  const d = await get(`https://api.exchange.coinbase.com/products/${pair}/stats`);
  if (!d?.last || !d?.open) return null;
  const last = parseFloat(d.last), open = parseFloat(d.open);
  return { price: last, pct: (last-open)/open*100 };
}

async function fhQ(sym) { return get(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FH}`); }

async function fhEarnings(from, to) {
  const d = await get(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FH}`);
  return (d?.earningsCalendar || []).filter(e => TOP15.includes(e.symbol));
}

async function fhEco(from, to) {
  const d = await get(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FH}`);
  return (d?.economicCalendar || [])
    .filter(e => (e.country==='US'||e.currency==='USD') && HIGH_KW.some(k=>(e.event||'').toLowerCase().includes(k)))
    .sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,6);
}

async function fhNews() {
  const d = await get(`https://finnhub.io/api/v1/news?category=general&token=${FH}`);
  return Array.isArray(d) ? d : [];
}

async function getWeather() {
  const d = await get('https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=Europe/London&forecast_days=1');
  if (!d?.daily) return null;
  const max  = Math.round(d.daily.temperature_2m_max[0]);
  const min  = Math.round(d.daily.temperature_2m_min[0]);
  const rain = (d.daily.precipitation_sum[0]||0).toFixed(1);
  const code = d.daily.weathercode[0];
  const [emoji, desc, dress] =
    code===0             ? ['☀️','Ensoleillé',`${max}°C — Costume léger, pas d'imperméable`] :
    code<=2              ? ['🌤️','Peu nuageux',`${max}°C — Costume standard, veste suffit`] :
    code===3             ? ['☁️','Couvert',`${max}°C — Costume + imperméable conseillé`] :
    code<=49             ? ['🌫️','Brouillard',`${max}°C — Costume + imperméable`] :
    code<=67             ? ['🌧️','Pluie',`${max}°C — Imperméable obligatoire sur le costume`] :
    code<=77             ? ['🌨️','Neige',`${max}°C — Manteau sur le costume`] :
    code<=82             ? ['🌦️','Averses',`${max}°C — Parapluie avec le costume`] :
                           ['⛈️','Orage',`${max}°C — Taxi recommandé, pas de marche`];
  return { max, min, rain, emoji, desc, dress };
}

// ─── OPTIONS avec conversion QQQ → NQ ──────────────────────────────
async function getOptions(nqPrice) {
  const q = await yahooQuote('QQQ');
  if (!q) return null;
  const qqqPrice = q.c;

  // Actual QQQ/NQ ratio based on live prices
  const ratio = nqPrice && nqPrice > 0 ? nqPrice / qqqPrice : QQQ_TO_NQ_RATIO;

  const now = new Date();
  const daysToFri = now.getDay()===0 ? 5 : now.getDay()<=5 ? 5-now.getDay() : 6;
  const fri = new Date(now.getTime() + daysToFri*86400000);

  const d = await get(
    `https://query1.finance.yahoo.com/v7/finance/options/QQQ?date=${Math.floor(fri.getTime()/1000)}`,
    { 'User-Agent': 'Mozilla/5.0' }
  );
  const opts = d?.optionChain?.result?.[0]?.options?.[0];
  if (!opts) return { qqqPrice, nqEquiv: qqqPrice*ratio, pcr: null, impliedMove: null, maxPain: null, ratio };

  const calls = opts.calls || [], puts = opts.puts || [];

  // ATM IV → implied move QQQ
  const atm = calls.reduce((p,c)=>Math.abs(c.strike-qqqPrice)<Math.abs(p.strike-qqqPrice)?c:p, calls[0]);
  let impliedMoveQQQ = null;
  if (atm) {
    const aC = calls.find(c=>c.strike===atm.strike), aP = puts.find(p=>p.strike===atm.strike);
    if (aC?.impliedVolatility && aP?.impliedVolatility) {
      const iv = (aC.impliedVolatility + aP.impliedVolatility) / 2;
      impliedMoveQQQ = qqqPrice * iv * Math.sqrt(Math.max(daysToFri,1)/365);
    }
  }

  // Put/Call OI ratio
  const callOI = calls.reduce((s,c)=>s+(c.openInterest||0),0);
  const putOI  = puts.reduce((s,p)=>s+(p.openInterest||0),0);
  const pcr = callOI>0 ? putOI/callOI : null;

  // IV Skew: compare put IV vs call IV at equidistant strikes
  // If put IV > call IV → skew negative → market paying more for downside protection
  let skew = null;
  try {
    const otmPut  = puts.find(p => Math.abs(p.strike - (qqqPrice*0.97)) < 2);
    const otmCall = calls.find(c => Math.abs(c.strike - (qqqPrice*1.03)) < 2);
    if (otmPut?.impliedVolatility && otmCall?.impliedVolatility) {
      skew = otmPut.impliedVolatility - otmCall.impliedVolatility;
    }
  } catch(e) {}

  // Max Pain QQQ
  const strikes = [...new Set([...calls.map(c=>c.strike),...puts.map(p=>p.strike)])].sort((a,b)=>a-b);
  let minPain=Infinity, maxPainQQQ=null;
  for (const s of strikes) {
    const cp = calls.reduce((sum,c)=>sum+(c.openInterest||0)*Math.max(s-c.strike,0),0);
    const pp = puts.reduce((sum,p)=>sum+(p.openInterest||0)*Math.max(p.strike-s,0),0);
    if (cp+pp<minPain) { minPain=cp+pp; maxPainQQQ=s; }
  }

  // Convert all to NQ points
  const impliedMoveNQ = impliedMoveQQQ ? impliedMoveQQQ * ratio : null;
  const maxPainNQ     = maxPainQQQ     ? maxPainQQQ * ratio     : null;

  return { qqqPrice, nqEquiv: qqqPrice*ratio, pcr, impliedMoveQQQ, impliedMoveNQ, maxPainQQQ, maxPainNQ, ratio, skew, daysToFri };
}

// ─── FORMAT ─────────────────────────────────────────────────────────
const p2  = v => Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const p0  = v => Math.round(Number(v)).toLocaleString('en-US');
const pct = (v,d=2) => `${v>=0?'+':''}${Number(v).toFixed(d)}%`;
const arr = v => v>=0 ? '▲' : '▼';

function mktLine(label, price, dp) {
  if (!price) return `  ${label}: N/A`;
  return `  ${arr(dp)} ${label}: ${p2(price)}  (${pct(dp)})`;
}

// ─── ANALYSIS ENGINE ─────────────────────────────────────────────────
function analyze(nqPct, spPct, btcPct, gldPct, oilPct, vix, todayEvents, opt) {
  const avg = (nqPct+spPct)/2;

  const [biasIcon,biasLabel,biasDesc] =
    avg> 1.5 ? ['🟢🟢','BULLISH FORT',       'Momentum haussier fort. Favoriser les longs en pullback.'] :
    avg> 0.4 ? ['🟢',  'Légèrement BULLISH', 'Légère pression acheteuse. Chercher les pullbacks pour entrer.'] :
    avg>-0.4 ? ['⚪',  'NEUTRE',             'Pas de direction. Attendre confirmation à l\'ouverture.'] :
    avg>-1.5 ? ['🔴',  'Légèrement BEARISH', 'Pression vendeuse modérée. Prudence sur les longs.'] :
               ['🔴🔴','BEARISH FORT',        'Momentum baissier. Shorts ou rester flat.'];

  // Options signals
  let optBias='', optConfirm='', skewNote='';
  if (opt?.pcr) {
    const pcr=opt.pcr;
    optBias = pcr>1.2 ? `PCR ${pcr.toFixed(2)} → Marché se hedge BEARISH (puts dominant)` :
              pcr>0.9 ? `PCR ${pcr.toFixed(2)} → Sentiment neutre-bearish` :
              pcr>0.7 ? `PCR ${pcr.toFixed(2)} → Sentiment neutre` :
                        `PCR ${pcr.toFixed(2)} → Sentiment BULLISH (calls dominant)`;
    const pcrBull=pcr<0.8, pcrBear=pcr>1.1;
    optConfirm = (avg>0.3&&pcrBull) ? '✅ Options CONFIRMENT le biais BULLISH' :
                 (avg>0.3&&pcrBear) ? '⚠️ Options CONTREDISENT le biais bullish — prudence!' :
                 (avg<-0.3&&pcrBear)? '✅ Options CONFIRMENT le biais BEARISH' :
                 (avg<-0.3&&pcrBull)? '⚠️ Options CONTREDISENT le biais bearish — rebond?' :
                                      '↔️ Options sans signal directionnel fort';
  }
  if (opt?.skew !== null && opt?.skew !== undefined) {
    const sk = opt.skew;
    skewNote = sk > 0.05  ? `Skew négatif marqué (puts >>calls) — marché nerveux, protection achetée ⚠️` :
               sk > 0.02  ? `Skew légèrement négatif — prudence haussière normale` :
               sk < -0.02 ? `Skew positif (calls>puts) — sentiment agressivement bullish 🟢` :
                            `Skew neutre — pas de biais directionnel via options`;
  }

  // Setup
  const setup =
    vix>28             ? 'ATTENDRE — VIX extrême. Ne trader qu\'après 30min d\'ouverture avec confirmation.' :
    todayEvents.length>0?'PRUDENCE pré-annonce. Positions réduites ou flat avant publication. Entrer POST si move>0.5%.' :
    avg>1.0            ? 'CONTINUATION HAUSSIÈRE — Pullbacks sur OB/FVG pour long dans la tendance overnight.' :
    avg<-1.0           ? 'CONTINUATION BAISSIÈRE — Retracements sur résistance pour shorter. Éviter les counter-trend.' :
    Math.abs(avg)<0.3  ? 'RANGE / REVERSAL — Extrêmes de range uniquement. Attendre BoS ou MSS confirmé.' :
                         'CONTINUATION LÉGÈRE — Confirmation obligatoire avant entrée. Pas d\'anticipation.';

  const [sizing,sizeNote] =
    todayEvents.length>0 ? ['0.5%','⚠️ Annonce majeure — DEMI-SIZE. Attendre post-publication.'] :
    vix>30               ? ['0.4%',`⚠️ VIX extrême (${vix?.toFixed(1)}) — 40% du risque normal.`] :
    vix>22               ? ['0.7%',`⚡ VIX élevé (${vix?.toFixed(1)}) — Réduire de 30%.`] :
    Math.abs(avg)>2      ? ['1.0%','💡 Fort move overnight — Size normale, méfiance mean-reversion.'] :
                           ['1.0%','✅ Conditions favorables — Size standard.'];

  const cross=[];
  if (btcPct!==null) {
    if (btcPct>2&&avg>0.5)    cross.push(`BTC +${btcPct.toFixed(1)}% + NQ positif = Risk-ON généralisé ✅`);
    else if (btcPct>3&&avg<0) cross.push(`BTC hausse mais NQ en baisse — Divergence risk assets ⚠️`);
    else if (btcPct<-2&&avg>0)cross.push(`BTC sous pression malgré NQ positif — Risk-on partiel`);
    else if (btcPct<-2&&avg<-0.5)cross.push(`BTC + NQ en baisse = Risk-OFF généralisé 🔴`);
  }
  if (gldPct>0.5&&avg<0)  cross.push(`Gold hausse + marchés baisse = Flight-to-safety actif 🔴`);
  if (gldPct<-0.3&&avg>1) cross.push(`Gold recule + marchés en hausse = Risk-on confirmé ✅`);
  if (oilPct>2.5)  cross.push(`Pétrole +${oilPct.toFixed(1)}% — Risque inflationniste, Fed plus hawkish possible`);
  if (oilPct<-2.5) cross.push(`Pétrole -${Math.abs(oilPct).toFixed(1)}% — Signal de ralentissement économique`);

  return { biasIcon, biasLabel, biasDesc, optBias, optConfirm, skewNote, setup, sizing, sizeNote, cross };
}

// ─── MAIN BUILD ──────────────────────────────────────────────────────
async function build() {
  const now    = new Date();
  const today  = now.toISOString().slice(0,10);
  const in7d   = new Date(now.getTime()+7*86400000).toISOString().slice(0,10);
  const DAYS   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const dateStr = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  const quote   = QUOTES[now.getDate() % QUOTES.length];

  const londonH = parseInt(new Date().toLocaleString('en-US',{timeZone:'Europe/London',hour:'numeric',hour12:false}));
  const [sessIcon,sessLabel] =
    londonH>=15&&londonH<18 ? ['🔥','OVERLAP — London + NY (Volume Max!)'] :
    londonH>=9&&londonH<18  ? ['🟡','LONDON OUVERTE'] :
    londonH>=18&&londonH<22 ? ['🟢','NEW YORK OUVERTE'] :
    londonH>=7&&londonH<9   ? ['⏳','PRE-MARKET — London ouvre bientôt'] :
                            ['🌙','MARCHÉS FERMÉS'];

  // Fetch NQ first to get live price for ratio calculation
  const nq = await yahooQuote('NQ=F');
  const nqLivePrice = nq?.c || 0;

  // All other fetches in parallel
  const [sp, btcS, ethS, gld, oil, vixQ,
         earningsTd, earningsWk, ecoEvents, allNews,
         weather, opt,
         secPerfs, nqDrvPerfs] = await Promise.all([
    yahooQuote('ES=F'),
    coinbase('BTC-USD'), coinbase('ETH-USD'),
    fhQ('GLD'), fhQ('USO'), fhQ('UVXY'),
    fhEarnings(today,today), fhEarnings(today,in7d),
    fhEco(today,in7d), fhNews(),
    getWeather(),
    getOptions(nqLivePrice),
    Promise.all(SECTORS.map(async s=>({...s,wk:await yahooWeekly(s.sym)||0}))),
    Promise.all(NQ_DRV.map(async s=>({sym:s,wk:await yahooWeekly(s)||0}))),
  ]);

  const nqPct  = nq?.dp  || 0;
  const spPct  = sp?.dp  || 0;
  const btcPct = btcS?.pct ?? null;
  const gldPct = gld?.dp  || 0;
  const oilPct = oil?.dp  || 0;
  const vix    = vixQ?.c  || null;

  const todayEvents  = ecoEvents.filter(e=>e.date===today);
  const A = analyze(nqPct,spPct,btcPct,gldPct,oilPct,vix||0,todayEvents,opt);

  // News filtering
  const geoNews = allNews.filter(n=>GEO_KW.some(k=>(n.headline||n.title||'').toLowerCase().includes(k))).slice(0,4);
  const mktNews = allNews.filter(n=>{
    const t=(n.headline||n.title||'').toLowerCase();
    return (t.includes('fed')||t.includes('nasdaq')||t.includes('market')||t.includes('rate')||
            t.includes('inflation')||t.includes('earnings')||t.includes('jobs')||t.includes('s&p'))
      && !GEO_KW.some(k=>t.includes(k));
  }).slice(0,3);

  const secSorted  = [...secPerfs].sort((a,b)=>b.wk-a.wk);
  const nqDrvSorted= [...nqDrvPerfs].sort((a,b)=>Math.abs(b.wk)-Math.abs(a.wk));
  const bigEarnings= earningsWk.filter(e=>MOVERS.includes(e.symbol));

  const L = [];

  // HEADER
  L.push(`╔══════════════════════════════════╗`);
  L.push(`   🌅 NQ MORNING BRIEF`);
  L.push(`   ${dateStr}`);
  L.push(`╚══════════════════════════════════╝`);
  L.push('');

  // SESSION
  L.push(`${sessIcon} SESSION: ${sessLabel}`);
  L.push('');

  // MÉTÉO LONDRES
  if (weather) {
    L.push(`🌍 MÉTÉO LONDRES — ${weather.emoji} ${weather.desc}`);
    L.push(`   ${weather.min}°C → ${weather.max}°C  |  Pluie: ${weather.rain}mm`);
    L.push(`   👔 ${weather.dress}`);
    L.push('');
  }

  // ALERTE HAUTE IMPORTANCE
  if (todayEvents.length > 0) {
    L.push(`🚨 ─── ALERTE HAUTE IMPORTANCE ─────────────────`);
    todayEvents.forEach(e => {
      const hr  = new Date((e.time||e.date+'T13:00:00')).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'});
      const est = e.estimate ? ` | Prév: ${e.estimate}` : '';
      const prev= e.prev ? ` | Préc: ${e.prev}` : '';
      L.push(`   ⚠️  ${e.event}`);
      L.push(`         ${hr} heure de Londres${est}${prev}`);
    });
    L.push(`──────────────────────────────────────────────────`);
    L.push('');
  }

  // MARCHÉS
  L.push(`📊 MARCHÉS  (NQ/SP500 = 15min delay | Crypto = temps réel)`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  if (nq)  L.push(mktLine('NQ Futures   ', nq.c,  nq.dp));
  if (sp)  L.push(mktLine('SP500 Futures', sp.c,  sp.dp));
  if (gld) L.push(mktLine('Gold         ', gld.c, gld.dp||0));
  if (oil) L.push(mktLine('WTI Oil      ', oil.c, oil.dp||0));
  if (btcS)L.push(mktLine('Bitcoin      ', btcS.price, btcS.pct));
  if (ethS)L.push(mktLine('Ethereum     ', ethS.price, ethS.pct));
  if (vix) {
    const vn = vix<12?'Très faible':vix<18?'Normal':vix<25?'Élevé — réduire size':vix<35?'Très élevé':'EXTRÊME';
    L.push(`  ~ Volatilité (VIX proxy): ${p2(vix)}  → ${vn}`);
  }
  L.push('');

  // ANALYSE TRADING DESK
  L.push(`🧠 ANALYSE TRADING DESK`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  L.push(`${A.biasIcon} Biais overnight: ${A.biasLabel}`);
  L.push(`   ${A.biasDesc}`);
  L.push('');
  if (A.cross.length > 0) {
    L.push(`📡 Corrélations inter-marchés:`);
    A.cross.forEach(c=>L.push(`   → ${c}`));
    L.push('');
  }

  // OPTIONS → NQ TRANSLATION
  L.push(`🎯 OPTIONS WEEKLY — Traduit en NQ Futures`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  if (opt) {
    // Ratio info
    L.push(`   Ratio QQQ/NQ utilisé: 1 QQQ = ${opt.ratio.toFixed(1)} pts NQ`);
    L.push(`   QQQ: $${p2(opt.qqqPrice)}  ≈  NQ: ${p0(opt.qqqPrice * opt.ratio)} pts`);
    L.push('');

    if (A.optBias) L.push(`   ${A.optBias}`);
    if (A.optConfirm) L.push(`   ${A.optConfirm}`);
    if (A.skewNote)   L.push(`   IV Skew: ${A.skewNote}`);
    L.push('');

    // Implied move in NQ POINTS
    if (opt.impliedMoveNQ && nqLivePrice) {
      const im   = opt.impliedMoveNQ;
      const up   = nqLivePrice + im;
      const down = nqLivePrice - im;
      const imPct = im / nqLivePrice * 100;
      L.push(`   📐 Implied Move d'ici vendredi (NQ FUTURES):`);
      L.push(`   NQ actuel: ${p0(nqLivePrice)} pts`);
      L.push(`   Fourchette: ${p0(down)} ↔ ${p0(up)} pts  (±${Math.round(im)} pts / ±${imPct.toFixed(1)}%)`);
      const mnqPnl = Math.round(im) * MNQ_TICK_VALUE;
      L.push(`   → En MNQ (1 contrat): ±$${mnqPnl.toLocaleString()} si move complet`);
      L.push('');
    }

    // Max Pain in NQ POINTS
    if (opt.maxPainNQ && nqLivePrice) {
      const mp   = opt.maxPainNQ;
      const diff = mp - nqLivePrice;
      const dir  = diff > 0 ? `+${Math.round(diff)} pts AU-DESSUS` : `${Math.round(diff)} pts EN-DESSOUS`;
      L.push(`   📌 Max Pain NQ (objectif MM vendredi): ${p0(mp)} pts`);
      L.push(`   → Actuellement ${dir} du prix (${diff>0?'pression haussière':'pression baissière'} des MMs)`);
      // Probability assessment
      const distPct = Math.abs(diff)/nqLivePrice*100;
      const prob = distPct < 0.5 ? 'HAUTE probabilité' : distPct < 1.5 ? 'Probabilité modérée' : distPct < 3 ? 'Probabilité faible' : 'Probabilité très faible';
      L.push(`   → ${prob} que le NQ finisse proche de ce niveau vendredi`);
    }
  } else {
    L.push(`   Données options indisponibles → cboe.com/options`);
  }
  L.push('');

  // SETUP + SIZING
  L.push(`📌 Setup privilégié: ${A.setup}`);
  L.push('');
  L.push(`💰 Sizing: ${A.sizing}  |  ${A.sizeNote}`);
  L.push('');

  // GÉOPOLITIQUE
  L.push(`🌐 GÉOPOLITIQUE — Impact marché`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  if (geoNews.length > 0) {
    geoNews.forEach((n,i)=>{
      L.push(`${i+1}. ${(n.headline||n.title||'').slice(0,72)}${n.source?` [${n.source}]`:''}`);
    });
    const hasT = geoNews.some(n=>(n.headline||n.title||'').toLowerCase().includes('trump'));
    const hasW = geoNews.some(n=>(n.headline||n.title||'').toLowerCase().match(/war|attack|missile|ceasefire/));
    const hasTf= geoNews.some(n=>(n.headline||n.title||'').toLowerCase().includes('tariff'));
    const alerts=[];
    if (hasT)  alerts.push('Déclaration Trump — risque de volatilité soudaine (tweet-driven move)');
    if (hasTf) alerts.push('Tarifs/Trade war — impact direct secteur tech Nasdaq (-3% à -8% possible)');
    if (hasW)  alerts.push('Conflit actif — flight-to-safety possible (Gold ↑, Nasdaq ↓)');
    if (alerts.length>0) { L.push(''); L.push('   ⚠️ Vigilance:'); alerts.forEach(a=>L.push(`   → ${a}`)); }
  } else {
    L.push('   Pas de headline géopolitique majeur overnight');
  }
  L.push('');

  // HEADLINES MARCHÉS
  if (mktNews.length>0) {
    L.push(`📰 HEADLINES MARCHÉS`);
    L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
    mktNews.forEach((n,i)=>L.push(`${i+1}. ${(n.headline||n.title||'').slice(0,72)}${n.source?` [${n.source}]`:''}`));
    L.push('');
  }

  // SECTEURS SP500
  L.push(`🏭 SECTEURS SP500 — Perf hebdo`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  const top3=secSorted.slice(0,3), bot2=secSorted.slice(-2);
  top3.forEach(s=>L.push(`   ${arr(s.wk)} ${s.name.padEnd(13)} ${pct(s.wk)}`));
  L.push('   ···');
  bot2.forEach(s=>L.push(`   ${arr(s.wk)} ${s.name.padEnd(13)} ${pct(s.wk)}`));
  L.push(`   → Driver SP500: ${top3[0]?.name||'—'} (${pct(top3[0]?.wk||0)})`);
  L.push('');

  // NQ DRIVERS
  L.push(`🚀 DRIVERS NASDAQ — Cette semaine`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  nqDrvSorted.slice(0,5).forEach(d=>L.push(`   ${arr(d.wk)} ${d.sym.padEnd(7)} ${pct(d.wk)}`));
  L.push('');

  // EARNINGS
  L.push(`📈 EARNINGS`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  if (earningsTd.length>0) {
    L.push("   Aujourd'hui:");
    earningsTd.forEach(e=>{
      const isMov=MOVERS.includes(e.symbol);
      const when=e.hour==='bmo'?'🌅 Pré-mkt':e.hour==='amc'?'🌙 After-hrs':'📅 Pendant';
      const est=e.epsEstimate!=null?`Est: $${e.epsEstimate.toFixed(2)}`:'';
      const act=e.epsActual!=null?`Réel: $${e.epsActual.toFixed(2)}`:'';
      const beat=e.epsActual!=null&&e.epsEstimate!=null?(e.epsActual>=e.epsEstimate?' ✅ BEAT':' ❌ MISS'):'';
      L.push(`   ${isMov?'🔴 ':''}${e.symbol}  ${when}  ${[est,act,beat].filter(Boolean).join(' ')}`);
    });
  } else {
    L.push("   Aucun earnings top 15 aujourd'hui");
  }
  if (bigEarnings.length>0) {
    L.push('');
    L.push('   Gros movers cette semaine:');
    bigEarnings.forEach(e=>{
      const ds=new Date(e.date+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});
      L.push(`   → ${e.symbol} — ${ds}`);
    });
  }
  L.push('');

  // EVENTS ÉCO
  if (ecoEvents.length>0) {
    L.push(`📅 ÉVÉNEMENTS USD CETTE SEMAINE`);
    L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
    ecoEvents.forEach(e=>{
      const dt =new Date((e.time||e.date+'T14:00:00'));
      const ds =dt.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/London'});
      const hr =dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'});
      const est=e.estimate?` | Prév: ${e.estimate}`:'';
      L.push(`  ${e.date===today?'🔴':'⚪'} ${e.event}${est}`);
      L.push(`     ${ds} à ${hr} Londres`);
    });
    L.push('');
  }

  // CHECKLIST
  L.push(`📋 CHECKLIST PRÉ-TRADE`);
  L.push(`┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`);
  L.push(`  ☐ Biais HTF validé (D1 / H4)`);
  L.push(`  ☐ Niveaux clés: OB, FVG, PDH/PDL, Weekly high/low`);
  L.push(`  ☐ ForexFactory — events USD du jour`);
  L.push(`  ☐ Size: ${A.sizing} par trade`);
  L.push(`  ☐ Max Pain NQ en tête: ${opt?.maxPainNQ ? p0(opt.maxPainNQ)+' pts' : '—'}`);
  L.push(`  ☐ Stop défini AVANT l'entrée`);
  L.push(`  ☐ Max 2 losses consécutives → arrêt journée`);
  L.push(`  ☐ Pas de revenge trading`);
  L.push('');

  // QUOTE
  L.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.push(`💭 "${quote}"`);
  L.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  L.push('');
  L.push(`💪 Focus & Discipline. Bonne session Steph !`);

  return L.join('\n');
}

// HANDLER
module.exports = async function handler(req, res) {
  if (!TOKEN || !CHAT) return res.status(500).json({ error: 'Missing env vars' });
  try {
    const message = await build();
    const tgRes = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: message, disable_web_page_preview: true }),
    });
    const tg = await tgRes.json();
    return res.status(200).json({ success: true, telegram_ok: tg.ok, tg_error: tg.ok?null:tg.description, chars: message.length });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
