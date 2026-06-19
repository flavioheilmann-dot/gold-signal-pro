import { Zap } from "lucide-react";
import { cn, fmtUsd } from "@/lib/utils";
import type { Decision, TradeLevels } from "@/lib/signalEngine";

function Lvl({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "gold" }) {
  return (
    <div className="text-center">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mono text-sm font-bold",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "gold" && "text-gold"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Eye-catching alert shown only on a high-conviction setup (long OR short).
 */
export function HotSetupAlert({
  decision,
  levels,
  marketOpen,
}: {
  decision: Decision;
  levels: TradeLevels;
  marketOpen: boolean;
}) {
  const long = decision.bias === "long";
  const verb = marketOpen ? "JETZT" : "BEI ÖFFNUNG";
  const action = long ? `${verb} KAUFEN (LONG)` : `${verb} SHORTEN (SHORT)`;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border-2 px-4 py-3",
        long ? "border-up/70 bg-up/10 animate-glow-up" : "border-down/70 bg-down/10 animate-glow-down"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("grid h-9 w-9 place-items-center rounded-lg", long ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
            <Zap className="h-5 w-5" />
          </span>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              ⚡ Sehr gutes Setup · {decision.confidence}% Konviktion
            </div>
            <div className={cn("font-mono text-lg font-bold leading-tight", long ? "text-up" : "text-down")}>
              {action}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Lvl label="Entry" value={fmtUsd(levels.entry, 0)} tone="gold" />
          <Lvl label="SL" value={fmtUsd(levels.stopLoss, 0)} tone="down" />
          <Lvl label="TP1" value={fmtUsd(levels.takeProfit1, 0)} tone="up" />
          <Lvl label="TP2" value={fmtUsd(levels.takeProfit2, 0)} tone="up" />
          <Lvl label="R:R" value={`1:${levels.rr1.toFixed(1)}`} tone="up" />
        </div>
      </div>
    </div>
  );
}
