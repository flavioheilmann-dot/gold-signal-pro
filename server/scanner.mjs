// Server-side signal scanner — runs independently of the browser.
// Polls Capital.com candles for all watchlist assets, runs the signal
// engine, and sends ntfy push notifications for strong signals.

const WATCHLIST = [
  { epic: "EURUSD", name: "EUR/USD", kind: "forex" },
  { epic: "US500", name: "US 500", kind: "index" },
  { epic: "GOLD", name: "Gold", kind: "metal" },
  { epic: "US100", name: "US Tech 100", kind: "index" },
  { epic: "DE40", name: "Germany 40", kind: "index" },
  { epic: "FR40", name: "France 40", kind: "index" },
  { epic: "UK100", name: "UK 100", kind: "index" },
  { epic: "J225", name: "Japan 225", kind: "index" },
  { epic: "HK50", name: "Hong Kong 50", kind: "index" },
  { epic: "EU50", name: "EU Stocks 50", kind: "index" },
  { epic: "GBPUSD", name: "GBP/USD", kind: "forex" },
  { epic: "USDJPY", name: "USD/JPY", kind: "forex" },
  { epic: "USDCHF", name: "USD/CHF", kind: "forex" },
  { epic: "AUDUSD", name: "AUD/USD", kind: "forex" },
  { epic: "USDCAD", name: "USD/CAD", kind: "forex" },
  { epic: "EURGBP", name: "EUR/GBP", kind: "forex" },
  { epic: "EURJPY", name: "EUR/JPY", kind: "forex" },
  { epic: "EURCHF", name: "EUR/CHF", kind: "forex" },
  { epic: "SILVER", name: "Silver", kind: "metal" },
  { epic: "PLATINUM", name: "Platinum", kind: "metal" },
  { epic: "OIL_CRUDE", name: "Crude Oil Spot", kind: "commodity" },
  { epic: "NATURALGAS", name: "Natural Gas", kind: "commodity" },
  { epic: "BTCUSD", name: "Bitcoin/USD", kind: "crypto" },
  { epic: "ETHUSD", name: "Ethereum/USD", kind: "crypto" },
  { epic: "SOLUSD", name: "Solana/USD", kind: "crypto" },
  { epic: "AAPL", name: "Apple Inc", kind: "stock" },
  { epic: "NVDA", name: "NVIDIA Corp", kind: "stock" },
  { epic: "MSFT", name: "Microsoft Corp", kind: "stock" },
  { epic: "TSLA", name: "Tesla Inc", kind: "stock" },
  { epic: "AMZN", name: "Amazon.com Inc", kind: "stock" },
  { epic: "GOOGL", name: "Alphabet Inc - A", kind: "stock" },
  { epic: "META", name: "Meta Platforms Inc", kind: "stock" },
  { epic: "AMD", name: "Advanced Micro Devices Inc", kind: "stock" },
  { epic: "NFLX", name: "Netflix Inc", kind: "stock" },
  { epic: "JPM", name: "JPMorgan Chase & Co", kind: "stock" },
  { epic: "V", name: "Visa Inc", kind: "stock" },
  { epic: "BA", name: "Boeing Co", kind: "stock" },
];

const P = {
  emaFast: 9, emaSlow: 21, emaTrend: 50,
  rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9,
  atrPeriod: 14, strengthMin: 0.65, confirmBars: 2,
  atrSL: 1.0, atrTP1: 1.6, atrTP2: 2.6,
  boxLookback: 30, breakoutBufferAtr: 0.18, rejectionWickMin: 0.55,
};

// ── Indicators (ported from signalEngine.ts) ──

