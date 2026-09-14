# EDGE RUN 🏃‍♂️💨

Gamifizierter Rabatt-Endless-Runner für **Edge Chase**. Der Spieler sprintet über
Dächer und wird vom Edge-Chase-Logo („dem EDGE") gejagt – je weiter er kommt,
desto besser die Chance auf einen Rabattcode. Läuft eigenständig auf **Vercel**
und wird per **iframe** in die Wix-Seite eingebettet.

Dieses Projekt liegt bewusst im Unterordner `edge-run/` und ist komplett
unabhängig vom übrigen Repo (dem Promo-Video-Tool im Wurzelverzeichnis). Es hat
keinen Build-Schritt, keine Framework-Abhängigkeit und keine npm-Pakete.

---

## Wie es funktioniert (Kurzüberblick)

1. **Intro:** Spieler gibt Name + E-Mail ein und akzeptiert die Bedingungen.
   → `POST /api/start` gibt ein **signiertes Session-Token** zurück (Name &
   E-Mail-Hash stecken fälschungssicher darin).
2. **Spiel:** Canvas-Endless-Runner. Distanz = Score. Tempo steigt. Das Logo
   holt bei Fehlern auf (Threat-Meter); volles Meter oder Sturz = vorbei.
3. **Auswertung:** `POST /api/reward` prüft das Token, verhindert Replay,
   **plausibilisiert den Score gegen die Spieldauer** und **zieht die Belohnung
   serverseitig** aus einer gewichteten Tabelle. Bei Gewinn wird (falls Wix
   konfiguriert) der Coupon erstellt – Code-Schema `NAME + %`, z. B. `DAVID15-K7QA`.

### Das zentrale Prinzip: Belohnung ≠ Skill

Der Score bestimmt **nur die Stufe** (low / mid / high). Die konkrete Belohnung
kommt aus der Wahrscheinlichkeitstabelle der jeweiligen Stufe. Dadurch:

- **10–15 %** sind für fast jeden erreichbar (geringes Risiko für euch).
- **25 %+** sind selten (nur mit gutem Score *und* Glück).
- **Gratis-Teil** ist real, aber extrem selten (Standard ~0,4 % nur auf der
  höchsten Stufe) **und** zusätzlich per Monatslimit gedeckelt.

Selbst wer den Score fälscht, ändert nur die *Stufe* – die eigentliche Chance
bleibt in eurer Hand. Zusätzlich wird der Score gegen die reale Spielzeit
gekappt (max. ~95 m/s sind physikalisch möglich).

---

## Lokal ausprobieren

```bash
# aus dem Ordner edge-run/
npx vercel dev        # startet Frontend + /api Functions lokal
# oder nur das Frontend (ohne Backend):
python3 -m http.server 8000
```

Ohne gesetzte ENV-Variablen läuft alles im **Demo-Modus**: Codes werden
angezeigt, aber (noch) nicht in Wix erstellt.

---

## Deployment auf Vercel

1. Neues Vercel-Projekt aus diesem Repo.
2. **Root Directory = `edge-run`** (wichtig – so bleibt das Video-Tool im
   Wurzelverzeichnis unberührt).
3. Framework Preset: **Other**. Kein Build Command nötig.
4. Environment-Variablen setzen (siehe `.env.example`), mindestens
   `SESSION_SECRET`.
5. Deploy. Ergebnis: `https://<projekt>.vercel.app`.

### In Wix einbetten

Am besten als **Lightbox/Popup** mit einem HTML-/iframe-Element:

```html
<iframe src="https://<projekt>.vercel.app"
        style="border:0;width:100%;height:100%;min-height:640px"
        allow="clipboard-write"></iframe>
```

Empfohlener Trigger: **Exit-Intent** oder nach ~5 Sekunden ein dezentes Banner
(„Schaffst du es, dem EDGE zu entkommen?" – Ja/Später), das die Lightbox öffnet.
Zusätzlich ein fester kleiner Button „🎮 Rabatt erspielen".

Optionale Konfiguration aus Wix heraus (vor dem iframe-Inhalt setzbar, wenn du
den HTML-Block selbst hostest): `window.EDGE_RUN = { shopUrl, termsUrl, privacyUrl }`.

---

## Konfiguration & Feintuning

Alles über ENV-Variablen, **ohne Code-Änderung** (siehe `.env.example`):

| Variable | Zweck |
|---|---|
| `SESSION_SECRET` | **Pflicht.** Signaturschlüssel der Token. |
| `WIX_API_KEY`, `WIX_SITE_ID` | Aktiviert echte Wix-Coupons. Leer = Demo. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel KV: macht Tageslimit/Replay-Schutz dauerhaft. |
| `REWARD_LOW_MAX`, `REWARD_MID_MAX` | Score-Grenzen der Stufen. |
| `REWARD_TABLE_JSON` | Komplette Gewinntabellen überschreiben. |
| `COUPON_EXPIRY_DAYS` | Gültigkeit der Codes. |
| `JACKPOT_MAX_PER_MONTH` | Deckel für Gratis-Teile. |

Belohnungstabellen im Code: `api/lib/reward.js` (`DEFAULT_TABLES`).

---

## Logo

`assets/logo.png` ist das offizielle Edge-Chase-Logo (auf 512px optimiert;
Original als `assets/logo-original.png`). Das Spiel bevorzugt die PNG, sonst
greift `assets/logo.svg` als Fallback. Zum Austausch einfach `assets/logo.png`
ersetzen (transparenter Hintergrund).

Das Logo wird im Spiel weiß eingefärbt und rotiert als Verfolger mit rotem Glow.

> **Wichtig (Vercel):** Statische Dateien liegen bewusst in `assets/`, **nicht**
> in `public/`. Bei „Other"-Projekten ohne Build setzt Vercel das Output-
> Verzeichnis sonst automatisch auf `public/` und liefert die `index.html` im
> Wurzelverzeichnis nicht aus (404).

---

## Struktur

```
edge-run/
├── index.html            # Screens: Intro / Spiel / Ergebnis
├── src/
│   ├── styles.css        # Brand-Styling (schwarz/weiß + Signal-Rot)
│   ├── game.js           # Endless-Runner-Engine (Canvas)
│   └── app.js            # Screen-Flow, API-Calls, Gewinn-Enthüllung
├── api/
│   ├── start.js          # Session-Token ausgeben
│   ├── reward.js         # Auswertung + Coupon (autoritativ)
│   └── lib/
│       ├── token.js      # HMAC-Signatur der Sessions
│       ├── reward.js     # Gewichtete Lotterie + Code-Schema
│       ├── store.js      # Rate-Limit / Replay (KV-ready)
│       ├── wix.js        # Wix-Coupon-Erstellung
│       └── http.js       # kleine HTTP-Helfer
├── assets/               # statische Assets (NICHT "public/" – siehe Hinweis oben)
│   ├── logo.png          # offizielles Logo (512px, Runtime)
│   ├── logo-original.png # Original 4800px
│   └── logo.svg          # SVG-Fallback
├── vercel.json
└── .env.example
```

## Rechtliches (Kurz-Hinweis)

Geschicklichkeitsspiel + kostenlose Teilnahme ⇒ **kein** Glücksspiel. Trotzdem:
Teilnahmebedingungen und Datenschutzhinweise verlinken (Felder `termsUrl`/
`privacyUrl`), E-Mail-Nutzung nur mit Double-Opt-in. Kein Rechtsrat – bitte kurz
gegenlesen lassen.
