import { cn, fmtDateTime } from "@/lib/utils";

export type DataMode =
  | "LIVE_CAPITAL" // backend connected, real broker candles (15M)
  | "LIVE_XAUUSD" // public: real XAU/USD spot price (candles = PAXG proxy)
  | "LIVE_PAXG_PROXY" // public: only PAXG proxy live, XAU spot unavailable
  | "SIMULATION" // offline synthetic candles — demo only
  | "OFFLINE"; // nothing loaded yet

export interface SourceInfo {
  mode: DataMode;
  sourceLabel: string;
  timeframe: string;
  fetchedAt: number | null;
  refreshSec: number;
  proxyNote?: string;
}

const BADGE: Record<DataMode, { label: string; dot: string; text: string; title: string }> = {
  LIVE_CAPITAL: {
    label: "LIVE",
    dot: "bg-up",
    text: "text-up",
    title: "Echte Broker-Daten von Capital.com",
  },
  LIVE_XAUUSD: {
    label: "LIVE · XAU/USD",
    dot: "bg-up",
    text: "text-up",
    title: "Echter XAU/USD-Spotpreis. Chart/Signale auf PAXG-Proxy (4H).",
  },
  LIVE_PAXG_PROXY: {
    label: "PROXY · PAXG",
    dot: "bg-info",
    text: "text-info",
    title: "Kein direkter XAU-Spot — PAX-Gold als 24/7-Proxy. Kann leicht abweichen.",
  },
  SIMULATION: {
    label: "SIMULATION",
    dot: "bg-gold",
    text: "text-gold",
    title: "Offline-Demodaten. Keine echten Kurse — nur zur Ansicht.",
  },
  OFFLINE: {
    label: "OFFLINE",
    dot: "bg-down",
    text: "text-down",
    title: "Keine Daten geladen.",
  },
};

function ageLabel(fetchedAt: number | null): string {
  if (!fetchedAt) return "–";
  const s = Math.max(0, Math.round((Date.now() - fetchedAt) / 1000));
  if (s < 60) return `vor ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m}min`;
  return `vor ${Math.floor(m / 60)}h`;
}

export function DataSourceStatus({ info }: { info: SourceInfo }) {
  const b = BADGE[info.mode];
  const proxy = info.mode === "LIVE_PAXG_PROXY" || info.mode === "SIMULATION";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[9px] text-muted-foreground">
      <span className={cn("flex items-center gap-1.5 font-semibold", b.text)} title={b.title}>
        <span className={cn("h-1.5 w-1.5 rounded-full", b.dot)} />
        {b.label}
      </span>
      <span>Quelle: {info.sourceLabel}</span>
      <span>· TF: {info.timeframe}</span>
      <span>· Stand: {info.fetchedAt ? fmtDateTime(info.fetchedAt) : "–"}</span>
      <span className={cn(info.fetchedAt && Date.now() - info.fetchedAt > 180_000 && "text-gold")}>
        · {ageLabel(info.fetchedAt)}
      </span>
      <span>· Refresh: {info.refreshSec}s</span>
      {proxy && info.proxyNote && (
        <span className={cn("font-semibold", info.mode === "SIMULATION" ? "text-gold" : "text-info")}>
          · ⚠ {info.proxyNote}
        </span>
      )}
    </div>
  );
}
