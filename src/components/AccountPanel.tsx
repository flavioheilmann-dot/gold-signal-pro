import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, fmtFr, fmtUsd } from "@/lib/utils";
import type { TradeLevels } from "@/lib/indicators";
import { sizeTrade } from "@/lib/sizing";

interface Props {
  capital: number;
  riskPct: number;
  levels: TradeLevels;
  epic?: string;
  usdChf?: number | null;
  onCapital: (v: number) => void;
  onRisk: (v: number) => void;
}

export function AccountPanel({
  capital,
  riskPct,
  levels,
  epic = "GOLD",
  usdChf = null,
  onCapital,
  onRisk,
}: Props) {
  const slDistance = Math.abs(levels.entry - levels.stopLoss);
  const sz = sizeTrade({
    epic,
    entry: levels.entry,
    stopLoss: levels.stopLoss,
    takeProfit1: levels.takeProfit1,
    finalTarget: levels.takeProfit2,
    capital,
    riskPct,
    usdChf,
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="cap">Kapital (Fr)</Label>
          <Input
            id="cap"
            type="number"
            value={capital}
            onChange={(e) => onCapital(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="risk">Risiko (%)</Label>
          <Input
            id="risk"
            type="number"
            value={riskPct}
            onChange={(e) => onRisk(parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-border bg-background/40 p-2.5">
        <Stat label="Risiko-Betrag" value={fmtFr(sz.riskAmount)} tone="down" />
        <Stat label="SL-Abstand" value={`${fmtUsd(slDistance, 0)} Pkt`} />
        <Stat label="Empf. Größe" value={sz.size >= 1 ? sz.size.toFixed(2) : sz.size.toFixed(4)} tone="gold" />
        <Stat label="Positionswert" value={fmtFr(sz.notional)} />
      </div>
      <div className="text-[9px] leading-snug text-muted-foreground">
        {sz.exact
          ? `Exakt in CHF (USD→CHF ${usdChf?.toFixed(4)}).`
          : "FX offline → 1:1-Schätzung."}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "gold";
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "mono text-xs font-semibold",
          tone === "down" && "text-down",
          tone === "gold" && "text-gold"
        )}
      >
        {value}
      </span>
    </div>
  );
}
