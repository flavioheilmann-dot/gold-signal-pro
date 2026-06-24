// ─────────────────────────────────────────────────────────────
// Background trading engine — orchestrates data → strategy → risk →
// paper execution → notifications on a polling loop.
//
// BACKGROUND CAVEAT: in a pure browser app this loop only runs while the
// tab/app is OPEN (setInterval is throttled/paused in background tabs).
// Reliable 24/7 operation needs a backend or Electron worker. This project
// already ships a cloud path (GitHub Actions scanner in /server) for
// laptop-off notifications; this engine is the live, in-app analyst.
// A Node/Electron worker could import these same pure modules unchanged.
// ─────────────────────────────────────────────────────────────
import type { Bias, Candle, ExitMode, MarketContext, PaperTrade, RiskConfig, TradeSignal } from "../types";
import { DEFAULT_RISK } from "../types";
import type { DataProvider } from "../data/DataProvider";
import { analyze, DEFAULT_STRATEGY_OPTS, type SetupStage } from "../strategy/StrategyEngine";
import { indicesAligned, isIndexSymbol, structureTrend, type StructTrend } from "../strategy/tjr";
import { MIN_PAPER_SCORE } from "../strategy/confidence";
import { RiskManager, type RiskState, type RiskStatus } from "../risk/RiskManager";
import { PaperBroker } from "../paper/PaperBroker";
import { liveTradingEnabled } from "../broker/BrokerAdapter";
import { notifySignal, type NotifyConfig } from "../notifications/notify";

export interface EngineOptions {
  symbol: string;
  timeframe: string; // "5m"
  candleLimit: number;
  intervalMs: number; // 5000–15000
  autoPaper: boolean; // auto-open paper trades at ≥75
  mtfEntry: boolean; // require a 1m BOS to confirm the entry (multi-timeframe)
  // TJR V2 (from the "improved TJR" video) — all toggleable:
  mode: "v1" | "v2"; // v1 = the video's winning simple sweep→BOS entry
  exitMode: ExitMode; // "trail" / "rr1to1" / "tp"
  longOnly: boolean; // indices drift up → only take longs
  htfBiasFilter: boolean; // 1H bias filter (video found it does NOT help → default off)
  requireKillzone: boolean; // only enter inside the London/NY killzones
  riskPct?: number; // per-trade risk override (per-asset, ≈20% DD)
  notify: NotifyConfig;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  symbol: "US100",
  timeframe: "15m", // video: indices on 15m
  candleLimit: 500,
  intervalMs: 8000,
  autoPaper: true,
  mtfEntry: false, // V1 enters on the BOS, no 1m trigger needed
  mode: "v1", // the video's winner
  exitMode: "trail", // 1R-step trailing stop, no partials
  longOnly: true, // long-only on indices
  htfBiasFilter: false, // video: 1H bias did not improve results
  requireKillzone: true, // indices use the session filter
  notify: { browser: false, ntfy: false, ntfyTopic: "" },
};

/** Index series used as the alignment reference (NASDAQ × S&P). */
const ALIGN_EPICS = ["US100", "US500"] as const;

export interface EngineStatus {
  running: boolean;
  liveDisabled: boolean;
  dataSource: string;
  dataMode: "mock" | "live";
  lastCheck: number | null;
  candleCount: number;
  stage: SetupStage;
  stageLabel: string;
  bias: Bias;
  currentSignal: TradeSignal | null;
  lastSignal: TradeSignal | null;
  signalFeed: TradeSignal[];
  openTrades: PaperTrade[];
  closedToday: number;
  risk: RiskStatus;
  error: string | null;
  // transparency for the new TJR gates
  indexAligned: boolean | null; // null = not an index (gate N/A)
  indexAlignDir: StructTrend | null;
  htfBias: StructTrend | null; // 1H higher-timeframe trend (null = filter off)
  ltfConfirmed: boolean | null; // 1m entry trigger state (null = MTF off / on 1m)
  candles: Candle[]; // last analyzed HTF candles (for the chart)
}

export interface PersistedEngine {
  riskState?: RiskState;
  paperOpen?: PaperTrade[];
  paperClosed?: PaperTrade[];
}

export class BackgroundEngine {
  private provider: DataProvider;
  private opts: EngineOptions;
  private rm: RiskManager;
  private paper: PaperBroker;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCheck: number | null = null;
  private lastCandleTime = 0;
  private candleCount = 0;
  private stage: SetupStage = "no_data";
  private stageLabel = "—";
  private bias: Bias = "neutral";
  private currentSignal: TradeSignal | null = null;
  private lastSignal: TradeSignal | null = null;
  private lastSignalId = "";
  private signalFeed: TradeSignal[] = [];
  private error: string | null = null;
  private indexAligned: boolean | null = null;
  private indexAlignDir: StructTrend | null = null;
  private htfBias: StructTrend | null = null;
  private ltfConfirmed: boolean | null = null;
  private lastCandles: Candle[] = [];
  // index-alignment reference series, refetched at most every 30s
  private alignCache: { at: number; tf: string; aligned: boolean; dir: StructTrend } | null = null;
  // 1H higher-timeframe bias, refetched at most every 60s
  private htfCache: { at: number; sym: string; bias: StructTrend } | null = null;

