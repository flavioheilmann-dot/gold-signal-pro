import { cn, fmtUsd, fmtPct } from "@/lib/utils";

export interface TickerInfo {
  name: string;
  price: number | null;
  changePct: number;
  sourceLabel: string;
  note?: string;
}

export function PriceTicker({ ticker }: { ticker: TickerInfo }) {
  if (ticker.price == null) {
    return (
      <div className="flex items-center gap-3">
        <span className="skeleton h-7 w-28" />
        <span className="skeleton h-4 w-20" />
      </div>
    );
  }
  const up = ticker.changePct >= 0;
  const dp = ticker.price < 20 ? 4 : 2;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {ticker.name}
        </span>
        <span className="mono text-xl font-bold leading-none text-gold">
          {fmtUsd(ticker.price, dp)}
        </span>
        <span className={cn("mono text-xs font-semibold", up ? "text-up" : "text-down")}>
          {fmtPct(ticker.changePct)} <span className="text-muted-foreground">24h</span>
        </span>
      </div>
      {ticker.note && (
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground opacity-80">
          {ticker.note}
        </div>
      )}
    </div>
  );
}
