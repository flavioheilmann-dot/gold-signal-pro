# Basket-Test — Long-only Trendfolge (robust-1-trendfolge.pine)

Ziel: prüfen, ob die Edge (PF 1,41 auf SP500) **über mehrere Indizes mit
IDENTISCHEN Einstellungen** stabil > 1 bleibt. Gleiche Parameter überall =
ehrlicher Robustheits-Test. Wenn es nur mit pro-Asset-Tuning klappt → Overfit.

## Fixe Regeln (NICHT pro Asset ändern!)
- Skript: **robust-1-trendfolge.pine** (Long-only) — NICHT #3.
- Timeframe: **1D (Tageschart)**.
- Inputs: **Standard lassen** (Regime 200 · Breakout 50 · Exit 20 · ATR 14 · ATR-Stop 2.0).
- Properties: **Commission + Slippage** realistisch setzen (bei 1D klein, aber sauber).
- Pro Asset notieren: aus „Key stats": **Profit-Faktor · Total PnL % · Max Drawdown % · Trades (Profitable x/y)** + die Zeile **„Buy & hold return %"** (Performance-Tab).

## Tabelle ausfüllen
| Asset (Symbol)        | Profit-Faktor | Net PnL % | Max DD % | Trades | Buy&Hold % |
|-----------------------|---------------|-----------|----------|--------|------------|
| US500 (S&P 500)       | 1.41 (Ref.)   |           |          | 21     |            |
| US100 (Nasdaq 100)    |               |           |          |        |            |
| DE40  (DAX)           |               |           |          |        |            |
| US30  (Dow Jones)     |               |           |          |        |            |
| J225  (Nikkei, opt.)  |               |           |          |        |            |
| UK100 (FTSE, opt.)    |               |           |          |        |            |
| XAUUSD (Gold, opt.)   |               |           |          |        |            |

## Wann gilt die Edge als „robust"?
- ✅ **PF > 1 auf der MEHRHEIT** der Indizes (idealerweise alle ~1,2+).
- ✅ Im Schnitt **Buy & Hold geschlagen ODER gleich gut bei kleinerem Drawdown**.
- ❌ Wenn sie nur auf 1–2 Assets > 1 ist und sonst verliert → fragil / Glück, NICHT live traden.

## Danach
Wenn robust → wir bauen den **„Tages-Trendfolge (Long-only)"-Modus** in die App
(Indizes-Watchlist, Alarm/Push). Wenn nicht → ehrlich bleiben, nicht live gehen.
