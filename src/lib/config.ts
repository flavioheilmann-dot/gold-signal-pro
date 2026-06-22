import { DEFAULT_STRATEGY, type StrategyParams, type SignalState } from "./indicators";

export interface AppSettings {
  params: StrategyParams;
  capital: number;
  riskPct: number;
  refreshSec: number;
  alarmOn: boolean;
  ntfyTopic: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  params: DEFAULT_STRATEGY,
  capital: 25.51,
  riskPct: 2,
  refreshSec: 30,
  alarmOn: true,
  ntfyTopic: "",
};

export interface HistoryEntry {
  time: number;
  state: SignalState;
  price: number;
  confidence: number;
}

export const LS_KEYS = {
  settings: "gsp_settings_day_v3",
  history: "gsp_history_v2",
  theme: "gsp_theme",
} as const;
