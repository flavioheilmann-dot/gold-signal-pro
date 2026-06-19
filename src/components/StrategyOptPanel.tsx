import { Award, AlertCircle, CheckCircle, TrendingUp, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyGrade, OptSuggestion } from "@/lib/signalEngine";

const GRADE_THEME: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: "bg-up/15", text: "text-up", border: "border-up/30" },
  B: { bg: "bg-up/10", text: "text-up", border: "border-up/20" },
  C: { bg: "bg-gold/10", text: "text-gold", border: "border-gold/20" },
  D: { bg: "bg-down/10", text: "text-down", border: "border-down/20" },
  F: { bg: "bg-down/15", text: "text-down", border: "border-down/30" },
};

const PRIO_ICON = {
  high: AlertCircle,
  medium: TrendingUp,
  low: CheckCircle,
};

function SuggestionItem({ s }: { s: OptSuggestion }) {
  const Icon = PRIO_ICON[s.priority];
  const tone = s.priority === "high" ? "text-down" : s.priority === "medium" ? "text-gold" : "text-up";
  return (
    <div className="flex gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
      <div className="min-w-0">
        <div className="text-xs font-semibold">{s.label}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{s.detail}</p>
      </div>
    </div>
  );
}

export function StrategyOptPanel({ grade, assetName }: { grade: StrategyGrade | null; assetName: string }) {
  if (!grade) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <Shield className="h-3.5 w-3.5" />
        Zu wenig Daten für Optimierung von {assetName}.
      </div>
    );
  }

  const t = GRADE_THEME[grade.grade];

  return (
    <div className="space-y-2">
      {/* grade + ratios row */}
      <div className="flex items-center gap-3">
        <div className={cn("grid h-12 w-12 place-items-center rounded-lg border text-xl font-black", t.bg, t.text, t.border)}>
          {grade.grade}
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-3">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Sharpe</div>
              <div className={cn("mono text-sm font-bold", grade.sharpeRatio >= 1 ? "text-up" : grade.sharpeRatio >= 0.5 ? "text-gold" : "text-down")}>
                {grade.sharpeRatio.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Calmar</div>
              <div className={cn("mono text-sm font-bold", grade.calmarRatio >= 1 ? "text-up" : grade.calmarRatio >= 0.3 ? "text-gold" : "text-down")}>
                {grade.calmarRatio.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="font-mono text-[9px] text-muted-foreground">
            Sharpe &gt;1 = gut · Calmar &gt;1 = stabil
          </div>
        </div>
      </div>

      {/* suggestions */}
      {grade.suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            <Award className="h-3 w-3" />
            Optimierungsvorschläge
          </div>
          {grade.suggestions.map((s, i) => (
            <SuggestionItem key={i} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
