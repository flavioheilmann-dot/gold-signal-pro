// ─────────────────────────────────────────────────────────────
// Position sizing in the ACCOUNT currency (CHF).
//
// On Capital.com a CFD's P/L = size × priceMove × (1 unit of the QUOTE
// currency per point) — i.e. one "unit" of size earns 1 quote-currency unit
// per 1.0 price-point move. The account here is in CHF, so the only missing
// piece vs. a naive "1 Fr/point" model is the FX conversion quote→CHF.
//
// All five TJR instruments (GOLD, BTCUSD, US100, US500, GBPUSD) settle in USD,
// so the single rate we need is USD→CHF (= the USDCHF mid, "CHF per 1 USD").
// We keep this honest: when the rate is unknown (backend offline) we fall back
// to 1.0 and the UI says so, instead of pretending precision we don't have.
// ─────────────────────────────────────────────────────────────

/** Quote/settlement currency per instrument (default USD — all TJR assets). */
export function quoteCurrencyOf(epic: string): "USD" | "CHF" | "EUR" | "GBP" {
  const e = epic.toUpperCase();
  if (e.endsWith("CHF")) return "CHF";
  // GOLD, BTCUSD, US100, US500, GBPUSD, … all settle in USD on Capital.com
  return "USD";
}

/**
 * Account-currency (CHF) value of a 1.0 price-point move per 1 unit of size.
 * `usdChf` = CHF per 1 USD (USDCHF mid). null → unknown (caller falls back).
 */
export function valuePerPointChf(epic: string, usdChf: number | null): number | null {
  const ccy = quoteCurrencyOf(epic);
  if (ccy === "CHF") return 1;
  if (ccy === "USD") return usdChf ?? null;
  return null; // other quote currencies not modelled → caller falls back
}

export interface Sizing {
  riskAmount: number; // CHF risked at the stop (1R)
  size: number; // units to enter on Capital.com
  notional: number; // position value (CHF)
  rewardTP1: number; // CHF gain if TP1 hit
  rewardFinal: number; // CHF gain at the final target
  valuePerPoint: number; // CHF per point per unit actually used
  exact: boolean; // true = real FX applied, false = 1:1 fallback
}

/**
 * Size so that hitting the stop loses exactly `riskPct`% of `capital` (CHF).
 * When the FX rate is missing we size with valuePerPoint = 1 and flag exact:false.
 */
export function sizeTrade(opts: {
  epic: string;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  finalTarget: number;
  capital: number;
  riskPct: number;
  usdChf: number | null;
}): Sizing {
  const { epic, entry, stopLoss, takeProfit1, finalTarget, capital, riskPct, usdChf } = opts;
  const vppRaw = valuePerPointChf(epic, usdChf);
  const exact = vppRaw != null;
  const valuePerPoint = vppRaw ?? 1;

  const riskAmount = (capital * riskPct) / 100;
  const slDist = Math.abs(entry - stopLoss);
  const size = slDist > 0 && valuePerPoint > 0 ? riskAmount / (slDist * valuePerPoint) : 0;
  const notional = size * entry * valuePerPoint;
  const rewardTP1 = size * Math.abs(takeProfit1 - entry) * valuePerPoint;
  const rewardFinal = size * Math.abs(finalTarget - entry) * valuePerPoint;

  return {
    riskAmount: +riskAmount.toFixed(2),
    size: +size.toFixed(size >= 1 ? 2 : 4),
    notional: +notional.toFixed(2),
    rewardTP1: +rewardTP1.toFixed(2),
    rewardFinal: +rewardFinal.toFixed(2),
    valuePerPoint,
    exact,
  };
}
