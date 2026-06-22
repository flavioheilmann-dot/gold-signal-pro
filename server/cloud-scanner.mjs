// ─────────────────────────────────────────────────────────────
// Cloud Scanner — runs on Render (free tier) 24/7.
// Scans all watchlist assets via Capital.com API every 2 min,
// sends ntfy push for STRONG signals only.
//
// Env vars needed: CAPITAL_API_KEY, CAPITAL_IDENTIFIER,
//   CAPITAL_API_PASSWORD, CAPITAL_ENV, NTFY_TOPIC
// ─────────────────────────────────────────────────────────────
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const ENVN = (process.env.CAPITAL_ENV || "demo").toLowerCase();
const BASE = ENVN === "live"
  ? "https://api-capital.backend-capital.com"
  : "https://demo-api-capital.backend-capital.com";
const API_KEY = process.env.CAPITAL_API_KEY || "";
const IDENT = process.env.CAPITAL_IDENTIFIER || "";
const PASS = process.env.CAPITAL_API_PASSWORD || "";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const PORT = process.env.PORT || 10000;

if (!API_KEY || !IDENT || !PASS) {
  console.error("Missing CAPITAL_API_KEY / CAPITAL_IDENTIFIER / CAPITAL_API_PASSWORD");
  process.exit(1);
}
if (!NTFY_TOPIC) {
  console.error("Missing NTFY_TOPIC");
  process.exit(1);
}

// ── Capital.com session ──

let session = { cst: "", token: "", ts: 0 };

