import { useEffect, useState } from "react";
import { Trophy, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, fmtDateTime } from "@/lib/utils";

// Primary: the always-on worker serves a LIVE 24/7 track-record at /track.
// Fallback: the daily snapshot the heartbeat commits (served via jsDelivr).
const WORKER_URL = (import.meta.env.VITE_WORKER_URL || "https://gold-signal-pro.onrender.com").replace(/\/$/, "");
const SNAPSHOT_URL = "https://cdn.jsdelivr.net/gh/flavioheilmann-dot/gold-signal-pro@master/data/track-record.json";

async function fetchTrackRecord(): Promise<Snapshot> {
  const sources = [`${WORKER_URL}/track`, `${SNAPSHOT_URL}?t=${Math.floor(Date.now() / 3.6e6)}`];
  for (const url of sources) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000); // worker may cold-start
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) return (await r.json()) as Snapshot;
    } catch {
      /* try next source */
    }
  }
  throw new Error("no track-record source reachable");
}

interface StratSummary {
  total: number; open: number; closed: number; wins: number; losses: number;
  winRate: number; sumR: number;
}
interface RecentSignal {
  id: string; strategy: string; epic: string; name?: string; dir: string;
  status: string; rMultiple: number | null; confidence: number; openedAt: number; confluence?: boolean;
}
interface Snapshot {
  updatedAt: number; box: StratSummary; ict: StratSummary; recent: RecentSignal[];
}

function StratBlock({ name, s }: { name: string; s: StratSummary }) {
  const rTone = s.sumR > 0 ? "text-up" : s.sumR < 0 ? "text-down" : "text-muted-foreground";
  return (
    <div className="flex-1 rounded-md border border-border/50 bg-background/40 px-3 py-2">
      <div className="font-mono text-[10px] font-bold uppercase tracking-wider">{name}</div>
      {s.closed === 0 ? (
        <div className="mt-1 text-[11px] text-muted-foreground">{s.open} offen · noch keine abgeschlossen</div>
      ) : (
        <div className="mt-1 grid grid-cols-3 gap-1 text-[11px]">
          <div><span className="text-muted-foreground">Win </span><span className="mono font-semibold">{(s.winRate * 100).toFixed(0)}%</span></div>
          <div><span className="text-muted-foreground">Σ </span><span className={cn("mono font-semibold", rTone)}>{s.sumR >= 0 ? "+" : ""}{s.sumR}R</span></div>
          <div><span className="text-muted-foreground">n </span><span className="mono font-semibold">{s.wins}/{s.closed}</span></div>
        </div>
      )}
    </div>
  );
}

const OUTCOME: Record<string, { label: string; tone: string }> = {
  win: { label: "Win", tone: "text-up" },
  loss: { label: "Loss", tone: "text-down" },
  breakeven: { label: "BE", tone: "text-muted-foreground" },
  open: { label: "offen", tone: "text-info" },
};

export function TrackRecord() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  const load = () => {
    setState("loading");
    fetchTrackRecord()
      .then((d) => {
        setSnap(d);
        setState(d && (d.box.total + d.ict.total > 0) ? "ready" : "empty");
      })
      .catch(() => setState("error"));
  };
  useEffect(load, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5 text-gold" /> Live-Track-Record
        </CardTitle>
        <button onClick={load} title="Aktualisieren" className="text-muted-foreground hover:text-primary">
          <RefreshCw className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
        </button>
      </CardHeader>
      <CardContent className="space-y-2">
        {state === "error" && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" /> Noch keine Daten veröffentlicht (Heartbeat läuft 1×/Tag).
          </div>
        )}
        {(state === "ready" || state === "empty") && snap && (
          <>
            <div className="flex gap-2">
              <StratBlock name="Box/EMA" s={snap.box} />
              <StratBlock name="ICT" s={snap.ict} />
            </div>

            {snap.recent.length > 0 && (
              <div className="space-y-1">
                {snap.recent.slice(0, 8).map((r) => {
                  const o = OUTCOME[r.status] ?? OUTCOME.open;
                  const long = r.dir === "LONG" || r.dir === "BUY";
                  return (
                    <div key={r.id} className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("font-mono text-[9px] font-bold uppercase", r.strategy === "ICT" ? "text-info" : "text-gold")}>{r.strategy}</span>
                        <span className={cn("font-semibold", long ? "text-up" : "text-down")}>{r.dir} {r.name ?? r.epic}</span>
                        {r.confluence && <span title="Konfluenz Box×ICT">⭐</span>}
                      </span>
                      <span className={cn("mono", o.tone)}>
                        {o.label}{r.rMultiple != null ? ` ${r.rMultiple >= 0 ? "+" : ""}${r.rMultiple}R` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between font-mono text-[9px] text-muted-foreground">
              <span>Cloud-Scanner · Stand {fmtDateTime(snap.updatedAt)}</span>
              <span>Nur Analyse, keine Anlageberatung</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
