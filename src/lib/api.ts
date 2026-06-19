// ─────────────────────────────────────────────────────────────
// Market data with cleanly separated sources:
//
//  • XAU/USD spot   → gold-api.com (real spot, the MAIN displayed price)
//  • PAXG/USD OHLC  → CoinGecko 4h candles (chart + indicator engine,
//                     a 24/7 PROXY for gold — XAU/USD ≠ PAXG/USD)
//
// Each source fails independently and degrades to a labelled fallback,
// so the UI can always show a clear data-source + offline state.
// ─────────────────────────────────────────────────────────────

export type SourceState = "live" | "sim";

export interface Candle {
  time: number; // unix SECONDS (lightweight-charts format)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketData {
  candles: Candle[]; // PAXG 4h OHLC (proxy)
  xau: number | null; // XAU/USD spot
  xauUpdatedAt: number | null;
  paxg: number; // PAXG/USD (last candle close)
  changePct: number; // 24h change (from candles)
  timeframe: string; // "4H"
  xauSource: string;
  candleSource: string;
  candleState: SourceState;
  xauState: SourceState;
  fetchedAt: number;
}

const OHLC_URL =
  "https://api.coingecko.com/api/v3/coins/pax-gold/ohlc?vs_currency=usd&days=30";
const XAU_URL = "https://api.gold-api.com/price/XAU";

async function fetchCandles(): Promise<{ candles: Candle[]; state: SourceState }> {
  try {
    const res = await fetch(OHLC_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const raw = (await res.json()) as [number, number, number, number, number][];
    if (!Array.isArray(raw) || raw.length < 60) throw new Error("thin data");
    const candles = raw.map((c) => ({
      time: Math.floor(c[0] / 1000),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
    }));
    return { candles, state: "live" };
  } catch {
    return { candles: synthCandles(), state: "sim" };
  }
}

async function fetchXau(): Promise<{ price: number | null; updatedAt: number | null }> {
  try {
    const res = await fetch(XAU_URL, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = (await res.json()) as { price: number; updatedAt: string };
    if (typeof j.price !== "number") throw new Error("no price");
    return { price: j.price, updatedAt: Date.parse(j.updatedAt) || Date.now() };
  } catch {
    return { price: null, updatedAt: null };
  }
}

export async function fetchMarket(): Promise<MarketData> {
  const [c, x] = await Promise.all([fetchCandles(), fetchXau()]);
  const closes = c.candles.map((k) => k.close);
  const paxg = closes[closes.length - 1];
  const back = closes[Math.max(0, closes.length - 7)]; // ~24h (6×4h) ago
  const changePct = ((paxg - back) / back) * 100;

  return {
    candles: c.candles,
    xau: x.price,
    xauUpdatedAt: x.updatedAt,
    paxg,
    changePct,
    timeframe: "4H",
    xauSource: x.price != null ? "gold-api.com" : "PAXG-Proxy (XAU n/v)",
    candleSource: c.state === "live" ? "CoinGecko · PAX Gold" : "Simulation (offline)",
    candleState: c.state,
    xauState: x.price != null ? "live" : "sim",
    fetchedAt: Date.now(),
  };
}

/** Deterministic-ish OHLC fallback (gold-priced, 4h) for offline demos. */
function synthCandles(): Candle[] {
  const n = 180; // ~30 days of 4h candles
  const now = Math.floor(Date.now() / 1000);
  const out: Candle[] = [];
  let p = 4250 + Math.random() * 80;
  let drift = (Math.random() - 0.5) * 4;
  for (let i = 0; i < n; i++) {
    if (i % 18 === 0) drift = (Math.random() - 0.5) * 8;
    const open = p;
    const move = drift + (Math.random() - 0.5) * 14;
    const close = Math.max(3000, open + move);
    const high = Math.max(open, close) + Math.random() * 8;
    const low = Math.min(open, close) - Math.random() * 8;
    out.push({
      time: now - (n - i) * 4 * 3600,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
    p = close;
  }
  return out;
}
