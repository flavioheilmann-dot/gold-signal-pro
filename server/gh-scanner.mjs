// GitHub Actions scanner — runs once, scans all assets, pushes strong signals.
// Uses .signal-cache.json to avoid re-pushing the same signal within 30 min.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { evaluateOpen, newSignal, hasConfluence, summarize, trimLog } from "./signal-journal.mjs";
import { tradingGate, isStale } from "./market-filter.mjs";

// Load server/.env for LOCAL runs (gitignored). In CI the vars come from
// the workflow `env:` (GitHub Secrets) and this file does not exist.
(function loadLocalEnv() {
  const path = existsSync("server/.env") ? "server/.env" : existsSync(".env") ? ".env" : null;
  if (!path) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const ENVN = (process.env.CAPITAL_ENV || "demo").toLowerCase();
const BASE = ENVN === "live"
  ? "https://api-capital.backend-capital.com"
  : "https://demo-api-capital.backend-capital.com";
const API_KEY = process.env.CAPITAL_API_KEY || "";
const IDENT = process.env.CAPITAL_IDENTIFIER || "";
const PASS = process.env.CAPITAL_API_PASSWORD || "";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

if (!API_KEY || !IDENT || !PASS) { console.error("Missing Capital.com credentials"); process.exit(1); }
if (!NTFY_TOPIC) { console.error("Missing NTFY_TOPIC"); process.exit(1); }

// ── Session ── (reused across loop runs; only re-login when expired)
let session = { cst: "", token: "" };
let authBlocked = false; // stop hammering Capital after an auth rejection
async function login() {
  const res = await fetch(`${BASE}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: IDENT, password: PASS }),
  });
  if (!res.ok) { authBlocked = true; throw new Error(`auth_failed ${res.status}`); }
  session = { cst: res.headers.get("CST") || "", token: res.headers.get("X-SECURITY-TOKEN") || "" };
}

async function cap(path) {
  if (authBlocked) throw new Error("auth_blocked");
  if (!session.cst) await login();
  const doFetch = () => fetch(`${BASE}${path}`, {
    headers: { CST: session.cst, "X-SECURITY-TOKEN": session.token },
  });
  let res = await doFetch();
  if (res.status === 401) { session.cst = ""; await login(); res = await doFetch(); }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ── Cache (persists across runs via GitHub Actions cache) ──
const CACHE_FILE = ".signal-cache.json";
const COOLDOWN = 30 * 60 * 1000;
let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }

function wasPushed(epic, state) {
  const prev = cache[epic];
  return prev && prev.state === state && Date.now() - prev.ts < COOLDOWN;
}
function markPushed(epic, state) {
  cache[epic] = { state, ts: Date.now() };
}
function saveCache() {
  // clean old entries
  const now = Date.now();
  for (const [k, v] of Object.entries(cache)) {
    if (now - v.ts > COOLDOWN * 2) delete cache[k];
  }
  writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
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

// ── Signal Engine ──
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

function macdCalc(data, fast, slow, sig) {
  const ef = ema(data, fast), es = ema(data, slow);
  const line = data.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
  const signal = new Array(data.length).fill(null);
  const first = line.findIndex(v => v != null);
  if (first >= 0) {
    const s = ema(line.slice(first), sig);
    for (let i = 0; i < s.length; i++) if (s[i] != null) signal[first + i] = s[i];
  }
  return { hist: data.map((_, i) => line[i] != null && signal[i] != null ? line[i] - signal[i] : null) };
}

function atr(candles, period) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
  let sum = 0;
  for (let i = 0; i < candles.length; i++) { sum += tr[i]; if (i > period) sum -= tr[i - period]; if (i >= period) out[i] = sum / period; }
  return out;
}

function analyze(candles) {
  const prices = candles.map(c => c.close);
  const n = prices.length;
  const emaF = ema(prices, P.emaFast), emaS = ema(prices, P.emaSlow), emaT = ema(prices, P.emaTrend);
  const rsiArr = rsi(prices, P.rsiPeriod);
  const macdArr = macdCalc(prices, P.macdFast, P.macdSlow, P.macdSignal);
  const atrArr = atr(candles, P.atrPeriod);

  // rolling box
  const boxH = new Array(n).fill(null), boxL = new Array(n).fill(null);
  for (let i = P.boxLookback; i < n; i++) {
    const prev = candles.slice(i - P.boxLookback, i);
    boxH[i] = Math.max(...prev.map(c => c.high));
    boxL[i] = Math.min(...prev.map(c => c.low));
  }

  const start = Math.max(P.emaTrend, P.macdSlow + P.macdSignal, P.rsiPeriod, P.atrPeriod, P.boxLookback) + 1;
  let result = { state: "WAIT", bias: "flat", confidence: 0, reason: "" };
  let pendingSide = null, pendingCount = 0;

  for (let i = start; i < n; i++) {
    const price = prices[i], c = candles[i];
    const ef = emaF[i], es = emaS[i], et = emaT[i], a = atrArr[i];
    const hi = boxH[i], lo = boxL[i], hist = macdArr.hist[i], r = rsiArr[i];
    let raw = { state: "WAIT", bias: "flat", confidence: 0, reason: "" };

    if (ef != null && es != null && et != null && hist != null && a && hi != null && lo != null) {
      const strength = Math.abs(ef - es) / a;
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
      const trendUp = ef > es && es > et && price > et;
      const trendDown = ef < es && es < et && price < et;
      const strOk = strength >= P.strengthMin;

      if (longT && trendUp && hist > 0 && (r == null || (r >= 45 && r <= 72)) && strOk) {
        let conf = 62;
        const reasons = [trigger === "box_breakout_long" ? "Box-Breakout" : "Box-Rejection", "Trend up", "MACD up"];
        if (trigger === "box_breakout_long") conf += 8;
        if (strength >= P.strengthMin * 1.35) conf += 8;
        if (r != null && r >= 52 && r <= 66) conf += 7;
        if (ef > es && es > et) conf += 7;
        conf = Math.min(94, Math.round(conf));
        raw = { state: conf >= 82 ? "STRONG_BUY" : "BUY", bias: "long", confidence: conf, reason: reasons.join(", ") };
      } else if (shortT && trendDown && hist < 0 && (r == null || (r >= 28 && r <= 55)) && strOk) {
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
  return { decision: result, atrLast: atrArr[n - 1] };
}

function mid(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const b = v.bid, a = v.ask ?? v.offer;
  if (b != null && a != null) return (b + a) / 2;
  return b ?? a ?? NaN;
}

function toAscii(s) {
  return s.replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/[^\x20-\x7E]/g, "");
}

// ── Track record (own = box, read-only other = ict) ──
const TRACK_FILE = "track-box.json";
const OTHER_TRACK = "track-ict.json";
const TF_SECONDS = 15 * 60;
function loadJson(path, fallback) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } }

/** Fetch + map recent candles for an epic (shared by scan + journal eval). */
async function fetchCandles(epic) {
  const d = await cap(`/api/v1/prices/${encodeURIComponent(epic)}?resolution=MINUTE_15&max=300`);
  return (d.prices || [])
    .map((p) => ({
      time: Math.floor(Date.parse(p.snapshotTimeUTC || p.snapshotTime) / 1000),
      open: mid(p.openPrice), high: mid(p.highPrice), low: mid(p.lowPrice), close: mid(p.closePrice),
    }))
    .filter((c) => Number.isFinite(c.close));
}

// ── Main ──
export async function runScan() {
  console.log(`[scanner] ${new Date().toISOString()} — scanning ${WATCHLIST.length} assets (${ENVN})`);
  authBlocked = false; // give auth one fresh chance per run
  try {
    if (!session.cst) await login();
  } catch (e) {
    console.error(`[scanner] LOGIN FEHLGESCHLAGEN: ${e.message} — Capital-Zugangsdaten (Env-Variablen) pruefen`);
    return;
  }
  let found = 0;

  // load track record, update outcomes of still-open signals
  const track = loadJson(TRACK_FILE, []);
  const otherTrack = existsSync(OTHER_TRACK) ? loadJson(OTHER_TRACK, []) : [];
  await evaluateOpen(track, fetchCandles);
  const gate = tradingGate();
  if (!gate.ok) console.log(`[scanner] push-gate zu: ${gate.reason} (Signale werden ausgewertet, aber nicht gepusht)`);

  for (const asset of WATCHLIST) {
    try {
      const candles = await fetchCandles(asset.epic);
      if (candles.length < 90) continue;
      if (isStale(candles[candles.length - 1].time, TF_SECONDS)) {
        console.log(`  · ${asset.name}: Markt zu / Daten veraltet`);
        continue;
      }
      const { decision, atrLast } = analyze(candles);

      if (decision.state === "STRONG_BUY" || decision.state === "STRONG_SELL") {
        found++;
        if (wasPushed(asset.epic, decision.state)) {
          console.log(`  ⏭ ${asset.name}: ${decision.state} (already pushed)`);
          continue;
        }
        if (!gate.ok) {
          console.log(`  ⏸ ${asset.name}: ${decision.state} — kein Push (${gate.reason})`);
          continue; // don't mark: re-push once the session opens
        }
        markPushed(asset.epic, decision.state);

        const dir = decision.bias === "long" ? "LONG" : "SHORT";
        const price = candles[candles.length - 1].close;
        const long = decision.state === "STRONG_BUY";
        const sl = atrLast ? (long ? price - P.atrSL * atrLast : price + P.atrSL * atrLast) : null;
        const tp1 = atrLast ? (long ? price + P.atrTP1 * atrLast : price - P.atrTP1 * atrLast) : null;
        const tp2 = atrLast ? (long ? price + P.atrTP2 * atrLast : price - P.atrTP2 * atrLast) : null;
        const conf = hasConfluence(asset.epic, dir, otherTrack);

        const lines = [
          `STARKES SIGNAL · ${decision.confidence}% Konfidenz`,
          ...(conf ? ["KONFLUENZ: ICT zeigt dieselbe Richtung"] : []),
          `Entry: ${price.toFixed(2)}`,
          ...(sl != null ? [`SL: ${sl.toFixed(2)}`, `TP1: ${tp1.toFixed(2)}`, `TP2: ${tp2.toFixed(2)}`] : []),
          `Grund: ${decision.reason}`,
          `Quelle: Capital.com · 15M · Box/EMA`,
          `Kein Finanzrat - zuerst selbst pruefen.`,
        ];

        const tag = long ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
        const title = conf ? `Box+ICT: ${asset.name} ${dir}` : `Box: ${asset.name} ${dir}`;
        await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
          method: "POST",
          headers: { Title: toAscii(title), Tags: conf ? `${tag},rotating_light,star` : `${tag},rotating_light`, Priority: "high" },
          body: toAscii(lines.join("\n")),
        });
        console.log(`  🔴 PUSH: ${asset.name} ${dir} (${decision.confidence}%)${conf ? " +KONFLUENZ" : ""}`);

        if (sl != null) {
          const rec = newSignal({ strategy: "Box", epic: asset.epic, name: asset.name, dir, entry: price, sl, tp1, tp2, confidence: decision.confidence, time: candles[candles.length - 1].time });
          rec.confluence = conf;
          track.push(rec);
        }
      }
    } catch (e) {
      // skip (market closed, unknown epic, etc.)
    }
  }

  saveCache();
  writeFileSync(TRACK_FILE, JSON.stringify(trimLog(track)), "utf8");
  const sum = summarize(track);
  console.log(`[scanner] done — ${found} strong, track: ${sum.closed} closed (${sum.wins}W/${sum.losses}L, ${sum.sumR}R), ${sum.open} open`);
}

// Auto-run when executed directly (GitHub Actions). The always-on worker sets
// BOX_LIB=1 and imports runScan instead, so this guard skips the auto-run.
if (process.env.BOX_LIB !== "1") runScan().catch((e) => { console.error(e); process.exit(1); });
