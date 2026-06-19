// ─────────────────────────────────────────────────────────────
// Gold / XAU trading-hours logic modelled on Capital.com's "Gold"
// (server time EET/EEST, i.e. UTC+2 winter / UTC+3 summer):
//
//   Summer (EU DST): open Sun 22:00 UTC · close Fri 21:00 UTC ·
//                    daily maintenance break 21:00–22:00 UTC
//   Winter:          open Sun 23:00 UTC · close Fri 22:00 UTC ·
//                    daily maintenance break 22:00–23:00 UTC
//
// The PAXG price feed itself is 24/7; this only decides whether the
// tradeable market shows LIVE / PAUSE / MARKT ZU. Exact break minutes
// can still vary slightly by instrument — verify on the platform.
// ─────────────────────────────────────────────────────────────

export type MarketState = "open" | "weekend" | "break";

export interface MarketStatus {
  open: boolean;
  state: MarketState;
  label: string;
  detail: string;
}

function fmtOpen(d: Date): string {
  return (
    d.toLocaleString("de-CH", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }) + " Uhr"
  );
}

/** Day-of-month (UTC) of the last Sunday in `month` (0-indexed). */
function lastSundayUTC(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** EU daylight-saving: last Sun of March 01:00 UTC → last Sun of Oct 01:00 UTC. */
function isEuSummer(d: Date): boolean {
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 2, lastSundayUTC(y, 2), 1, 0, 0);
  const end = Date.UTC(y, 9, lastSundayUTC(y, 9), 1, 0, 0);
  const t = d.getTime();
  return t >= start && t < end;
}

interface Hours {
  openHour: number; // Sunday weekly open (UTC)
  breakStart: number; // daily maintenance start (UTC)
  breakEnd: number; // daily maintenance end (UTC)
}

function hoursFor(d: Date): Hours {
  return isEuSummer(d)
    ? { openHour: 22, breakStart: 21, breakEnd: 22 }
    : { openHour: 23, breakStart: 22, breakEnd: 23 };
}

/** Next weekly open (Sunday `openHour`:00 UTC) at or after `now`. */
function nextWeeklyOpen(now: Date, openHour: number): Date {
  const add = (7 - now.getUTCDay()) % 7; // days until Sunday (0 if Sunday)
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + add,
      openHour,
      0,
      0
    )
  );
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 7);
  }
  return target;
}

export function getMarketStatus(now: Date): MarketStatus {
  const { openHour, breakStart, breakEnd } = hoursFor(now);
  const day = now.getUTCDay(); // 0 Sun .. 6 Sat
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;

  // Weekend: Friday from the break onward (no reopen that day), all of
  // Saturday, and Sunday before the weekly open.
  const friClosed = day === 5 && h >= breakStart;
  const satClosed = day === 6;
  const sunClosed = day === 0 && h < openHour;

  if (friClosed || satClosed || sunClosed) {
    return {
      open: false,
      state: "weekend",
      label: "MARKT ZU",
      detail: "Öffnet " + fmtOpen(nextWeeklyOpen(now, openHour)),
    };
  }

  // Daily maintenance break (Mon–Thu; Fri folded into weekend above,
  // Sun pre-open handled above).
  if (h >= breakStart && h < breakEnd) {
    const open = new Date(now);
    open.setUTCHours(breakEnd, 0, 0, 0);
    return {
      open: false,
      state: "break",
      label: "PAUSE",
      detail: "Öffnet " + fmtOpen(open),
    };
  }

  return { open: true, state: "open", label: "LIVE", detail: "" };
}
