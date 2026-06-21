// ─────────────────────────────────────────────────────────────
// Session / news / staleness filters for the cloud scanners.
// All UTC. Goal: push only during liquid hours, skip weekends, skip a
// blackout window around the biggest scheduled US news, and skip an epic
// whose candles are stale (market closed / not updating).
// ─────────────────────────────────────────────────────────────

/** CFD/forex week is effectively closed Fri 21:00 UTC → Sun 22:00 UTC. */
export function isWeekend(d = new Date()) {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return true;                 // Saturday
  if (day === 0 && h < 22) return true;       // Sunday before weekly open
  if (day === 5 && h >= 21) return true;      // Friday after close
  return false;
}

/** London + New York liquidity window (07:00–21:00 UTC). */
export function inActiveSession(d = new Date()) {
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= 7 && h < 21;
}

export function isActiveTradingTime(d = new Date()) {
  return !isWeekend(d) && inActiveSession(d);
}

/** First Friday of the month (NFP day). */
function isFirstFriday(d) {
  return d.getUTCDay() === 5 && d.getUTCDate() <= 7;
}

// FOMC decision days 2026 (second meeting day). Release ~18:00–19:00 UTC.
// Verify/extend against the official Fed calendar each year.
const FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

/**
 * High-impact US news blackout:
 *  • NFP  — first Friday, 12:15–13:45 UTC (covers EDT 12:30 / EST 13:30)
 *  • FOMC — decision days, 17:45–20:00 UTC
 * (CPI dates vary monthly and would need a calendar feed — not faked here.)
 */
export function inNewsBlackout(d = new Date()) {
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (isFirstFriday(d) && h >= 12.25 && h <= 13.75) return "NFP";
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (FOMC_2026.includes(ymd) && h >= 17.75 && h <= 20) return "FOMC";
  return null;
}

/** Candle is stale (last bar older than 3× the timeframe) → market closed. */
export function isStale(lastCandleSec, tfSeconds, now = Date.now()) {
  if (!lastCandleSec) return true;
  return now / 1000 - lastCandleSec > tfSeconds * 3;
}

export function tfSeconds(tf) {
  const m = String(tf).match(/^(\d+)\s*(m|h|d)$/i);
  if (!m) return 300;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  return u === "h" ? n * 3600 : u === "d" ? n * 86400 : n * 60;
}

/** One combined gate. Returns { ok, reason }. */
export function tradingGate(now = new Date()) {
  if (isWeekend(now)) return { ok: false, reason: "Wochenende" };
  if (!inActiveSession(now)) return { ok: false, reason: "ausserhalb London/NY" };
  const news = inNewsBlackout(now);
  if (news) return { ok: false, reason: `News-Sperre (${news})` };
  return { ok: true, reason: null };
}
