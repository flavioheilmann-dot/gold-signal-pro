import type { TradeSignal } from "../types";
import { ensureNotificationPermission, notify, pushNtfy } from "@/lib/alerts";
import { TRADING_DISCLAIMER } from "../types";

export interface NotifyConfig {
  browser: boolean; // browser notifications (needs permission)
  ntfy: boolean; // ntfy push to phone
  ntfyTopic: string;
}

export async function requestNotifyPermission(): Promise<void> {
  await ensureNotificationPermission();
}

/** Send a setup notification through the enabled channels (with disclaimer). */
export function notifySignal(sig: TradeSignal, cfg: NotifyConfig): void {
  const title = `${sig.direction === "BUY" ? "🟢 LONG" : "🔴 SHORT"} ${sig.symbol} · ${sig.confidence}/100`;
  const body = [
    `Entry: ${sig.entry}  (Zone ${sig.entryZone.from.toFixed(2)}–${sig.entryZone.to.toFixed(2)})`,
    `SL: ${sig.stopLoss}  TP1: ${sig.takeProfit1}  TP2: ${sig.takeProfit2}`,
    `RR 1:${sig.riskReward}  ·  ${sig.session}`,
    sig.reasons.join(" · "),
    ...(sig.warnings.length ? [`⚠ ${sig.warnings.join(" · ")}`] : []),
    TRADING_DISCLAIMER,
  ].join("\n");

  if (cfg.browser) notify(title, body);
  if (cfg.ntfy && cfg.ntfyTopic) {
    const tag = sig.direction === "BUY" ? "chart_with_upwards_trend" : "chart_with_downwards_trend";
    pushNtfy(cfg.ntfyTopic, title, body, [tag]);
  }
}
