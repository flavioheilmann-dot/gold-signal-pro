# Gold Signal Pro

Professionelles Trading-Signal-Terminal (Bloomberg/TradingView-Stil) mit
automatischer technischer Analyse auf Basis eines kostenlosen Live-Feeds.

**Stack:** Vite · React 18 · TypeScript · Tailwind CSS · shadcn/ui · lightweight-charts · Express (Capital.com-Proxy)

---

## Schnellstart

### Variante A — Doppelklick
`START.bat` ausführen. Installiert beim ersten Start automatisch die
Abhängigkeiten und öffnet die App im Browser.

### Variante B — Terminal
```bash
npm install
npm run dev      # Dev-Server auf http://localhost:5173
```

Produktionsbuild:
```bash
npm run build    # erzeugt /dist
npm run preview  # statische Vorschau auf http://localhost:4173
```

---

## Capital.com-Konto anbinden (optional)

Die App läuft **ohne** Anbindung voll (öffentliche Gold-Daten). Für echten
Kontostand, Positionen und (optional) Orders gibt es einen **lokalen Proxy**
(`server/`), weil der Browser die Capital.com-API nicht direkt aufrufen darf
(CORS). Deine Zugangsdaten bleiben **nur lokal** in `server/.env`.

1. In Capital.com → **Einstellungen → API-Integrationen** einen **API-Key**
   erstellen und ein **API-Passwort** setzen.
2. `server/.env.example` nach **`server/.env`** kopieren und ausfüllen:
   ```
   CAPITAL_ENV=live              # oder demo
   CAPITAL_API_KEY=...
   CAPITAL_IDENTIFIER=login@mail
   CAPITAL_API_PASSWORD=...
   CAPITAL_TRADING_ENABLED=false # erst lesen testen!
   ```
3. App + Proxy zusammen starten:
   ```bash
   npm run dev:all   # Vite (5173) + Proxy (8787)
   ```

**Sicherheit / Orders:**
- `server/.env` wird **nicht** committet und nie ins Frontend geladen.
- Orders sind **aus**, solange `CAPITAL_TRADING_ENABLED=false`. Der Server
  lehnt Order-Anfragen dann mit `403` ab.
- Erst mit `=true` erscheint in der App **„Order vorbereiten"**. Jede Order
  musst **du** manuell bestätigen (Aktionswort eintippen + Häkchen) — die App
  platziert **nie** automatisch. Empfehlung: zuerst mit `false` (nur lesen)
  und/oder auf einem **Demo-Key** testen, bevor du live Orders sendest.

> ⚠️ Keine Anlageberatung. CFDs sind hochriskant.

---

## Funktionen

### Signal-Engine (`src/lib/indicators.ts`)
Vier Indikatoren, live aus dem Preisverlauf berechnet:

| Indikator | Kaufen 🟢 | Verkaufen 🔴 |
|-----------|-----------|--------------|
| **RSI (14)** | < 30 | > 70 |
| **MA 20/50** | MA20 > MA50 | MA20 < MA50 |
| **Bollinger Bänder** | Preis < unteres Band | Preis > oberes Band |
| **Momentum** | positiv | negativ |

**Gesamtsignal** kombiniert alle vier:
- 3–4 bullisch → **STARKES KAUFSIGNAL** (grüner Glow, pulsierend)
- 3–4 bärisch → **STARKES VERKAUFSIGNAL** (roter Glow, pulsierend)
- Mehrheit → Kauf-/Verkaufsignal
- Gemischt → **ABWARTEN**

Dazu automatisch: Einstieg, Stop-Loss (−1.5 %), TP1 (+2 %), TP2 (+3.5 %),
Risk/Reward, empfohlener Hebel, Position-Size.

### Weitere Features
- **Live-Chart** (Preis + MA + Bollinger) mit Kauf/Verkauf-Markern
- **RSI-Subchart** mit 30/70-Linien
- **Auto-Refresh** alle 30 s mit Countdown-Ring
- **Alarm**: Sound-Beep + Browser-Notification bei Signalwechsel
- **Signal-Historie** (letzte 10) + **CSV-Export**
- **Backtest** der letzten 24 h
- **Sidebar**: Indikator-Status, Stärke-Meter, Marktzeiten, Fed-Countdown,
  Konto & Position-Size-Rechner
- **Dark/Light-Mode**, **Tastenkürzel** (`S` = Refresh, `A` = Alarm)
- Einstellbare Parameter (RSI-Periode, MA, Bollinger, …) im Settings-Panel
- Voll **mobile-responsive**, Einstellungen in `localStorage`

---

## Datenquelle

Der Live-Feed nutzt **Gold via PAX Gold (PAXG) von CoinGecko** (kostenlos, kein
API-Key). PAXG ist ein durch physisches Gold gedecktes Token, bei dem
**1 PAXG = 1 Feinunze** entspricht und das den LBMA-Spotpreis sehr eng abbildet —
also ein echter, 24/7 verfügbarer Goldpreis mit voller Historie für die
Indikatoren. Quelle in `src/lib/api.ts`. Ohne Internet schaltet die App auf eine
deterministische (gold-bepreiste) Simulation um, damit Rechner und UI weiter
funktionieren.

> ⚠️ Keine Anlageberatung. Nur zu Bildungs-/Analysezwecken.
