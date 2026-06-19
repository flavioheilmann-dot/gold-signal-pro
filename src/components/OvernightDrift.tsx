import { Moon, Clock, TrendingUp, TrendingDown, ShieldAlert, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OvernightSetup } from "@/lib/signalEngine";

function fmt(n: number, d = 1): string {
  return n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function OvernightDrift({ setup, assetName }: { setup: OvernightSetup | null; assetName: string }) {
  if (!setup) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <Moon className="h-3.5 w-3.5" />
        Kein Overnight-Setup für {assetName} — Bedingungen nicht erfüllt.
      </div>
    );
  }

  const long = setup.direction === "long";
  const high = setup.confidence >= 70;
  const mid = setup.confidence >= 55;
  const dirColor = long ? "up" : "down";
  const TrendIcon = long ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-2">
      {/* direction + confidence + window */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "grid h-12 w-12 place-items-center rounded-lg border text-lg",
          high
            ? long ? "border-up/30 bg-up/15 text-up" : "border-down/30 bg-down/15 text-down"
            : mid
              ? "border-gold/30 bg-gold/10 text-gold"
              : "border-border bg-muted/20 text-muted-foreground"
        )}>
          <Moon className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              long ? "bg-up/15 text-up" : "bg-down/15 text-down"
            )}>
              {long ? "LONG" : "SHORT"}
            </span>
            <span className={cn("text-sm font-bold", high ? `text-${dirColor}` : mid ? "text-gold" : "text-muted-foreground")}>
              {setup.confidence}% Konfidenz
            </span>
            {setup.windowOpen && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider animate-pulse",
                long ? "bg-up/20 text-up" : "bg-down/20 text-down"
              )}>
                Fenster offen
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {setup.nextWindow}
          </div>
        </div>
      </div>

      {/* levels */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5 text-center">
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Entry</div>
          <div className="text-xs font-bold">{fmt(setup.entry)}</div>
        </div>
        <div className="rounded-md border border-down/20 bg-down/5 px-2 py-1.5 text-center">
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Stop-Loss</div>
          <div className="text-xs font-bold text-down">{fmt(setup.stopLoss)}</div>
        </div>
        <div className={cn("rounded-md border px-2 py-1.5 text-center", long ? "border-up/20 bg-up/5" : "border-up/20 bg-up/5")}>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Take Profit</div>
          <div className="text-xs font-bold text-up">{fmt(setup.takeProfit)}</div>
        </div>
      </div>

      {/* reasons PRO */}
      <div className="space-y-1">
        <div className={cn("flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest", long ? "text-up/70" : "text-down/70")}>
          <TrendIcon className="h-3 w-3" />
          Dafür ({setup.reasons.length})
        </div>
        {setup.reasons.map((r, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px] text-foreground/80">
            <span className={cn("mt-0.5", long ? "text-up" : "text-down")}>✓</span>
            {r}
          </div>
        ))}
      </div>

      {/* reasons CONTRA */}
      {setup.contraReasons.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/70">
            <AlertTriangle className="h-3 w-3" />
            Dagegen ({setup.contraReasons.length})
          </div>
          {setup.contraReasons.map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <span className="mt-0.5 text-gold">⚠</span>
              {r}
            </div>
          ))}
        </div>
      )}

      {/* disclaimer */}
      <div className="flex items-start gap-1.5 rounded-md border border-gold/20 bg-gold/5 px-2.5 py-1.5 text-[10px] text-gold">
        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
        Overnight-Drift ist ein statistisches Muster, keine Garantie. Immer SL setzen!
      </div>
    </div>
  );
}
