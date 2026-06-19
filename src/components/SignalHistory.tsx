import { Download, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, fmtDateTime, fmtUsd } from "@/lib/utils";
import { stateEmoji, stateLabel, type SignalState } from "@/lib/indicators";
import type { HistoryEntry } from "@/lib/config";

function toneFor(state: SignalState) {
  if (state === "STRONG_BUY" || state === "BUY") return "text-up";
  if (state === "STRONG_SELL" || state === "SELL") return "text-down";
  return "text-gold";
}

export function SignalHistory({
  entries,
  onExport,
}: {
  entries: HistoryEntry[];
  onExport: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <History className="h-3.5 w-3.5" /> Signal-Historie
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onExport}
          disabled={!entries.length}
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          Noch keine Signal-Wechsel aufgezeichnet.
        </div>
      ) : (
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {entries.map((e, i) => (
            <div
              key={`${e.time}-${i}`}
              className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2 animate-slide-up"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{stateEmoji(e.state)}</span>
                <div>
                  <div className={cn("text-xs font-semibold", toneFor(e.state))}>
                    {stateLabel(e.state)}
                  </div>
                  <div className="mono text-[10px] text-muted-foreground">
                    {fmtDateTime(e.time)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="mono text-xs">{fmtUsd(e.price, 0)} $</div>
                <div className="mono text-[10px] text-muted-foreground">
                  {e.confidence}% conf.
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
