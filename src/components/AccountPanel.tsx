import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, fmtFr, fmtUsd } from "@/lib/utils";
import type { TradeLevels } from "@/lib/indicators";

interface Props {
  capital: number;
  riskPct: number;
  levels: TradeLevels;
  onCapital: (v: number) => void;
  onRisk: (v: number) => void;
}

export function AccountPanel({
  capital,
  riskPct,
  levels,
  onCapital,
  onRisk,
}: Props) {
  const riskAmount = (capital * riskPct) / 100;
  const slDistance = Math.abs(levels.entry - levels.stopLoss);
  const units = slDistance > 0 ? riskAmount / slDistance : 0;
  const positionValue = units * levels.entry;

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
        <Stat label="Risiko-Betrag" value={fmtFr(riskAmount)} tone="down" />
        <Stat label="SL-Abstand" value={`${fmtUsd(slDistance, 0)} $`} />
        <Stat
          label="Empf. Units"
          value={units.toFixed(4)}
          tone="gold"
        />
        <Stat label="Positionswert" value={`${fmtUsd(positionValue, 0)} $`} />
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
