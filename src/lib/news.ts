// ─────────────────────────────────────────────────────────────
// Curated, source-attributed gold-driver briefing (Stand Juni 2026).
// Every item MUST carry a source + date. Items without a verifiable
// source are not listed — the UI then shows "Keine verifizierte
// Prognose verfügbar". News is a soft hint, never a hard signal.
// ─────────────────────────────────────────────────────────────

export type NewsLean = "bull" | "bear" | "risk";

export interface NewsItem {
  tag: string;
  lean: NewsLean;
  text: string;
  source: string;
  date: string; // ISO-ish, e.g. "2026-06"
}

export interface NewsBias {
  bullPct: number;
  bull: number;
  bear: number;
  risk: number;
}

export function newsBias(items: NewsItem[]): NewsBias {
  const bull = items.filter((i) => i.lean === "bull").length;
  const bear = items.filter((i) => i.lean === "bear").length;
  const risk = items.filter((i) => i.lean === "risk").length;
  const avg = items.length ? (bull - bear) / items.length : 0;
  return {
    bullPct: Math.round(Math.max(10, Math.min(90, 50 + avg * 45))),
    bull,
    bear,
    risk,
  };
}

export const GOLD_NEWS: NewsItem[] = [
  {
    tag: "FED",
    lean: "risk",
    text: "Fed-Sitzung 16.–17. Juni: Markt preist ~97% kein Zinsschritt – richtungweisend ist der Dot-Plot (Projektionen).",
    source: "CME FedWatch / Fed",
    date: "2026-06",
  },
  {
    tag: "RENDITEN",
    lean: "bear",
    text: "US-10-Jahres-Rendite ~4,34% – nahe Hoch seit 2007; hohe Realzinsen erhöhen die Opportunitätskosten von Gold.",
    source: "U.S. Treasury / Discovery Alert",
    date: "2026-06",
  },
  {
    tag: "ZENTRALBANKEN",
    lean: "bull",
    text: "Notenbanken kaufen weiter (~243 t Basisnachfrage) – struktureller Rückhalt trotz ETF-Schwäche.",
    source: "World Gold Council (Q1 2026)",
    date: "2026-Q1",
  },
  {
    tag: "FLOWS",
    lean: "bear",
    text: "Gold-ETF-Zuflüsse −55% in Q1, Schmucknachfrage −41% – schwächere Invest/Konsum-Nachfrage.",
    source: "World Gold Council (Q1 2026)",
    date: "2026-Q1",
  },
  {
    tag: "MAKRO",
    lean: "bear",
    text: "Starke US-Payrolls heben die Zinserwartungen – kurzfristig belastend für Gold.",
    source: "Capital.com Market Update (10.06.2026)",
    date: "2026-06-10",
  },
  {
    tag: "PROGNOSE",
    lean: "bull",
    text: "Jahresend-Ziele 2026: J.P. Morgan ~6.000 $/oz – langfristig konstruktiv.",
    source: "J.P. Morgan Global Research",
    date: "2026",
  },
  {
    tag: "PROGNOSE",
    lean: "bull",
    text: "UBS-Quartalsmarken 2026: Jun 5.200 $, Sep 5.400 $, Dez 5.900 $/oz.",
    source: "UBS Research",
    date: "2026",
  },
];
