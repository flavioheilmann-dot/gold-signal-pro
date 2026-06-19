// Frontend client for the Capital.com proxy (/api/capital/*).
// Everything degrades gracefully when the backend isn't running.
//
// VITE_API_BASE_URL — base of the backend proxy. Empty = same-origin
//   (dev proxy / co-hosted). On GitHub Pages this stays empty, so the
//   broker calls 404 and the app drops to PUBLIC mode automatically.
// VITE_PUBLIC_MODE  — "true" forces demo/public mode (no broker calls,
//   no order UI) even if a backend would be reachable.

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const CAPITAL = `${API_BASE}/api/capital`;
export const PUBLIC_MODE = import.meta.env.VITE_PUBLIC_MODE === "true";

export interface BrokerStatus {
  configured: boolean;
  connected: boolean;
  env: string;
  tradingEnabled: boolean;
  goldEpic: string;
  error?: string;
  backendOffline?: boolean;
}

export interface BrokerAccount {
  currency: string;
  balance: number | null;
  available: number | null;
  pnl: number | null;
  deposit: number | null;
  accountName: string;
}

export interface BrokerPosition {
  epic: string;
  instrument: string;
  direction: string;
  size: number | null;
  level: number | null;
  pnl: number | null;
}

export interface OrderRequest {
  epic: string;
  direction: "BUY" | "SELL";
  size: number;
  stopLevel?: number;
  profitLevel?: number;
  confirm: true;
}

async function jget<T>(path: string): Promise<T> {
  const res = await fetch(`${CAPITAL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getStatus(): Promise<BrokerStatus> {
  if (PUBLIC_MODE) {
    return { configured: false, connected: false, env: "public", tradingEnabled: false, goldEpic: "GOLD" };
  }
  try {
    return await jget<BrokerStatus>("/status");
  } catch {
    return {
      configured: false,
      connected: false,
      env: "-",
      tradingEnabled: false,
      goldEpic: "GOLD",
      backendOffline: true,
    };
  }
}

export const getAccount = () => jget<BrokerAccount>("/account");
export const getPositions = () => jget<{ positions: BrokerPosition[] }>("/positions");

import type { Candle } from "./api";
export async function getCandles(
  epic: string,
  resolution = "MINUTE_15",
  max = 200
): Promise<Candle[]> {
  const d = await jget<{ candles: Candle[] }>(
    `/candles/${encodeURIComponent(epic)}?resolution=${resolution}&max=${max}`
  );
  return d.candles || [];
}

export async function placeOrder(
  order: OrderRequest
): Promise<{ ok: boolean; dealReference: string | null }> {
  const res = await fetch(`${CAPITAL}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Trade History ──

export interface TradeHistoryItem {
  date: string;
  type: string;
  reference: string;
  instrumentName: string;
  size: number | null;
  openLevel: number | null;
  closeLevel: number | null;
  profitAndLoss: string;
  currency: string;
}

export interface ActivityItem {
  date: string;
  type: string;
  status: string;
  epic: string;
  dealId: string;
  description: string;
  details: Record<string, unknown>;
}

export interface TradeHistory {
  activities: ActivityItem[];
  transactions: TradeHistoryItem[];
}

export async function getTradeHistory(days = 30): Promise<TradeHistory> {
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const to = new Date().toISOString();
  try {
    const res = await fetch(`${CAPITAL}/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!res.ok) return { activities: [], transactions: [] };
    return await res.json();
  } catch {
    return { activities: [], transactions: [] };
  }
}
