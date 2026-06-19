// Frontend client for the local Capital.com proxy (/api/capital/*).
// Everything degrades gracefully when the backend isn't running.

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
  const res = await fetch(`/api/capital${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getStatus(): Promise<BrokerStatus> {
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
  const res = await fetch("/api/capital/order", {
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
    const res = await fetch(`/api/capital/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!res.ok) return { activities: [], transactions: [] };
    return await res.json();
  } catch {
    return { activities: [], transactions: [] };
  }
}
