# EdgeChase Partner-Programm

Ein Micro-Affiliate-Automat über Instagram: Wer auf ein **Partner-Aufruf-Reel**
reagiert oder per DM danach fragt, wird vom Bot durch ein leichtgewichtiges
Onboarding geführt, bekommt einen persönlichen Rabatt-Code und verdient
Provision an jedem Verkauf über diesen Code.

Schwester-App zum Coupon-Automaten unter `coupon-automation/`, bewusst **strikt
getrennt**: eigenes Verzeichnis, eigenes `package.json`, eigenes Prisma-Schema,
eigene Neon-Datenbank, eigenes Vercel-Projekt, eigener Webhook-Endpunkt, eigene
VAPID-Schlüssel. Kein gemeinsamer Datenbestand, kein Code-Import über die
Ordnergrenze. Die Muster (Meta-Graph-Client, Gemini-Klassifikation, Wix-REST,
Web-Push) sind vom Coupon-Automaten **kopiert und angepasst**, nicht importiert.

## Konditionen

- **Käufer-Rabatt:** 15 % pro Code
- **Provision:** 15 % auf den Netto-Warenwert (nach Rabatt, ohne Versand/Steuer)
- **Auszahlung:** monatlich am 10. für den Vormonat, ab CHF 20 (darunter Übertrag)
- **Jahres-Deckel je Person:** CHF 2 000 (unter der AHV-Meldegrenze), per Push
  gemeldet, wenn erreicht

## Die zwei Trigger

1. **Kommentar** unter einem Reel, das die Video-Analyse (Gemini, Text als
   Fallback) als Partner-Aufruf klassifiziert.
2. **Direkte DM** ans EdgeChase-Konto mit Bezug aufs Partner-Programm — ein
   Ki-Torwächter (`istPartnerInteresse`) entscheidet, ob ein Onboarding startet.

## Der Konversations-Zustandsautomat

Jede Person hat einen `status`:

| Zustand | Bedeutung |
| --- | --- |
| `neu` | Zeile angelegt (aus Kommentar), Reel noch nicht klassifiziert |
| `sprache_offen` | Bot hat als Erstes nach DE/EN gefragt, wartet auf Antwort |
| `angeschrieben` | Willkommens-DM raus, wartet auf Zustimmung |
| `zustimmung_erhalten` | Code erzeugt und ausgeliefert, aktiv im Programm |
| `frage_offen` | Bot hat eine Rückfrage aus der Wissensbasis beantwortet |
| `eskaliert` | Betreiber übernimmt, Bot pausiert für diese Person |
| `abgelehnt` / `beendet` | keine weiteren automatischen Nachrichten |

Jede eingehende DM geht mit Zustand + letzten Nachrichten + Wissensbasis an
Gemini (`src/lib/programm/bot.ts`). Das Modell wählt eine Aktion und nennt seine
Sicherheit; **unter der Schwelle** (`SICHERHEITS_SCHWELLE`) wird eskaliert statt
geraten. Beschwerde, emotionale Nachricht, Betragsdiskussion, Off-Topic oder
„Mensch bitte“ eskalieren immer — per Web-Push ans Dashboard.

Der Bot gibt sich zu Beginn als Bot zu erkennen (Meta-Konformität) und fragt
**zuerst nach der bevorzugten Sprache**.

## Provisions-Tracking

`POST /api/wix-webhook?secret=…` empfängt `orders/created`, liest Code und
Netto-Warenwert (`leseBestellung`), ordnet den Code der Person zu und verbucht
`Bestellwert × Provisionssatz` idempotent (Doppelsperre über `wixOrderId`).
Aggregation je Person und Monat/Jahr für Dashboard und Auszahlung.

## Dashboard (`/`)

Pro Person: Code, Einlösungen, Umsatz, offene Provision, Jahres-Provision gegen
den Deckel, Status, kompletter Konversations-Verlauf mit dem Bot. Eskalationen
stehen oben. Aktionen: sperren/entsperren, nach Eskalation freigeben, löschen
(Datenschutz-Löschrecht). Reels lassen sich von Hand als Partner-Aufruf
markieren oder ausschliessen. Web-Push für Eskalationen und neue Reels.

## Öffentliche Teilnahmebedingungen (`/regeln`)

Landing-Page mit Regeln, Datenschutz (Zweckbindung, keine Weitergabe,
Löschrecht) und FAQ — dieselbe Wissensbasis wie die Bot-Antworten. Die
Onboarding-DM verlinkt sie; die akzeptierte Fassung wird je Person in
`Partner.agbVersion` festgehalten.

## Einrichtung

1. `.env` aus `.env.example` befüllen (eigene Neon-DB, eigene VAPID-Keys, eigenes
   `IG_WEBHOOK_VERIFY_TOKEN`, `WIX_WEBHOOK_SECRET`).
2. `npm install`
3. `npm run prisma:deploy` (Migrationen) bzw. `npm run prisma:migrate` (lokal)
4. `npm run dev`
5. Meta-Webhook auf `…/api/webhook` registrieren (macht der Betreiber selbst —
   **nicht** die `comments`/`messages`-Abos des Coupon-Automaten anfassen).
6. Wix-Automation `orders/created` → `…/api/wix-webhook?secret=<WIX_WEBHOOK_SECRET>`.

## Wichtige Dateien

- `prisma/schema.prisma` — Datenmodell (Partner, Nachricht, Bestellung, Auszahlung, …)
- `src/lib/instagram/graph.ts` — Meta-Graph-Client + Webhook-Parsing + Signatur
- `src/lib/instagram/videoanalyse.ts` — Reel-Klassifikation (Partner-Aufruf)
- `src/lib/programm/bot.ts` — Gemini-Entscheider (Zustandsautomat)
- `src/lib/programm/verarbeitung.ts` — Kommentar-Aufnahme + DM-Router + Aktionen
- `src/lib/programm/provision.ts` — Provisionsberechnung + Aggregation
- `src/lib/programm/wissensbasis.ts` — Konditionen, Willkommens-DM, FAQ, Regeln
- `src/lib/wix/coupons.ts` — Wix-REST (Partner-Codes, Bestell-Parsing)