async function login() {
  const res = await fetch(`${BASE}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password: PASS }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`auth_failed ${res.status} ${t.slice(0, 180)}`);
  }
  session = {
    cst: res.headers.get("CST") || "",
    token: res.headers.get("X-SECURITY-TOKEN") || "",
    ts: Date.now(),
  };
}

async function ensureSession() {
  if (session.cst && Date.now() - session.ts < 9 * 60 * 1000) return;
  await login();
}

async function cap(method, path) {
  await ensureSession();
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { CST: session.cst, "X-SECURITY-TOKEN": session.token },
    });
  let res = await doFetch();
  if (res.status === 401) { await login(); res = await doFetch(); }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// ── Watchlist ──

const WATCHLIST = [
  { epic: "EURUSD", name: "EUR/USD" }, { epic: "US500", name: "US 500" },
  { epic: "GOLD", name: "Gold" }, { epic: "US100", name: "US Tech 100" },
  { epic: "DE40", name: "Germany 40" }, { epic: "FR40", name: "France 40" },
  { epic: "UK100", name: "UK 100" }, { epic: "J225", name: "Japan 225" },
  { epic: "HK50", name: "Hong Kong 50" }, { epic: "EU50", name: "EU Stocks 50" },
  { epic: "GBPUSD", name: "GBP/USD" }, { epic: "USDJPY", name: "USD/JPY" },
  { epic: "USDCHF", name: "USD/CHF" }, { epic: "AUDUSD", name: "AUD/USD" },
  { epic: "USDCAD", name: "USD/CAD" }, { epic: "EURGBP", name: "EUR/GBP" },
  { epic: "EURJPY", name: "EUR/JPY" }, { epic: "EURCHF", name: "EUR/CHF" },
  { epic: "SILVER", name: "Silver" }, { epic: "PLATINUM", name: "Platinum" },
  { epic: "OIL_CRUDE", name: "Crude Oil Spot" }, { epic: "NATURALGAS", name: "Natural Gas" },
  { epic: "BTCUSD", name: "Bitcoin/USD" }, { epic: "ETHUSD", name: "Ethereum/USD" },
  { epic: "SOLUSD", name: "Solana/USD" },
  { epic: "AAPL", name: "Apple Inc" }, { epic: "NVDA", name: "NVIDIA Corp" },
  { epic: "MSFT", name: "Microsoft Corp" }, { epic: "TSLA", name: "Tesla Inc" },
  { epic: "AMZN", name: "Amazon.com Inc" }, { epic: "GOOGL", name: "Alphabet Inc - A" },
  { epic: "META", name: "Meta Platforms Inc" }, { epic: "AMD", name: "Advanced Micro Devices Inc" },
  { epic: "NFLX", name: "Netflix Inc" }, { epic: "JPM", name: "JPMorgan Chase & Co" },
  { epic: "V", name: "Visa Inc" }, { epic: "BA", name: "Boeing Co" },
];

// ── Signal Engine (indicators + decision) ──

const P = {
  emaFast: 9, emaSlow: 21, emaTrend: 50,
  rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9,
  atrPeriod: 14, strengthMin: 0.65, confirmBars: 2,
  atrSL: 1.5, atrTP1: 2.5, atrTP2: 4.0,
  boxLookback: 30, breakoutBufferAtr: 0.22, rejectionWickMin: 0.55,
};

function ema(data, period) {
  const out = new Array(data.length).fill(null);
  if (data.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < data.length; i++) { prev = data[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

function rsi(data, period) {
  const out = new Array(data.length).fill(null);
  if (data.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = data[i] - data[i - 1]; if (d >= 0) gain += d; else loss -= d; }
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

function macdCalc(data, fast, slow, signalPeriod) {
  const ef = ema(data, fast), es = ema(data, slow);
  const line = data.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
  const signal = new Array(data.length).fill(null);
  const first = line.findIndex(v => v != null);
  if (first >= 0) {
    const sig = ema(line.slice(first), signalPeriod);
    for (let i = 0; i < sig.length; i++) if (sig[i] != null) signal[first + i] = sig[i];
  }
  const hist = data.map((_, i) => line[i] != null && signal[i] != null ? line[i] - signal[i] : null);
  return { line, signal, hist };
}

function atr(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))
  );
  let sum = 0;
  for (let i = 0; i < candles.length; i++) { sum += tr[i]; if (i > period) sum -= tr[i - period]; if (i >= period) out[i] = sum / period; }
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

function analyze(candles) {
  const prices = candles.map(c => c.close);
  const box = rollingBox(candles, P.boxLookback);
  const s = {
    candles, prices,
    emaFast: ema(prices, P.emaFast), emaSlow: ema(prices, P.emaSlow),
    emaTrend: ema(prices, P.emaTrend), rsi: rsi(prices, P.rsiPeriod),
    macd: macdCalc(prices, P.macdFast, P.macdSlow, P.macdSignal),
    atr: atr(candles, P.atrPeriod), boxHigh: box.high, boxLow: box.low,
  };

  const n = prices.length;
  const start = Math.max(P.emaTrend, P.macdSlow + P.macdSignal, P.rsiPeriod, P.atrPeriod, P.boxLookback) + 1;
  let result = { state: "WAIT", bias: "flat", confidence: 0, reason: "Warte" };
  let pendingSide = null, pendingCount = 0;

  for (let i = start; i < n; i++) {
    const price = prices[i]; const c = candles[i];
    const ef = s.emaFast[i], es = s.emaSlow[i], et = s.emaTrend[i];
    const a = s.atr[i]; const hi = s.boxHigh[i], lo = s.boxLow[i];
    const hist = s.macd.hist[i]; const r = s.rsi[i];

    let raw = { state: "WAIT", bias: "flat", confidence: 0, reason: "" };

    if (ef != null && es != null && et != null && hist != null && a && hi != null && lo != null) {
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

      const longT = trigger === "box_breakout_long" || trigger === "rejection_long";
      const shortT = trigger === "box_breakout_short" || trigger === "rejection_short";
      const mUp = hist > 0, mDown = hist < 0;
      const rsiLOk = r == null || (r >= 45 && r <= 72);
      const rsiSOk = r == null || (r >= 28 && r <= 55);
      const strOk = strength >= P.strengthMin;

      if (longT && trendUp && mUp && rsiLOk && strOk) {
        let conf = 62;
        const reasons = [trigger === "box_breakout_long" ? "Box-Breakout" : "Box-Rejection", "Trend up", "MACD up"];
        if (trigger === "box_breakout_long") conf += 8;
        if (strength >= P.strengthMin * 1.35) conf += 8;
        if (r != null && r >= 52 && r <= 66) conf += 7;
        if (ef > es && es > et) conf += 7;
        conf = Math.min(94, Math.round(conf));
        raw = { state: conf >= 82 ? "STRONG_BUY" : "BUY", bias: "long", confidence: conf, reason: reasons.join(", ") };
      } else if (shortT && trendDown && mDown && rsiSOk && strOk) {
        let conf = 62;
        const reasons = [trigger === "box_breakout_short" ? "Box-Breakdown" : "Box-Rejection", "Trend down", "MACD down"];
        if (trigger === "box_breakout_short") conf += 8;
        if (strength >= P.strengthMin * 1.35) conf += 8;
        if (r != null && r >= 34 && r <= 48) conf += 7;
        if (ef < es && es < et) conf += 7;
        conf = Math.min(94, Math.round(conf));
        raw = { state: conf >= 82 ? "STRONG_SELL" : "SELL", bias: "short", confidence: conf, reason: reasons.join(", ") };
      }
    }

    if (raw.bias === "flat") { pendingSide = null; pendingCount = 0; }
    else if (raw.bias === pendingSide) pendingCount++;
    else { pendingSide = raw.bias; pendingCount = 1; }

    if (i === n - 1) {
      const confirmed = raw.bias !== "flat" && pendingCount >= P.confirmBars;
      result = confirmed ? raw : { state: "WAIT", bias: "flat", confidence: raw.confidence, reason: raw.reason };
    }
  }
  return { decision: result, atrLast: s.atr[n - 1] };
}

function mid(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const b = v.bid, a = v.ask ?? v.offer;
  if (b != null && a != null) return (b + a) / 2;
  return b ?? a ?? NaN;
}

// ── ntfy push ──

function toAscii(s) {
  return s.replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/[^\x20-\x7E]/g, "");
}

async function pushNtfy(title, body, tags = []) {
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: "POST",
      headers: { Title: toAscii(title), Tags: tags.join(","), Priority: "high" },
      body: toAscii(body),
    });
    console.log(`[push] ${title}`);
  } catch (e) {
    console.error(`[push] failed:`, e.message);
  }
}

// ── Scanner loop ──

const pushed = new Map();
const COOLDOWN = 30 * 60 * 1000;

async function scan() {
  let found = 0;
  for (const asset of WATCHLIST) {
    try {
      const d = await cap("GET", `/api/v1/prices/${encodeURIComponent(asset.epic)}?resolution=MINUTE_15&max=300`);
      const raw = d.prices || [];
      if (raw.length < 90) continue;

      const candles = raw.map(p => ({
        time: Math.floor(Date.parse(p.snapshotTimeUTC || p.snapshotTime) / 1000),
        open: mid(p.openPrice), high: mid(p.highPrice),
        low: mid(p.lowPrice), close: mid(p.closePrice),
      })).filter(c => Number.isFinite(c.close));

      if (candles.length < 90) continue;
      const { decision, atrLast } = analyze(candles);

      if (decision.state === "STRONG_BUY" || decision.state === "STRONG_SELL") {
        found++;
        const prev = pushed.get(asset.epic);
        if (prev && prev.state === decision.state && Date.now() - prev.ts < COOLDOWN) continue;
        pushed.set(asset.epic, { state: decision.state, ts: Date.now() });

        const dir = decision.bias === "long" ? "LONG" : "SHORT";
        const price = candles[candles.length - 1].close;
        const long = decision.state === "STRONG_BUY";
        const sl = atrLast ? (long ? price - P.atrSL * atrLast : price + P.atrSL * atrLast) : null;
        const tp1 = atrLast ? (long ? price + P.atrTP1 * atrLast : price - P.atrTP1 * atrLast) : null;
        const tp2 = atrLast ? (long ? price + P.atrTP2 * atrLast : price - P.atrTP2 * atrLast) : null;

        const lines = [
          `STARKES SIGNAL · ${decision.confidence}% Konfidenz`,
          `Entry: ${price.toFixed(2)}`,
          ...(sl != null ? [`SL: ${sl.toFixed(2)}`, `TP1: ${tp1.toFixed(2)}`, `TP2: ${tp2.toFixed(2)}`] : []),
          `Grund: ${decision.reason}`,
        ];

        const tag = long ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
        await pushNtfy(`Box: ${asset.name} ${dir}`, lines.join("\n"), [tag, "rotating_light"]);
      }
    } catch { /* skip */ }
  }
  console.log(`[scan] ${new Date().toISOString().slice(11, 19)} — ${found} starke(s) Signal(e)`);
}

// ── Minimal HTTP server (Render needs a port to keep the service alive) ──

import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, scanner: true, assets: WATCHLIST.length, env: ENVN }));
  } else {
    res.writeHead(200); res.end("Gold Signal Pro — Cloud Scanner");
  }
});

server.listen(PORT, () => {
  console.log(`[cloud-scanner] running on :${PORT} · ${ENVN.toUpperCase()} · ${WATCHLIST.length} assets · ntfy: ${NTFY_TOPIC}`);
  scan();
  setInterval(scan, 2 * 60 * 1000);
});
