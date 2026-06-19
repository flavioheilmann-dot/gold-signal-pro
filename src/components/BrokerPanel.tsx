import { Link2, Link2Off, ShieldAlert } from "lucide-react";
import { cn, fmtUsd } from "@/lib/utils";
import type { BrokerStatus, BrokerAccount, BrokerPosition } from "@/lib/capital";

function Row({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("mono text-xs font-semibold", tone === "up" && "text-up", tone === "down" && "text-down")}>
        {value}
      </span>
    </div>
  );
}

export function BrokerPanel({
  status,
  account,
  positions,
}: {
  status: BrokerStatus | null;
  account: BrokerAccount | null;
  positions: BrokerPosition[];
}) {
  if (!status || status.backendOffline || !status.configured) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-muted/10 p-3">
        <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Capital.com nicht verbunden.</span> Backend
          starten und <span className="mono">server/.env</span> ausfüllen (API-Key,
          Login, API-Passwort). Siehe README.
        </div>
      </div>
    );
  }

  const connTone = status.connected ? "text-up" : "text-down";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={cn("flex items-center gap-1.5 font-mono text-[11px] font-semibold", connTone)}>
          {status.connected ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
          {status.connected ? "Verbunden" : "Verbindungsfehler"}
        </span>
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase",
            status.env === "live" ? "border-down/40 bg-down/10 text-down" : "border-info/40 bg-info/10 text-info"
          )}
        >
          {status.env}
        </span>
      </div>

      {status.error && (
        <div className="rounded border border-down/30 bg-down/10 px-2 py-1 font-mono text-[10px] text-down">
          {status.error.slice(0, 120)}
        </div>
      )}

      {account && (
        <div className="rounded-lg border border-border bg-background/40 p-2.5">
          <Row label="Kontostand" value={account.balance != null ? `${fmtUsd(account.balance, 2)} ${account.currency}` : "–"} />
          <Row label="Verfügbar" value={account.available != null ? `${fmtUsd(account.available, 2)} ${account.currency}` : "–"} />
          <Row
            label="Offener P&L"
            value={account.pnl != null ? `${fmtUsd(account.pnl, 2)} ${account.currency}` : "–"}
            tone={account.pnl != null ? (account.pnl >= 0 ? "up" : "down") : undefined}
          />
        </div>
      )}

      <div>
        <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          Offene Positionen ({positions.length})
        </div>
        {positions.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">Keine offenen Positionen.</div>
        ) : (
          <div className="space-y-1">
            {positions.slice(0, 4).map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded border border-border/60 bg-background/40 px-2 py-1 text-[11px]">
                <span className="mono">
                  <span className={p.direction === "BUY" ? "text-up" : "text-down"}>{p.direction}</span> {p.instrument || p.epic} ×{p.size}
                </span>
                <span className={cn("mono", (p.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>
                  {p.pnl != null ? fmtUsd(p.pnl, 2) : "–"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!status.tradingEnabled && (
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-gold" />
          Nur-Lesen-Modus. Orders sind deaktiviert (CAPITAL_TRADING_ENABLED=false).
        </div>
      )}
    </div>
  );
}
