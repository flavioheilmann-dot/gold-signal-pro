import type { Candle, SessionName } from "../types";

// Approximate session windows by UTC hour. ICT killzones roughly:
//   Asia      00:00–07:00 UTC
//   London    07:00–12:00 UTC  (London open killzone ~07–10)
//   New York AM 12:00–16:00 UTC (NY open ~13:30 UTC / 08:30 ET)
//   New York PM 16:00–21:00 UTC
//   off       21:00–00:00 UTC
// Windows are intentionally simple/UTC-based; refine per instrument if needed.
const WINDOWS: { name: Exclude<SessionName, "off">; start: number; end: number }[] = [
  { name: "asia", start: 0, end: 7 },
  { name: "london", start: 7, end: 12 },
  { name: "newyork_am", start: 12, end: 16 },
  { name: "newyork_pm", start: 16, end: 21 },
];

export function sessionOf(timeSec: number): SessionName {
  const h = new Date(timeSec * 1000).getUTCHours();
  for (const w of WINDOWS) if (h >= w.start && h < w.end) return w.name;
  return "off";
}

/** Preferred entry sessions per spec: London open, NY open, NY PM. */
export function isPreferredSession(s: SessionName): boolean {
  return s === "london" || s === "newyork_am" || s === "newyork_pm";
}

/**
 * ICT killzones (the highest-probability windows TJR trades): London open
 * 07:00–10:00 UTC and New York open 12:00–15:00 UTC. Used as an optional hard
 * entry filter.
 */
export function isKillzone(timeSec: number): boolean {
  const h = new Date(timeSec * 1000).getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}

export const SESSION_LABEL: Record<SessionName, string> = {
  asia: "Asia",
  london: "London",
  newyork_am: "New York AM",
  newyork_pm: "New York PM",
  off: "Off-Session",
};

/** UTC day key (YYYY-DDD) so we can group candles by calendar day. */
function dayKey(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export interface SessionRange {
  session: Exclude<SessionName, "off">;
  high: number;
  low: number;
  day: string;
  lastIndex: number;
}

/**
 * High/low of the most recent (latest) occurrence of each session found in
 * `candles`. Used as liquidity pools (session highs/lows).
 */
export function latestSessionRanges(candles: Candle[]): SessionRange[] {
  const groups = new Map<string, SessionRange>();
  candles.forEach((c, i) => {
    const s = sessionOf(c.time);
    if (s === "off") return;
    const key = `${dayKey(c.time)}:${s}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { session: s, high: c.high, low: c.low, day: dayKey(c.time), lastIndex: i });
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.lastIndex = i;
    }
  });
  // keep the latest occurrence per session name
  const latest = new Map<Exclude<SessionName, "off">, SessionRange>();
  for (const g of groups.values()) {
    const prev = latest.get(g.session);
    if (!prev || g.lastIndex > prev.lastIndex) latest.set(g.session, g);
  }
  return [...latest.values()];
}

/** Previous completed UTC day's high/low (the classic PDH/PDL pools). */
export function previousDayRange(candles: Candle[]): { high: number; low: number; index: number } | null {
  if (!candles.length) return null;
  const byDay = new Map<string, { high: number; low: number; lastIndex: number }>();
  const order: string[] = [];
  candles.forEach((c, i) => {
    const k = dayKey(c.time);
    const g = byDay.get(k);
    if (!g) {
      byDay.set(k, { high: c.high, low: c.low, lastIndex: i });
      order.push(k);
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.lastIndex = i;
    }
  });
  if (order.length < 2) return null;
  const prev = byDay.get(order[order.length - 2])!;
  return { high: prev.high, low: prev.low, index: prev.lastIndex };
}