function ema(data, period) {
  const out = new Array(data.length).fill(null);
  if (data.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < data.length; i++) {
    prev = data[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(data, period) {
  const out = new Array(data.length).fill(null);
  if (data.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(data, fast, slow, signalPeriod) {
  const ef = ema(data, fast), es = ema(data, slow);
  const line = data.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
  const signal = new Array(data.length).fill(null);
  const first = line.findIndex(v => v != null);
  if (first >= 0) {
    const sig = ema(line.slice(first).map(v => v), signalPeriod);
    for (let i = 0; i < sig.length; i++) if (sig[i] != null) signal[first + i] = sig[i];
  }
  const hist = data.map((_, i) => line[i] != null && signal[i] != null ? line[i] - signal[i] : null);
  return { macd: line, signal, hist };
}

function atr(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))
  );
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += tr[i];
    if (i > period) sum -= tr[i - period];
    if (i >= period) out[i] = sum / period;
  }
  return out;
}

function rollingBox(candles, lookback) {
  const high = new Array(candles.length).fill(null);
  const low = new Array(candles.length).fill(null);
  for (let i = lookback; i < candles.length; i++) {
    const prev = candles.slice(i - lookback, i);
    high[i] = Math.max(...prev.map(c => c.high));
    low[i] = Math.min(...prev.map(c => c.low));
  }
  return { high, low };
}

function computeSeries(candles) {
  const prices = candles.map(c => c.close);
  const box = rollingBox(candles, P.boxLookback);
  return {
    candles, prices,
    emaFast: ema(prices, P.emaFast),
    emaSlow: ema(prices, P.emaSlow),
    emaTrend: ema(prices, P.emaTrend),
    rsi: rsi(prices, P.rsiPeriod),
    macd: macd(prices, P.macdFast, P.macdSlow, P.macdSignal),
    atr: atr(candles, P.atrPeriod),
    boxHigh: box.high, boxLow: box.low,
  };
}

function rawBiasAt(s, i) {
  const price = s.prices[i];
  const c = s.candles[i];
  const ef = s.emaFast[i], es = s.emaSlow[i], et = s.emaTrend[i];
  const a = s.atr[i];
  const hi = s.boxHigh[i], lo = s.boxLow[i];
  const hist = s.macd.hist[i];
  const r = s.rsi[i];

  if (ef == null || es == null || et == null || hist == null || !a || hi == null || lo == null)
    return { state: "WAIT", bias: "flat", confidence: 0, reason: "Noch zu wenig Daten" };

  const strength = Math.abs(ef - es) / a;
  const trendUp = ef > es && es > et && price > et;
  const trendDown = ef < es && es < et && price < et;
  const buffer = a * P.breakoutBufferAtr;
  const range = Math.max(c.high - c.low, 0.000001);
  const lowerPct = (Math.min(c.open, c.close) - c.low) / range;
  const upperPct = (c.high - Math.max(c.open, c.close)) / range;

  let trigger = "none";
  if (price > hi + buffer) trigger = "box_breakout_long";
  else if (price < lo - buffer) trigger = "box_breakout_short";
  else if (c.low <= lo + buffer && c.close > lo && lowerPct >= P.rejectionWickMin) trigger = "rejection_long";
  else if (c.high >= hi - buffer && c.close < hi && upperPct >= P.rejectionWickMin) trigger = "rejection_short";

  const longTrigger = trigger === "box_breakout_long" || trigger === "rejection_long";
  const shortTrigger = trigger === "box_breakout_short" || trigger === "rejection_short";
  const momentumUp = hist > 0, momentumDown = hist < 0;
  const rsiLongOk = r == null || (r >= 45 && r <= 72);
  const rsiShortOk = r == null || (r >= 28 && r <= 55);
  const strengthOk = strength >= P.strengthMin;

  if (longTrigger && trendUp && momentumUp && rsiLongOk && strengthOk) {
    let conf = 62;
    const reasons = [trigger === "box_breakout_long" ? "Box-Breakout" : "Box-Rejection", "Trend up", "MACD up"];
    if (trigger === "box_breakout_long") conf += 8;
    if (strength >= P.strengthMin * 1.35) conf += 8;
    if (r != null && r >= 52 && r <= 66) conf += 7;
    if (ef > es && es > et) conf += 7;
    conf = Math.min(94, Math.round(conf));
    return { state: conf >= 82 ? "STRONG_BUY" : "BUY", bias: "long", confidence: conf, reason: reasons.join(", ") };
  }

  if (shortTrigger && trendDown && momentumDown && rsiShortOk && strengthOk) {
    let conf = 62;
    const reasons = [trigger === "box_breakout_short" ? "Box-Breakdown" : "Box-Rejection", "Trend down", "MACD down"];
    if (trigger === "box_breakout_short") conf += 8;
    if (strength >= P.strengthMin * 1.35) conf += 8;
    if (r != null && r >= 34 && r <= 48) conf += 7;
    if (ef < es && es < et) conf += 7;
    conf = Math.min(94, Math.round(conf));
    return { state: conf >= 82 ? "STRONG_SELL" : "SELL", bias: "short", confidence: conf, reason: reasons.join(", ") };
  }

  return { state: "WAIT", bias: "flat", confidence: trigger === "none" ? 20 : 48, reason: "Kein Setup" };
}

function decide(s) {
  const n = s.prices.length;
  const start = Math.max(P.emaTrend, P.macdSlow + P.macdSignal, P.rsiPeriod, P.atrPeriod, P.boxLookback) + 1;
  let current = { state: "WAIT", bias: "flat", confidence: 0, reason: "Warte auf Daten" };
  let pendingSide = null, pendingCount = 0;

  for (let i = start; i < n; i++) {
    const raw = rawBiasAt(s, i);
    if (raw.bias === "flat") { pendingSide = null; pendingCount = 0; }
    else if (raw.bias === pendingSide) pendingCount++;
    else { pendingSide = raw.bias; pendingCount = 1; }

    if (i === n - 1) {
      const confirmed = raw.bias !== "flat" && pendingCount >= P.confirmBars;
      current = confirmed
        ? { state: raw.state, bias: raw.bias, confidence: raw.confidence, reason: raw.reason }
        : { state: "WAIT", bias: "flat", confidence: raw.confidence, reason: raw.reason };
    }
  }
  return current;
}

function levelsFor(state, entry, atrVal) {
  const long = state === "STRONG_BUY" || state === "BUY";
  const sl = long ? entry - P.atrSL * atrVal : entry + P.atrSL * atrVal;
  const tp1 = long ? entry + P.atrTP1 * atrVal : entry - P.atrTP1 * atrVal;
  const tp2 = long ? entry + P.atrTP2 * atrVal : entry - P.atrTP2 * atrVal;
  const risk = Math.abs(entry - sl);
  return {
    sl, tp1, tp2,
    rr1: risk > 0 ? Math.abs(tp1 - entry) / risk : 0,
    rr2: risk > 0 ? Math.abs(tp2 - entry) / risk : 0,
  };
}

// ── ntfy push ──

function toAscii(s) {
  return s.replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/[^\x20-\x7E]/g, "");
}

