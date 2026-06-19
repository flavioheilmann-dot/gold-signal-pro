import { Loader2 } from "lucide-react";
import { cn, fmtPct, fmtUsd } from "@/lib/utils";
import { KIND_LABEL } from "@/lib/assets";
import { stateLabel, type SignalState } from "@/lib/signalEngine";
import type { ScanResult } from "@/hooks/useScanner";

function sigClasses(state: SignalState) {
  if (state === "STRONG_BUY") return "border-up/50 bg-up/15 text-up";
  if (state === "BUY") return "border-up/30 bg-up/10 text-up";
  if (state === "STRONG_SELL") return "border-down/50 bg-down/15 text-down";
  if (state === "SELL") return "border-down/30 bg-down/10 text-down";
  return "border-border bg-muted/30 text-muted-foreground";
}

function shortState(state: SignalState) {
  switch (state) {
    case "STRONG_BUY":
      return "STARK KAUF";
    case "BUY":
      return "KAUF";
    case "WAIT":
      return "WARTEN";
    case "SELL":
      return "VERK";
    case "STRONG_SELL":
      return "STARK VERK";
  }
}

export function Watchlist({
  results,
  selectedEpic,
  onSelect,
  scanning,
  connected,
}: {
  results: ScanResult[];
  selectedEpic: string;
  onSelect: (epic: string) => void;
  scanning: boolean;
  connected: boolean;
}) {
  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 text-[11px] text-muted-foreground">
        Multi-Asset-Scanner braucht die Capital.com-Verbindung. Sobald
        „Verbunden" steht, erscheinen hier alle Märkte – bestes Setup oben.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          {results.length} Märkte · bestes Setup oben
        </span>
        {scanning && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {results.length === 0 && !scanning && (
        <div className="text-[11px] text-muted-foreground">Scanne Märkte …</div>
      )}

      <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
        {results.map((r) => {
          const sel = r.asset.epic === selectedEpic;
          const actionable = r.decision.bias !== "flat";
          return (
            <button
              key={r.asset.epic}
              onClick={() => onSelect(r.asset.epic)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                sel ? "border-gold/40 bg-gold/5" : "border-border/60 bg-background/40 hover:border-muted"
              )}
              title={stateLabel(r.decision.state)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold">{r.asset.name}</span>
                  <span className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">
                    {KIND_LABEL[r.asset.kind]}
                  </span>
                </div>
                <div className="mono text-[10px] text-muted-foreground">
                  {fmtUsd(r.price, r.price < 20 ? 4 : 2)}{" "}
                  <span className={r.changePct >= 0 ? "text-up" : "text-down"}>{fmtPct(r.changePct)}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold", sigClasses(r.decision.state))}>
                  {shortState(r.decision.state)}
                </span>
                {actionable && (
                  <span className="mono text-[9px] text-muted-foreground">{r.decision.confidence}%</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
