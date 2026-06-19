import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { placeOrder } from "@/lib/capital";

interface Defaults {
  epic: string;
  direction: "BUY" | "SELL";
  size: number;
  stopLevel?: number;
  profitLevel?: number;
}

export function OrderTicket({
  open,
  env,
  defaults,
  onClose,
  onPlaced,
}: {
  open: boolean;
  env: string;
  defaults: Defaults;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const [direction, setDirection] = useState<"BUY" | "SELL">(defaults.direction);
  const [size, setSize] = useState(defaults.size);
  const [sl, setSl] = useState(defaults.stopLevel ?? 0);
  const [tp, setTp] = useState(defaults.profitLevel ?? 0);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!open) return null;

  const long = direction === "BUY";
  const word = long ? "KAUFEN" : "VERKAUFEN";
  const live = env === "live";
  const canSend = typed.trim().toUpperCase() === word && ack && size > 0 && !busy;

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await placeOrder({
        epic: defaults.epic,
        direction,
        size: Number(size),
        stopLevel: sl > 0 ? Number(sl) : undefined,
        profitLevel: tp > 0 ? Number(tp) : undefined,
        confirm: true,
      });
      setResult({ ok: true, msg: `Order gesendet. Referenz: ${r.dealReference ?? "—"}` });
      onPlaced();
    } catch (e) {
      setResult({ ok: false, msg: `Fehlgeschlagen: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-widest">Order bestätigen</h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy}>
            <X />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setDirection("BUY"); setTyped(""); }}
              className={cn(
                "rounded-lg border px-3 py-2 font-mono text-sm font-bold transition-colors",
                direction === "BUY" ? "border-up/60 bg-up/15 text-up" : "border-border bg-muted/20 text-muted-foreground"
              )}
            >
              KAUFEN (Long)
            </button>
            <button
              onClick={() => { setDirection("SELL"); setTyped(""); }}
              className={cn(
                "rounded-lg border px-3 py-2 font-mono text-sm font-bold transition-colors",
                direction === "SELL" ? "border-down/60 bg-down/15 text-down" : "border-border bg-muted/20 text-muted-foreground"
              )}
            >
              VERKAUFEN (Short)
            </button>
          </div>

          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2",
              long ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down"
            )}
          >
            <span className="font-mono text-sm font-bold">{word}</span>
            <span className="text-sm text-foreground">{defaults.epic}</span>
            {live && (
              <span className="ml-auto rounded border border-down/50 bg-down/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-down">
                LIVE · ECHTES GELD
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="o-size">Größe</Label>
              <Input id="o-size" type="number" value={size} onChange={(e) => setSize(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o-sl">Stop-Loss</Label>
              <Input id="o-sl" type="number" value={sl} onChange={(e) => setSl(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="o-tp">Take-Profit</Label>
              <Input id="o-tp" type="number" value={tp} onChange={(e) => setTp(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 p-2.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
            Keine Anlageberatung. CFDs sind hochriskant – du kannst mehr als den Einsatz verlieren. Prüfe Größe, SL und TP genau.
          </div>

          <div className="space-y-1">
            <Label htmlFor="o-confirm">
              Zum Bestätigen „{word}" eintippen
            </Label>
            <Input id="o-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={word} />
          </div>

          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-3.5 w-3.5 accent-[hsl(var(--gold))]" />
            Ich löse diese Order bewusst selbst aus und trage das Risiko.
          </label>

          {result && (
            <div className={cn("rounded-lg border px-3 py-2 font-mono text-xs", result.ok ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down")}>
              {result.msg}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            className={cn("flex-1", long ? "" : "")}
            variant={long ? "up" : "down"}
            onClick={send}
            disabled={!canSend}
          >
            {busy ? "Senden…" : `Order ${word.toLowerCase()} senden`}
          </Button>
        </div>
      </div>
    </div>
  );
}