  onUpdate: (status: EngineStatus) => void = () => {};

  constructor(
    provider: DataProvider,
    riskConfig: RiskConfig = DEFAULT_RISK,
    opts: Partial<EngineOptions> = {},
    persisted: PersistedEngine = {}
  ) {
    this.provider = provider;
    this.opts = { ...DEFAULT_ENGINE_OPTIONS, ...opts };
    this.rm = new RiskManager(riskConfig, persisted.riskState);
    this.paper = new PaperBroker(persisted.paperOpen ?? [], persisted.paperClosed ?? []);
  }

  setOptions(opts: Partial<EngineOptions>) {
    const prevSymbol = this.opts.symbol;
    const prevTimeframe = this.opts.timeframe;
    const prevInterval = this.opts.intervalMs;
    this.opts = { ...this.opts, ...opts };

    // switching symbol OR timeframe = fresh watch: reset per-watch runtime
    // (open trades for the old symbol stay open but pause; risk is account-wide)
    const watchChanged =
      (!!opts.symbol && opts.symbol !== prevSymbol) ||
      (!!opts.timeframe && opts.timeframe !== prevTimeframe);
    if (watchChanged) {
      this.lastCandleTime = 0;
      this.currentSignal = null;
      this.lastSignalId = "";
      this.stage = "no_data";
      this.stageLabel = "—";
      this.bias = "neutral";
      this.error = null;
      this.indexAligned = null;
      this.indexAlignDir = null;
      this.htfBias = null;
      this.ltfConfirmed = null;
      this.lastCandles = [];
      this.alignCache = null;
      this.htfCache = null;
      if (this.running) this.tick();
    }

    // changing the poll cadence must re-arm the running timer
    if (opts.intervalMs && opts.intervalMs !== prevInterval && this.running) {
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit();
  }

  isRunning() {
    return this.running;
  }

  private async tick() {
    try {
      const candles = await this.provider.getCandles(this.opts.symbol, this.opts.timeframe, this.opts.candleLimit);
      this.lastCheck = Date.now();
      this.candleCount = candles.length;
      this.lastCandles = candles;
      if (candles.length < 60) {
        this.error =
          this.provider.mode === "live"
            ? `Keine Live-Daten von ${this.provider.name} (Backend offline? Auf Sim-Daten umschalten)`
            : "Zu wenig Daten";
        this.stage = "no_data";
        this.stageLabel = candles.length === 0 ? "Keine Daten" : "Zu wenig Daten";
        return this.emit();
      }
      this.error = null;
      const last = candles[candles.length - 1];

      // step open paper trades once per new bar (only this symbol's trades)
      if (last.time !== this.lastCandleTime) {
        for (const ev of this.paper.update(last, this.opts.symbol)) this.rm.registerResult(ev.pnl);
        this.lastCandleTime = last.time;
      }

      const spreadPct = (await this.provider.getSpreadPct?.(this.opts.symbol)) ?? 0.02;

      // TJR index-alignment gate (US100 × US500) — only for index symbols
      const align = isIndexSymbol(this.opts.symbol) ? await this.indexAlignment() : null;
      this.indexAligned = align ? align.aligned : null;
      this.indexAlignDir = align ? align.dir : null;

      // multi-timeframe (V2 only): 1-minute candles confirm the entry (BOS)
      const ltf =
        this.opts.mode !== "v1" && this.opts.mtfEntry && this.opts.timeframe !== "1m"
          ? await this.provider.getCandles(this.opts.symbol, "1m", this.opts.candleLimit)
          : undefined;

      // higher-timeframe (1H) bias — off by default (video found it doesn't help)
      const htf = this.opts.htfBiasFilter ? await this.htfBiasOf() : null;
      this.htfBias = htf;

      // per-asset risk override (≈20% isolated drawdown, video's portfolio sizing)
      if (this.opts.riskPct && this.rm.cfg.riskPctPerTrade !== this.opts.riskPct) {
        this.rm.cfg.riskPctPerTrade = this.opts.riskPct;
      }

      const ctx: MarketContext = {
        symbol: this.opts.symbol,
        spreadPct,
        newsRisk: false, // hook a real news feed here
        contextConfirms: align?.aligned ?? !isIndexSymbol(this.opts.symbol), // non-index assets pass by default
        choppy: false,
        indexAligned: align ? align.aligned : undefined,
        indexAlignDir: align ? align.dir : undefined,
        htfBias: htf ?? undefined,
      };

      const opts = {
        ...DEFAULT_STRATEGY_OPTS,
        mode: this.opts.mode,
        exitMode: this.opts.exitMode,
        longOnly: this.opts.longOnly && isIndexSymbol(this.opts.symbol),
        requireKillzone: this.opts.requireKillzone,
      };
      const res = analyze(candles, ctx, this.rm.cfg, opts, ltf);
      this.stage = res.stage;
      this.stageLabel = res.stageLabel;
      this.bias = res.bias;
      this.currentSignal = res.signal;
      this.ltfConfirmed = res.ltfConfirmed;

      // new signal → feed + notify (deduped by id)
      if (res.signal && res.signal.id !== this.lastSignalId) {
        this.lastSignalId = res.signal.id;
        this.lastSignal = res.signal;
        this.signalFeed = [res.signal, ...this.signalFeed].slice(0, 12);
        notifySignal(res.signal, this.opts.notify);

        // auto paper-trade on a high-quality, retraced setup
        if (
          this.opts.autoPaper &&
          res.stage === "ready" &&
          res.signal.confidence >= MIN_PAPER_SCORE &&
          !this.paper.hasOpenFor(this.opts.symbol)
        ) {
          const ct = this.rm.canTrade();
          const v = this.rm.validateSignal(res.signal);
          if (ct.ok && v.ok) {
            const { size, riskAmount } = this.rm.positionSize(res.signal.entry, res.signal.stopLoss);
            if (size > 0) {
              this.paper.openTrade(res.signal, size, riskAmount, last.time);
              this.rm.registerOpen();
            }
          }
        }
      }
      this.emit();
    } catch (e) {
      this.error = String((e as Error)?.message ?? e);
      this.emit();
    }
  }

  /**
   * Index-alignment reference (US100 × US500) on the active timeframe, cached
   * for 30s so the gate doesn't add a fetch storm. Returns range/false when a
   * series is missing so the gate fails safe (no_alignment → stand aside).
   */
  private async indexAlignment(): Promise<{ aligned: boolean; dir: StructTrend }> {
    const now = Date.now();
    if (this.alignCache && this.alignCache.tf === this.opts.timeframe && now - this.alignCache.at < 30_000) {
      return { aligned: this.alignCache.aligned, dir: this.alignCache.dir };
    }
    const [a, b] = await Promise.all(
      ALIGN_EPICS.map((e) => this.provider.getCandles(e, this.opts.timeframe, 200))
    );
    const res = a.length >= 30 && b.length >= 30
      ? indicesAligned(a, b)
      : { aligned: false, dir: "range" as StructTrend };
    this.alignCache = { at: now, tf: this.opts.timeframe, ...res };
    return res;
  }

  /**
   * Higher-timeframe (1H) trend bias for the active symbol, cached 60s. Returns
   * "range" when there isn't enough data so the bias filter simply won't block.
   */
  private async htfBiasOf(): Promise<StructTrend> {
    const now = Date.now();
    if (this.htfCache && this.htfCache.sym === this.opts.symbol && now - this.htfCache.at < 60_000) {
      return this.htfCache.bias;
    }
    const h1 = await this.provider.getCandles(this.opts.symbol, "1h", 200);
    const bias = h1.length >= 30 ? structureTrend(h1) : ("range" as StructTrend);
    this.htfCache = { at: now, sym: this.opts.symbol, bias };
    return bias;
  }

  status(): EngineStatus {
    return {
      running: this.running,
      liveDisabled: !liveTradingEnabled(),
      dataSource: this.provider.name,
      dataMode: this.provider.mode,
      lastCheck: this.lastCheck,
      candleCount: this.candleCount,
      stage: this.stage,
      stageLabel: this.stageLabel,
      bias: this.bias,
      currentSignal: this.currentSignal,
      lastSignal: this.lastSignal,
      signalFeed: this.signalFeed,
      openTrades: this.paper.open,
      closedToday: this.rm.state.dayTrades,
      risk: this.rm.status(),
      error: this.error,
      indexAligned: this.indexAligned,
      indexAlignDir: this.indexAlignDir,
      htfBias: this.htfBias,
      ltfConfirmed: this.ltfConfirmed,
      candles: this.lastCandles,
    };
  }

  /** Closed paper-trade history (for the trades table). */
  closedTrades(): PaperTrade[] {
    return this.paper.closed;
  }

  serialize(): PersistedEngine {
    return {
      riskState: this.rm.state,
      paperOpen: this.paper.open,
      paperClosed: this.paper.closed,
    };
  }

  private emit() {
    this.onUpdate(this.status());
  }
}
