const FED = new Date("2026-06-17T18:00:00Z").getTime();

export function FedCountdown({ now }: { now: Date }) {
  const diff = FED - now.getTime();
  let text: string;
  if (diff <= 0) {
    text = "🔴 JETZT";
  } else {
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    text =
      d > 0
        ? `${d}T ${String(h).padStart(2, "0")}h`
        : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return (
    <div>
      <div className="mono text-2xl font-bold text-gold [text-shadow:0_0_18px_hsl(var(--gold)/0.4)]">
        {text}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        17. Juni · 20:00 MESZ
      </div>
      <div className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-down">
        ⚠ Kritisches Event
      </div>
    </div>
  );
}
