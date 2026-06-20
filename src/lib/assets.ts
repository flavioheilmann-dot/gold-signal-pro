// Watchlist of liquid, tight-spread Capital.com instruments (epics
// live-verified against the account). `liquidity` (1–10) is a base
// "tradeability" rank used as the secondary sort after signal strength.

export type AssetKind = "metal" | "index" | "forex" | "crypto" | "stock" | "commodity";

export interface Asset {
  epic: string;
  name: string;
  kind: AssetKind;
  liquidity: number;
}

// Namen exakt wie auf Capital.com (live-API `instrument.name`, 2026-06-19).
export const WATCHLIST: Asset[] = [
  // Indizes
  { epic: "EURUSD", name: "EUR/USD", kind: "forex", liquidity: 10 },
  { epic: "US500", name: "US 500", kind: "index", liquidity: 10 },
  { epic: "GOLD", name: "Gold", kind: "metal", liquidity: 10 },
  { epic: "US100", name: "US Tech 100", kind: "index", liquidity: 9 },
  { epic: "DE40", name: "Germany 40", kind: "index", liquidity: 9 },
  { epic: "FR40", name: "France 40", kind: "index", liquidity: 7 },
  { epic: "UK100", name: "UK 100", kind: "index", liquidity: 8 },
  { epic: "J225", name: "Japan 225", kind: "index", liquidity: 7 },
  { epic: "HK50", name: "Hong Kong 50", kind: "index", liquidity: 6 },
  { epic: "EU50", name: "EU Stocks 50", kind: "index", liquidity: 7 },
  // Forex
  { epic: "GBPUSD", name: "GBP/USD", kind: "forex", liquidity: 9 },
  { epic: "USDJPY", name: "USD/JPY", kind: "forex", liquidity: 9 },
  { epic: "USDCHF", name: "USD/CHF", kind: "forex", liquidity: 8 },
  { epic: "AUDUSD", name: "AUD/USD", kind: "forex", liquidity: 7 },
  { epic: "USDCAD", name: "USD/CAD", kind: "forex", liquidity: 7 },
  { epic: "EURGBP", name: "EUR/GBP", kind: "forex", liquidity: 7 },
  { epic: "EURJPY", name: "EUR/JPY", kind: "forex", liquidity: 6 },
  { epic: "EURCHF", name: "EUR/CHF", kind: "forex", liquidity: 6 },
  // Metalle & Rohstoffe
  { epic: "SILVER", name: "Silver", kind: "metal", liquidity: 7 },
  { epic: "PLATINUM", name: "Platinum", kind: "metal", liquidity: 5 },
  { epic: "OIL_CRUDE", name: "Crude Oil Spot", kind: "commodity", liquidity: 7 },
  { epic: "NATURALGAS", name: "Natural Gas", kind: "commodity", liquidity: 6 },
  // Krypto
  { epic: "BTCUSD", name: "Bitcoin/USD", kind: "crypto", liquidity: 8 },
  { epic: "ETHUSD", name: "Ethereum/USD", kind: "crypto", liquidity: 7 },
  { epic: "SOLUSD", name: "Solana/USD", kind: "crypto", liquidity: 5 },
  // Aktien
  { epic: "AAPL", name: "Apple Inc", kind: "stock", liquidity: 8 },
  { epic: "NVDA", name: "NVIDIA Corp", kind: "stock", liquidity: 8 },
  { epic: "MSFT", name: "Microsoft Corp", kind: "stock", liquidity: 8 },
  { epic: "TSLA", name: "Tesla Inc", kind: "stock", liquidity: 7 },
  { epic: "AMZN", name: "Amazon.com Inc", kind: "stock", liquidity: 7 },
  { epic: "GOOGL", name: "Alphabet Inc - A", kind: "stock", liquidity: 7 },
  { epic: "META", name: "Meta Platforms Inc", kind: "stock", liquidity: 7 },
  { epic: "AMD", name: "Advanced Micro Devices Inc", kind: "stock", liquidity: 6 },
  { epic: "NFLX", name: "Netflix Inc", kind: "stock", liquidity: 6 },
  { epic: "JPM", name: "JPMorgan Chase & Co", kind: "stock", liquidity: 6 },
  { epic: "V", name: "Visa Inc", kind: "stock", liquidity: 6 },
  { epic: "BA", name: "Boeing Co", kind: "stock", liquidity: 5 },
];

export const KIND_LABEL: Record<AssetKind, string> = {
  metal: "Metall",
  index: "Index",
  forex: "Forex",
  crypto: "Krypto",
  stock: "Aktie",
  commodity: "Rohstoff",
};
