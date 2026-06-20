import type { Direction } from "../types";

export interface OrderRequest {
  symbol: string;
  direction: Direction;
  size: number;
  stopLoss: number;
  takeProfit: number;
  /** Must be true for any LIVE order — enforced by LiveBrokerAdapter. */
  manualConfirmation?: boolean;
}

export interface OrderResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface BrokerAccount {
  equity: number;
  currency: string;
}

export interface BrokerAdapter {
  readonly name: string;
  readonly mode: "mock" | "paper" | "live";
  getAccount(): Promise<BrokerAccount>;
  getPrices(symbol: string): Promise<{ bid: number; ask: number } | null>;
  placeOrder(req: OrderRequest): Promise<OrderResult>;
  closeOrder(id: string): Promise<OrderResult>;
}

/** Canned adapter for tests / offline. Never touches a real account. */
export class MockBrokerAdapter implements BrokerAdapter {
  readonly name = "Mock Broker";
  readonly mode = "mock" as const;
  async getAccount(): Promise<BrokerAccount> {
    return { equity: 1000, currency: "CHF" };
  }
  async getPrices() {
    return null;
  }
  async placeOrder(): Promise<OrderResult> {
    return { ok: true, id: `mock-${Date.now()}` };
  }
  async closeOrder(): Promise<OrderResult> {
    return { ok: true };
  }
}

/**
 * LIVE adapter — intentionally a blocked stub.
 *
 * Real money is NEVER traded unless ALL of the following hold:
 *   1. VITE_LIVE_TRADING_ENABLED === "true" (explicit opt-in in .env)
 *   2. each order carries manualConfirmation === true
 *   3. a real broker integration is implemented below (currently none)
 *
 * As shipped, placeOrder always refuses. This class exists only as a safe
 * seam for a future, deliberately-enabled integration.
 */
export class LiveBrokerAdapter implements BrokerAdapter {
  readonly name = "Live Broker (DISABLED)";
  readonly mode = "live" as const;

  private get enabled(): boolean {
    return import.meta.env.VITE_LIVE_TRADING_ENABLED === "true";
  }

  async getAccount(): Promise<BrokerAccount> {
    return { equity: 0, currency: "—" };
  }
  async getPrices() {
    return null;
  }
  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (!this.enabled) {
      return { ok: false, error: "Live-Trading deaktiviert (VITE_LIVE_TRADING_ENABLED ≠ true)" };
    }
    if (!req.manualConfirmation) {
      return { ok: false, error: "Live-Order ohne manuelle Bestätigung blockiert" };
    }
    // No real integration is wired up. Refuse rather than pretend.
    return { ok: false, error: "Kein Live-Broker integriert — Order nicht ausgeführt" };
  }
  async closeOrder(): Promise<OrderResult> {
    return { ok: false, error: "Live-Trading deaktiviert" };
  }
}

/** Whether live trading is even theoretically enabled (for UI display). */
export function liveTradingEnabled(): boolean {
  return import.meta.env.VITE_LIVE_TRADING_ENABLED === "true";
}
