import { cn } from "@/lib/utils";
import type { Factor } from "@/lib/signalEngine";
import type { BuyOutlook } from "@/lib/outlook";

function LeanBadge({ factor }: { factor: Factor }) {
  const map = {
    bull: { c: "border-up/30 bg-up/10 text-up", t: "bullisch" },
    bear: { c: "border-down/30 bg-down/10 text-down", t: "bärisch" },
    neutral: { c: "border-border bg-muted/30 text-muted-foreground", t: "neutral" },
  } as const;
  const m = map[factor.lean];
  return (
    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold", m.c)}>
      {factor.hint ? "Hinweis" : m.t}
    </span>
  );
}

export function StrategyCheck({
  factors,
  strength,
  strengthMin,
  outlook,
}: {
  factors: Factor[];
  strength: number;
  strengthMin: number;
  outlook: BuyOutlook | null;
}) {
  const strengthNorm = Math.min(1, strength / (strengthMin * 1.6));
  const buyTone =
    outlook?.tone === "up" ? "text-up" : outlook?.tone === "down" ? "text-down" : "text-gold";

  return (
    <div className="space-y-3.5">
      {outlook && (
        <div className="rounded-lg border border-border bg-background/40 p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Day-Bias (Technik + News)
            </span>
            <span className={cn("mono text-xs font-bold", buyTone)}>{outlook.label}</span>
          </div>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full">
            <div className="bg-up" style={{ width: `${outlook.buyPct}%` }} />
            <div className="bg-down" style={{ width: `${outlook.sellPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px]">
            <span className="text-up">{outlook.buyPct}% kaufen</span>
            <span className="text-muted-foreground">Technik {outlook.technicalBull}% · News {outlook.newsBull}%</span>
            <span className="text-down">{outlook.sellPct}% verkaufen</span>
          </div>
        </div>
      )}

      {factors.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs text-foreground">{f.label}</div>
            <div className="mono truncate text-[10px] text-muted-foreground">{f.detail}</div>
          </div>
          <LeanBadge factor={f} />
        </div>
      ))}

      <div className="space-y-1.5 pt-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Day-Trendstaerke (EMA/ATR)</span>
          <span className="mono text-[11px] font-semibold">
            {strength.toFixed(2)} · {strength >= strengthMin ? "stark" : "schwach"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              strength >= strengthMin ? "bg-gold" : "bg-muted-foreground"
            )}
            style={{ width: `${strengthNorm * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
