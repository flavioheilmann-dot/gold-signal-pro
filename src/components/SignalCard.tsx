import { cn } from "@/lib/utils";
import {
  stateEmoji,
  stateLabel,
  trendLabel,
  type Decision,
  type Factor,
  type SignalState,
} from "@/lib/signalEngine";

const THEME: Record<SignalState, { ring: string; text: string; glow: boolean; bar: string }> = {
  STRONG_BUY: { ring: "border-up/50 bg-up/10", text: "text-up", glow: true, bar: "bg-up" },
  BUY: { ring: "border-up/30 bg-up/5", text: "text-up", glow: false, bar: "bg-up" },
  WAIT: { ring: "border-border bg-muted/20", text: "text-muted-foreground", glow: false, bar: "bg-muted-foreground" },
  SELL: { ring: "border-down/30 bg-down/5", text: "text-down", glow: false, bar: "bg-down" },
  STRONG_SELL: { ring: "border-down/50 bg-down/10", text: "text-down", glow: true, bar: "bg-down" },
};

function FactorChip({ factor }: { factor: Factor }) {
  const tone =
    factor.lean === "bull"
      ? "border-up/30 bg-up/10 text-up"
      : factor.lean === "bear"
        ? "border-down/30 bg-down/10 text-down"
        : "border-border bg-muted/30 text-muted-foreground";
  const arrow = factor.lean === "bull" ? "+" : factor.lean === "bear" ? "-" : ".";
  const short =
    factor.key === "box"
      ? "BOX"
      : factor.key === "ema"
      ? "EMA"
      : factor.key === "macd"
        ? "MACD"
        : factor.key === "rsi"
          ? "RSI"
          : factor.key === "strength"
            ? "Staerke"
            : "News";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]", tone)}
      title={`${factor.label}: ${factor.detail}${factor.hint ? " (nur Hinweis)" : ""}`}
    >
      {short} <span className="text-[8px]">{arrow}</span>
    </span>
  );
}

export function SignalCard({ decision, factors }: { decision: Decision; factors: Factor[] }) {
  const t = THEME[decision.state];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border p-5 transition-all",
        t.ring,
        t.glow &&
          (decision.state === "STRONG_BUY"
            ? "shadow-[0_0_44px_-10px_hsl(var(--up)/0.65)]"
            : "shadow-[0_0_44px_-10px_hsl(var(--down)/0.65)]")
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "grid h-14 w-14 shrink-0 place-items-center rounded-xl border text-2xl",
              t.ring,
              t.glow && "animate-pulse-glow"
            )}
          >
            {stateEmoji(decision.state)}
          </div>
          <div>
            <div className={cn("font-mono text-2xl font-bold leading-tight tracking-tight sm:text-3xl", t.text)}>
              {stateLabel(decision.state)}
            </div>
            <div className="mt-1 max-w-md text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{decision.confidence}% Konfidenz</span>{" "}
              — {decision.bias === "flat" ? "kein Day-Setup" : "wegen"}: {decision.reason}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Day-Trend · TF
          </div>
          <div className="mono text-sm font-semibold">{trendLabel(decision.trend)} · 15M</div>
        </div>
      </div>

      {/* confidence bar */}
      <div className="relative mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
        <div className={cn("h-full rounded-full transition-all duration-500", t.bar)} style={{ width: `${decision.confidence}%` }} />
      </div>

      {/* transparent factor chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {factors.map((f) => (
          <FactorChip key={f.key} factor={f} />
        ))}
      </div>
    </div>
  );
}
