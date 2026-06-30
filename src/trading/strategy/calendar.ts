// ─────────────────────────────────────────────────────────────
// High-impact US economic-event calendar (the "don't trade into news" gate).
//
// Event instants are stored as EXACT UTC timestamps taken from a real economic
// calendar (Financial Modeling Prep, fetched 2026-06-30) — not deterministic
// guesses — so US daylight-saving shifts (8:30 ET = 12:30 UTC summer / 13:30
// winter; FOMC 14:00 ET = 18:00 / 19:00 UTC) are already baked in correctly.
//
// Extend this table once a year against the official BLS / Federal Reserve
// release schedules. NFP = first Friday, CPI ~mid-month, FOMC = 8 meetings/yr.
// ─────────────────────────────────────────────────────────────

export type EconKind = "NFP" | "CPI" | "FOMC";

export interface EconEvent {
  kind: EconKind;
  title: string;
  at: number; // unix ms (UTC instant of the release)
}

interface Spec { kind: EconKind; iso: string }

// Exact UTC release instants (high-impact only). Source: FMP economics-calendar.
const SPECS: Spec[] = [
  { kind: "NFP", iso: "2026-07-02T12:30:00Z" },
  { kind: "CPI", iso: "2026-07-14T12:30:00Z" },
  { kind: "FOMC", iso: "2026-07-29T18:00:00Z" },
  { kind: "NFP", iso: "2026-08-07T12:30:00Z" },
  { kind: "CPI", iso: "2026-08-12T12:30:00Z" },
  { kind: "NFP", iso: "2026-09-04T12:30:00Z" },
  { kind: "CPI", iso: "2026-09-11T12:30:00Z" },
  { kind: "FOMC", iso: "2026-09-16T18:00:00Z" },
  { kind: "NFP", iso: "2026-10-02T12:30:00Z" },
  { kind: "CPI", iso: "2026-10-14T12:30:00Z" },
  { kind: "FOMC", iso: "2026-10-28T18:00:00Z" },
  { kind: "NFP", iso: "2026-11-06T13:30:00Z" },
  { kind: "CPI", iso: "2026-11-10T13:30:00Z" },
  { kind: "NFP", iso: "2026-12-04T13:30:00Z" },
  { kind: "FOMC", iso: "2026-12-09T19:00:00Z" },
  { kind: "CPI", iso: "2026-12-10T13:30:00Z" },
];

const TITLE: Record<EconKind, string> = {
  NFP: "US Non-Farm Payrolls",
  CPI: "US Verbraucherpreise (CPI)",
  FOMC: "US Fed-Zinsentscheid (FOMC)",
};

// Blackout window (minutes) around each release: don't enter from `pre` minutes
// before to `post` minutes after. FOMC is wider (decision + press conference).
const WINDOW: Record<EconKind, { pre: number; post: number }> = {
  NFP: { pre: 15, post: 30 },
  CPI: { pre: 15, post: 30 },
  FOMC: { pre: 15, post: 75 },
};

const EVENTS: EconEvent[] = SPECS
  .map((s) => ({ kind: s.kind, title: TITLE[s.kind], at: Date.parse(s.iso) }))
  .filter((e) => Number.isFinite(e.at))
  .sort((a, b) => a.at - b.at);

/** The next high-impact event at/after `now` (null once the table runs out). */
export function nextEvent(now = Date.now()): EconEvent | null {
  return EVENTS.find((e) => e.at + WINDOW[e.kind].post * 60000 >= now) ?? null;
}

/**
 * Are we inside a high-impact-news blackout right now? Returns the event when
 * active so the UI can name it ("News-Sperre: FOMC").
 */
export function newsBlackout(now = Date.now()): { active: boolean; event: EconEvent | null } {
  for (const e of EVENTS) {
    const w = WINDOW[e.kind];
    if (now >= e.at - w.pre * 60000 && now <= e.at + w.post * 60000) {
      return { active: true, event: e };
    }
  }
  return { active: false, event: null };
}

/** Engine gate: true while a blackout is active (suppresses fresh signals). */
export function newsRiskNow(now = Date.now()): boolean {
  return newsBlackout(now).active;
}

/** Minutes until an event (negative = it already passed). */
export function minutesUntil(e: EconEvent, now = Date.now()): number {
  return Math.round((e.at - now) / 60000);
}
