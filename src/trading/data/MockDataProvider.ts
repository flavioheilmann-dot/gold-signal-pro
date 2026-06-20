import type { Candle } from "../types";
import type { DataProvider } from "./DataProvider";

/**
 * Deterministic synthetic OHLC generator. Produces a random-walk with
 * realistic intrabar wicks plus occasional engineered liquidity sweeps,
 * so the strategy has something to detect in DEMO mode. Seedable for tests.
 *
 * NOT real market data — clearly labelled SIMULATION in the UI.
 */
export class MockDataProvider implements DataProvider {
  readonly name = "Mock (Simulation)";
  readonly mode = "mock" as const;

  private seed: number;
  private base: number;

  constructor(seed = 12345, basePrice = 2400) {
    this.seed = seed >>> 0;
    this.base = basePrice;
  }

  private rand(): number {
    // mulberry32 PRNG — deterministic for a given seed
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** `timeframe` like "5m"/"15m"/"1h" → seconds per candle. */
  private tfSeconds(tf: string): number {
    const m = tf.match(/^(\d+)\s*(m|h|d)$/i);
    if (!m) return 300;
    const n = Number(m[1]);
    return m[2].toLowerCase() === "h" ? n * 3600 : m[2].toLowerCase() === "d" ? n * 86400 : n * 60;
  }

  generate(_symbol: string, timeframe: string, limit: number): Candle[] {
    const step = this.tfSeconds(timeframe);
    const now = Math.floor(Date.now() / 1000);
    const start = now - limit * step;
    const out: Candle[] = [];
    let price = this.base;
    let drift = (this.rand() - 0.5) * 0.4;
    let displace = 0; // remaining displacement candles after a sweep
    let displaceDir = 0; // +1 up / -1 down

    for (let i = 0; i < limit; i++) {
      if (i % 24 === 0) drift = (this.rand() - 0.5) * 0.6; // regime shift
      const vol = this.base * 0.0009 * (0.6 + this.rand());
      const open = price;
      let body = drift * vol + (this.rand() - 0.5) * vol * 2;
      let close = open + body;
      let high = Math.max(open, close) + this.rand() * vol;
      let low = Math.min(open, close) - this.rand() * vol;

      // engineer a liquidity sweep every ~37 candles: spike a long wick
      // beyond the recent range, then close back inside (stop hunt), and
      // arm a displacement leg in the reversal direction (→ MSS + FVG).
      if (i > 35 && i % 37 === 0 && out.length > 10 && displace === 0) {
        const recent = out.slice(-10);
        const up = this.rand() > 0.5;
        if (up) {
          const rh = Math.max(...recent.map((c) => c.high));
          high = rh + vol * 2.2;
          close = open - Math.abs(body) * 0.3; // reject back down
          low = Math.min(low, Math.min(open, close) - this.rand() * vol);
          displaceDir = -1;
        } else {
          const rl = Math.min(...recent.map((c) => c.low));
          low = rl - vol * 2.2;
          close = open + Math.abs(body) * 0.3; // reclaim up
          high = Math.max(high, Math.max(open, close) + this.rand() * vol);
          displaceDir = 1;
        }
        displace = 4;
      } else if (displace > 0) {
        // strong directional candles with thin wicks → break structure & leave a gap
        body = displaceDir * vol * 2.6;
        close = open + body;
        high = Math.max(open, close) + this.rand() * vol * 0.15;
        low = Math.min(open, close) - this.rand() * vol * 0.15;
        displace--;
      }

      out.push({
        time: start + i * step,
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
      });
      price = close;
    }
    return out;
  }

  async getCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
    return this.generate(symbol, timeframe, limit);
  }

  async getSpreadPct(): Promise<number> {
    return 0.01 + this.rand() * 0.02; // 0.01–0.03%
  }
}