async function pushNtfy(topic, title, body, tags = []) {
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: toAscii(title), Tags: tags.join(","), Priority: "high" },
      body: toAscii(body),
    });
    console.log(`[scanner] ntfy push sent: ${title}`);
  } catch (e) {
    console.error(`[scanner] ntfy push failed:`, e.message);
  }
}

// ── Scanner loop ──

const pushedSignals = new Map(); // epic -> { state, ts }
const COOLDOWN_MS = 30 * 60 * 1000; // don't re-push same signal within 30 min

export function startScanner(capFn, ntfyTopic) {
  if (!ntfyTopic) {
    console.log("[scanner] no NTFY_TOPIC configured, server-side push disabled");
    return;
  }
  console.log(`[scanner] started — scanning ${WATCHLIST.length} assets every 2 min, pushing to ntfy topic "${ntfyTopic}"`);

  async function scan() {
    let signalCount = 0;
    for (const asset of WATCHLIST) {
      try {
        const d = await capFn("GET", `/api/v1/prices/${encodeURIComponent(asset.epic)}?resolution=MINUTE_15&max=300`);
        const raw = d.prices || [];
        if (raw.length < 90) continue;

        const candles = raw.map(p => {
          const mid = (v) => {
            if (v == null) return NaN;
            if (typeof v === "number") return v;
            const b = v.bid, a = v.ask ?? v.offer;
            if (b != null && a != null) return (b + a) / 2;
            return b ?? a ?? NaN;
          };
          return {
            time: Math.floor(Date.parse(p.snapshotTimeUTC || p.snapshotTime) / 1000),
            open: mid(p.openPrice), high: mid(p.highPrice),
            low: mid(p.lowPrice), close: mid(p.closePrice),
          };
        }).filter(c => Number.isFinite(c.close) && Number.isFinite(c.time));

        if (candles.length < 90) continue;

        const series = computeSeries(candles);
        const decision = decide(series);

        if (decision.state === "STRONG_BUY" || decision.state === "STRONG_SELL") {
          signalCount++;
          const prev = pushedSignals.get(asset.epic);
          if (prev && prev.state === decision.state && Date.now() - prev.ts < COOLDOWN_MS) continue;

          pushedSignals.set(asset.epic, { state: decision.state, ts: Date.now() });

          const dir = decision.bias === "long" ? "LONG" : "SHORT";
          const price = candles[candles.length - 1].close;
          const atrVal = series.atr[series.atr.length - 1];
          const lvl = atrVal ? levelsFor(decision.state, price, atrVal) : null;

          const lines = [
            `STARKES SIGNAL · ${decision.confidence}% Konfidenz`,
            `Entry: ${price.toFixed(2)}`,
            ...(lvl ? [
              `SL: ${lvl.sl.toFixed(2)}`,
              `TP1: ${lvl.tp1.toFixed(2)} (R:R 1:${lvl.rr1.toFixed(1)})`,
              `TP2: ${lvl.tp2.toFixed(2)} (R:R 1:${lvl.rr2.toFixed(1)})`,
            ] : []),
            `Grund: ${decision.reason}`,
          ];

          const tag = decision.bias === "long" ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
          await pushNtfy(ntfyTopic, `Box: ${asset.name} ${dir}`, lines.join("\n"), [tag, "rotating_light"]);
        }
      } catch {
        // skip assets that error (market closed, unknown epic, etc.)
      }
    }
    console.log(`[scanner] scan done — ${signalCount} active signal(s) found`);
  }

  // initial scan after 10s (let server boot first)
  setTimeout(scan, 10_000);
  // then every 2 minutes
  setInterval(scan, 2 * 60 * 1000);
}
