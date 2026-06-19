import { X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/config";
import type { StrategyParams } from "@/lib/indicators";

interface Props {
  open: boolean;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
}

const FIELDS: { key: keyof StrategyParams; label: string; step?: string }[] = [
  { key: "emaFast", label: "EMA schnell (9)" },
  { key: "emaSlow", label: "EMA Trigger (21)" },
  { key: "emaTrend", label: "EMA Trend (50)" },
  { key: "rsiPeriod", label: "RSI Periode" },
  { key: "macdFast", label: "MACD schnell" },
  { key: "macdSlow", label: "MACD langsam" },
  { key: "macdSignal", label: "MACD Signal" },
  { key: "atrPeriod", label: "ATR Periode" },
  { key: "strengthMin", label: "Trendstaerke min", step: "0.1" },
  { key: "confirmBars", label: "Bestaetigung (15M Bars)" },
  { key: "atrSL", label: "Day-Stop (xATR)", step: "0.1" },
  { key: "atrTP1", label: "TP1 (xATR)", step: "0.1" },
  { key: "atrTP2", label: "TP2 (xATR)", step: "0.1" },
  { key: "boxLookback", label: "Box-Laenge (Bars)" },
  { key: "breakoutBufferAtr", label: "Breakout-Puffer", step: "0.01" },
  { key: "rejectionWickMin", label: "Rejection-Wick", step: "0.01" },
];

export function SettingsPanel({ open, settings, onChange, onClose }: Props) {
  if (!open) return null;

  const setParam = (key: keyof StrategyParams, value: number) =>
    onChange({ ...settings, params: { ...settings.params, [key]: value } });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest">
            Strategie &amp; Einstellungen
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Strategie-Parameter
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() =>
                  onChange({ ...settings, params: DEFAULT_SETTINGS.params })
                }
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <Input
                    id={f.key}
                    type="number"
                    step={f.step ?? "1"}
                    value={settings.params[f.key]}
                    onChange={(e) =>
                      setParam(f.key, parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Konto &amp; Refresh
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="set-cap">Kapital (Fr)</Label>
                <Input
                  id="set-cap"
                  type="number"
                  value={settings.capital}
                  onChange={(e) =>
                    onChange({ ...settings, capital: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="set-risk">Risiko (%)</Label>
                <Input
                  id="set-risk"
                  type="number"
                  value={settings.riskPct}
                  onChange={(e) =>
                    onChange({ ...settings, riskPct: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="set-refresh">Refresh (Sek)</Label>
                <Input
                  id="set-refresh"
                  type="number"
                  min={10}
                  value={settings.refreshSec}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      refreshSec: Math.max(10, parseInt(e.target.value) || 30),
                    })
                  }
                />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Alarm &amp; Ton</div>
                <div className="text-[11px] text-muted-foreground">
                  Beep + Notification bei Signalwechsel / Top-Setup
                </div>
              </div>
              <Switch
                checked={settings.alarmOn}
                onCheckedChange={(v) => onChange({ ...settings, alarmOn: v })}
              />
            </div>

            <Separator />

            <div>
              <div className="text-sm font-medium">Handy-Push (ntfy.sh)</div>
              <div className="text-[11px] text-muted-foreground mb-2">
                Installiere die <span className="font-semibold">ntfy</span>-App, abonniere dein Topic und erhalte Push-Benachrichtigungen bei starken Signalen.
              </div>
              <Input
                placeholder="z.B. gold-signal-flavio"
                value={settings.ntfyTopic ?? ""}
                onChange={(e) => onChange({ ...settings, ntfyTopic: e.target.value.trim() })}
              />
              {settings.ntfyTopic && (
                <div className="mt-1 text-[10px] text-up">
                  ✓ Push aktiv — Topic: {settings.ntfyTopic}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="border-t border-border p-4">
          <Button className="w-full" onClick={onClose}>
            Fertig
          </Button>
        </div>
      </aside>
    </div>
  );
}
