# EdgeChase Insights

Eine schmale Auswertungs-App zum EdgeChase Content Generator.

Sie zeigt Instagram-Kennzahlen (Reichweite, Aufrufe, Likes, Kommentare,
Shares, Saves) je Sparte und Reel, dazu Umsatz und Bestellungen aus Wix.
Sie erzeugt keine Videos und postet nichts - beides bleibt beim Generator.

## Aufbau

- **Framework:** Next.js 14, App Router, TypeScript.
- **Datenquellen:** Neon-Postgres (Tabelle `PromoVideo` - lesend), Instagram
  Graph-API v21.0, Wix REST v3, optional die Coupon-Generator-App.
- **UI:** deutsch, hell- und dunkelmodus-tauglich, als PWA installierbar.
- **Zwischenspeicherung:** ein Prozess-Cache mit 5 Minuten Lebensdauer je
  Aufruf. Kein Redis.

Das Projekt liegt bewusst als eigener Ordner im Repository und ist ein
eigenes Vercel-Projekt (`Root Directory = insights`). So bleibt der Generator
technisch unangetastet.

## Aufsetzen

```bash
cd insights
npm install
npx prisma generate
# Umgebungsvariablen setzen - siehe .env.example
npm run dev
```

Der Entwicklungsserver laeuft auf `http://localhost:3001` (Port bewusst
verschieden vom Generator, damit beide nebeneinander laufen koennen).

## Verify-Skripte

- `npm run verify:aggregation` - prueft die Kennzahlen-Aggregation gegen
  erfundene Eingaben. Ohne Live-API testbar.
- `npm run verify:funnel` - prueft die Code-Umsatz-Karte und die
  Funnel-Rechnung gegen erfundene Bestellungen und Codes.
- `npm run verify:zuordnung` - laeuft nur mit gesetzter `DATABASE_URL`;
  zeigt je Sparte, wie viele Videos gepostet sind und listet die letzten
  drei mit ihrer `postedMediaId`.

## Zuordnung `postedMediaId` -> Sparte

Der Content Generator schreibt jedem geposteten Reel eine Zeile in
`PromoVideo` mit `track` (die Sparte) und `postedMediaId` (die IG-Media-ID).
Insights liest genau diese Zuordnung. Nur `status = "done"` und ein gefuellter
`postedMediaId` zaehlen - alles andere ist noch nicht gepostet und hat bei
Instagram nichts zu suchen.

## Promo-Funnel

Vier Ebenen, jede unabhaengig messbar:

1. **Kommentare** - aus der IG-Graph-API.
2. **Ausgegebene Codes** - aus der Coupon-Generator-App
   (`postedMediaId -> codes`).
3. **Eingeloeste Codes** - aus den Wix-Bestellungen
   (`appliedDiscounts[].coupon.code`).
4. **Umsatz je Video** - Summe des Umsatzes aller Codes des Videos.

Fehlt eine Quelle, wird die entsprechende Ebene ausdruecklich als "nicht
messbar" markiert - es wird NICHTS geschaetzt oder aufgefuellt.

## Icons

`npm run make-icons` erzeugt `public/icon-192.png`, `public/icon-512.png`
und `public/apple-touch-icon.png` ohne Abhaengigkeiten (analog zum Skript im
Generator). Motiv: vier aufsteigende Balken in den Leitfarben der vier
Sparten - so ist am Homescreen sofort klar, dass dies die Auswertungs-App
ist.

## Ausrollen als eigenes Vercel-Projekt

1. Neues Vercel-Projekt anlegen, Repo `mirorehder/EdgeChase_Frontend`,
   Branch `claude/edgechase-insights-vhrpu8`, **Root Directory** `insights`.
2. Neon-Integration ergaenzen (`DATABASE_URL`) - dieselbe Datenbank wie der
   Generator.
3. Die Env-Variablen aus `.env.example` setzen, soweit vorhanden.
4. Deploy - beim Build laeuft nur `prisma generate` und `next build`, keine
   Migrationen (die bleiben allein beim Generator).
