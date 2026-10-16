# EdgeChase Game 🏃‍♂️💨

Gamifizierter Rabatt-Endless-Runner für **EdgeChase**. Der Spieler sprintet über
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
2. **Spiel:** Canvas-Endless-Runner über Dächer (Skyline mit Neon-Schriftzug,
   gegliederter Läufer, Kisten/Klimageräte, Hängebalken, Dachlücken). Distanz =
   Score, in Metern aus der Laufzeit – auf Handy und Desktop identisch. Das Logo
   holt bei Fehlern auf (Threat-Meter); volles Meter oder Sturz = vorbei.
3. **Auswertung:** `POST /api/reward` prüft das Token, verhindert Replay,
   **plausibilisiert den Score gegen die Spieldauer** und **zieht die Belohnung
   serverseitig** aus einer gewichteten Tabelle. Bei Gewinn wird (falls Wix
   konfiguriert) der Coupon erstellt – Code-Schema `NAME + %`, z. B. `DAVID15` (bei Doppelung `DAVID15-1`, `DAVID15-2` …).

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

### Eigene Domain (game.edgechase.com)

Die Domain `edgechase.com` wird bei Wix verwaltet (Nameserver `ns6/ns7.wixdns.net`).
In Vercel ist `game.edgechase.com` dem Projekt zugeordnet. Fehlt nur noch der
DNS-Eintrag bei Wix (Domains → DNS-Einträge verwalten → CNAME):

| Typ | Host | Wert |
|---|---|---|
| CNAME | `game` | `908035fbd16fadf4.vercel-dns-017.com` |

Danach stellt Vercel das HTTPS-Zertifikat automatisch aus. Sobald die Domain läuft,
`ASSET_BASE_URL=https://game.edgechase.com` setzen (Logo in der Mail) und im
iframe die neue Adresse verwenden.

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
den HTML-Block selbst hostest): `window.EDGECHASE = { shopUrl }`.

---

## Konfiguration & Feintuning

Alles über ENV-Variablen, **ohne Code-Änderung** (siehe `.env.example`):

| Variable | Zweck |
|---|---|
| `SESSION_SECRET` | **Pflicht.** Signaturschlüssel der Token. |
| `WIX_API_KEY`, `WIX_SITE_ID` | Aktiviert echte Wix-Coupons. Leer = Demo. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel KV: macht Spiel-Limit/Replay-Schutz dauerhaft. |
| `PLAY_LIMIT` | `off` (Test), `daily` (Standard, Tageswechsel 0 Uhr Schweizer Zeit) oder `once` (ein Versuch je E-Mail-Adresse). |
| *(Test-Zugang)* | E-Mail `12345` im Formular: Spiel lädt ohne Limit, Auswertung zeigt einen `TEST-…`-Code, **erzeugt aber keinen Wix-Coupon und verschickt keine Mail**. Für echte Codes: `PLAY_LIMIT_BYPASS`. |
| `PLAY_LIMIT_BYPASS` | Komma-getrennte Test-Adressen, die ohne Limit spielen dürfen. |
| `REWARD_LADDER_JSON` | Rabatt-Leiter (Distanz → %) überschreiben. |
| `REWARD_BUMP_CHANCE`, `REWARD_FREE_CHANCE`, `REWARD_FREE_MIN` | Chance auf nächsthöhere Stufe / Gratis-Teil und dessen Mindestdistanz. |
| `COUPON_EXPIRY_DAYS` | Gültigkeit der Codes. |
| `JACKPOT_MAX_PER_MONTH` | Deckel für Gratis-Teile. |

Rabatt-Leiter im Code: `server/reward.js` (`DEFAULT_LADDER`); Schwierigkeit: `CFG` in `src/game.js`.

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
│   ├── styles.css        # Design der EdgeChase-Website (Archivo, Tinte/Papier, Rot #ed1c24)
│   ├── game.js           # Endless-Runner-Engine (Canvas, fester Zeitschritt, Läufer-Animation)
│   ├── art.js            # vorgerenderte Szenerie (Himmel, Skyline-Ebenen, Fassade, Neon-Schild)
│   └── app.js            # Screen-Flow, API-Calls, Gewinn-Enthüllung
├── api/                  # nur die zwei Endpunkte (je Datei = eine Vercel-Function)
│   ├── start.js          # Session-Token + Rabatt-Leiter ausgeben
│   └── reward.js         # Auswertung, Wix-Coupon, Mailversand (autoritativ)
├── server/               # Hilfsmodule (bewusst NICHT in api/)
│   ├── token.js          # HMAC-Signatur der Sessions
│   ├── reward.js         # Rabatt-Leiter + Code-Schema
│   ├── store.js          # Rate-Limit / Replay (KV-ready)
│   ├── wix.js            # Wix-Coupon-Erstellung
│   ├── mail.js           # Mailversand über Wix + Team-Meldung bei Jackpot
│   └── http.js           # kleine HTTP-Helfer
├── assets/               # statische Assets (NICHT "public/" – siehe Hinweis oben)
│   ├── logo.png          # offizielles Logo (512px, Runtime)
│   ├── logo-white.png    # weiße Variante (512px)
│   ├── logo-mail.png     # weiß, zugeschnitten, für die Mail
│   ├── logo-original.png # Original 4800px
│   ├── logo.svg          # SVG-Fallback
│   ├── wordmark-white.png # Wort-Bild-Logo (weiß) für Startseite und Mail
│   ├── bg.jpg            # Hintergrundfoto der Startseite
│   └── fonts/            # Archivo (Variable, OFL-Lizenz), lokal eingebunden
├── vercel.json
└── .env.example
```

## Rechtliches (Kurz-Hinweis)

Geschicklichkeitsspiel + kostenlose Teilnahme ⇒ **kein** Glücksspiel. Trotzdem:
Teilnahmebedingungen und Datenschutzhinweise gehören auf die Website (der Code
wird per E-Mail verschickt, die E-Mail-Adresse wird als Hash für das Tageslimit
gespeichert). Das Spiel selbst zeigt vor dem Start keine Checkbox mehr. Kein
Rechtsrat – bitte kurz gegenlesen lassen.
