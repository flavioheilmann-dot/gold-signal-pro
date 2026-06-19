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

export const WATCHLIST: Asset[] = [
  // Indizes
  { epic: "EURUSD", name: "EUR/USD", kind: "forex", liquidity: 10 },
  { epic: "US500", name: "S&P 500", kind: "index", liquidity: 10 },
  { epic: "GOLD", name: "Gold", kind: "metal", liquidity: 10 },
  { epic: "US100", name: "Nasdaq 100", kind: "index", liquidity: 9 },
  { epic: "DE40", name: "DAX 40", kind: "index", liquidity: 9 },
  { epic: "FR40", name: "CAC 40", kind: "index", liquidity: 7 },
  { epic: "UK100", name: "FTSE 100", kind: "index", liquidity: 8 },
  { epic: "JP225", name: "Nikkei 225", kind: "index", liquidity: 7 },
  { epic: "HK50", name: "Hang Seng", kind: "index", liquidity: 6 },
  { epic: "EU50", name: "Euro Stoxx 50", kind: "index", liquidity: 7 },
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
  { epic: "SILVER", name: "Silber", kind: "metal", liquidity: 7 },
  { epic: "PLATINUM", name: "Platin", kind: "metal", liquidity: 5 },
  { epic: "OIL_CRUDE", name: "Öl (WTI)", kind: "commodity", liquidity: 7 },
  { epic: "NATURALGAS", name: "Erdgas", kind: "commodity", liquidity: 6 },
  // Krypto
  { epic: "BTCUSD", name: "Bitcoin", kind: "crypto", liquidity: 8 },
  { epic: "ETHUSD", name: "Ethereum", kind: "crypto", liquidity: 7 },
  { epic: "SOLUSD", name: "Solana", kind: "crypto", liquidity: 5 },
  // Aktien
  { epic: "AAPL", name: "Apple", kind: "stock", liquidity: 8 },
  { epic: "NVDA", name: "Nvidia", kind: "stock", liquidity: 8 },
  { epic: "MSFT", name: "Microsoft", kind: "stock", liquidity: 8 },
  { epic: "TSLA", name: "Tesla", kind: "stock", liquidity: 7 },
  { epic: "AMZN", name: "Amazon", kind: "stock", liquidity: 7 },
  { epic: "GOOGL", name: "Google", kind: "stock", liquidity: 7 },
  { epic: "META", name: "Meta", kind: "stock", liquidity: 7 },
  { epic: "AMD", name: "AMD", kind: "stock", liquidity: 6 },
  { epic: "NFLX", name: "Netflix", kind: "stock", liquidity: 6 },
  { epic: "JPM", name: "JPMorgan", kind: "stock", liquidity: 6 },
  { epic: "V", name: "Visa", kind: "stock", liquidity: 6 },
  { epic: "BA", name: "Boeing", kind: "stock", liquidity: 5 },
];

export const KIND_LABEL: Record<AssetKind, string> = {
  metal: "Metall",
  index: "Index",
  forex: "Forex",
  crypto: "Krypto",
  stock: "Aktie",
  commodity: "Rohstoff",
};
