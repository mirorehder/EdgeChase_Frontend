# EdgeChase Promo-Video-Generator

Erzeugt täglich automatisch ein kurzes Werbevideo aus einer festen Sammlung
eigener Clips und legt es auf Google Drive ab. Läuft vollständig in der
Cloud - kein lokaler Rechner, kein Eingreifen des Nutzers.

## Architektur

```
Vercel Cron (1x/Tag)
  -> /api/cron (geschützt per CRON_SECRET)
       -> Clip-Bibliothek mit Drive abgleichen (neue Clips aufnehmen)
       -> Neue Clips per Gemini analysieren (Beschreibung, apparelScore, bester Ausschnitt)
       -> Gemini wählt 3-4 Clips + formuliert Hook-Text-Variante
       -> Rendern über Remotion Lambda (AWS)
       -> Fertiges Video nach Google Drive hochladen (mit Retry + Duplikatschutz)
```

- **Web-App/API:** Next.js (App Router) auf Vercel
- **Datenbank:** PostgreSQL (Neon) über Prisma
- **Rendern:** Remotion Lambda (AWS) - Pay-per-Render, skaliert auf null
- **KI:** Gemini (`gemini-3.1-flash-lite`) für Clip-Analyse und Textvariation
- **Drive-Zugriff:** Google-Service-Account (kein interaktiver Login, keine
  ablaufenden Tokens)

## Einmaliges Setup

### 1. Neon-Postgres

Projekt auf [neon.tech](https://neon.tech) anlegen, Connection-String als
`DATABASE_URL` übernehmen.

### 2. Google-Service-Account

1. Projekt in der [Google Cloud Console](https://console.cloud.google.com)
   anlegen, **Google Drive API** aktivieren.
2. Unter „IAM & Verwaltung" > „Dienstkonten" ein neues Dienstkonto anlegen,
   JSON-Schlüssel erzeugen und herunterladen.
3. Zwei Ordner in Google Drive anlegen (oder vorhandene nutzen): einen für
   die Rohclips, einen für die fertigen Videos.
4. Beide Ordner für die E-Mail-Adresse des Dienstkontos freigeben
   (`xyz@projekt.iam.gserviceaccount.com`), Rolle „Betrachter" reicht für
   den Quellordner, „Bearbeiter" für den Zielordner.
5. Den kompletten Inhalt der heruntergeladenen JSON-Datei einzeilig als
   `GOOGLE_SERVICE_ACCOUNT_JSON` hinterlegen (z.B. `cat key.json | jq -c .`).
6. Die Ordner-IDs (aus der Drive-URL, der Teil nach `/folders/`) als
   `DRIVE_SOURCE_FOLDER_ID` und `DRIVE_OUTPUT_FOLDER_ID` hinterlegen.

### 3. Gemini

API-Key unter [ai.google.dev](https://ai.google.dev) erzeugen, als
`GEMINI_API_KEY` hinterlegen.

### 4. Remotion Lambda (AWS)

Erfordert ein AWS-Konto mit einem IAM-Nutzer, der Remotion-Lambda-Rechte hat
(siehe [Remotion-Doku](https://www.remotion.dev/docs/lambda/setup)).

```bash
npm install
# .env lokal mit REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY / REMOTION_AWS_REGION befüllen
npm run remotion:lambda:deploy-function   # legt die Lambda-Funktion an, gibt REMOTION_LAMBDA_FUNCTION_NAME aus
npm run remotion:lambda:deploy-site       # bündelt die Komposition, gibt REMOTION_SERVE_URL aus
```

Beide Ausgaben als Umgebungsvariablen hinterlegen.
`npm run remotion:lambda:deploy-site` nach jeder Änderung an
`src/remotion/**` erneut ausführen - sonst rendert Lambda mit der alten
Komposition weiter.

### 5. Vercel

1. Repository importieren, alle Umgebungsvariablen aus `.env.example`
   hinterlegen (inkl. eines frei gewählten `CRON_SECRET`).
2. `vercel.json` registriert den täglichen Cron-Job automatisch
   (`/api/cron`, aktuell 08:00 UTC - Uhrzeit dort anpassbar). Vercel setzt
   bei Cron-Aufrufen automatisch den Header
   `Authorization: Bearer <CRON_SECRET>`, sobald diese Variable gesetzt ist.
3. `npx prisma migrate deploy` einmalig gegen die Neon-Datenbank laufen
   lassen (lokal mit gesetzter `DATABASE_URL`, oder als Vercel-Build-Step).

## Lokale Entwicklung

```bash
npm install
cp .env.example .env   # Werte eintragen
npx prisma migrate dev
npm run dev
```

Remotion-Studio zur Vorschau der Komposition:

```bash
npm run remotion:studio
```

## Kontroll-Oberfläche

Die Startseite (`/`) zeigt die Clip-Bibliothek (Anzahl, analysiert,
tauglich), alle erzeugten Videos mit Status, Hook-Text, verwendeten Clips
und Drive-Link, sowie zwei Aktionen:

- **Jetzt Video erzeugen** - löst denselben Ablauf wie der tägliche Cron-Job
  manuell aus.
- **Clip-Bibliothek abgleichen** - gleicht neue Clips aus dem Drive-Ordner ab
  und analysiert sie, ohne ein Video zu erzeugen.

## Stand der Umsetzung

Ohne produktive Zugangsdaten (Neon, Gemini, Google-Service-Account, AWS)
lässt sich die Kette nicht Ende-zu-Ende an echten Daten nachweisen. Bisher
geprüft:

- ✅ Projekt baut fehlerfrei (`npm run build`, `npm run typecheck`)
- ✅ Prisma-Schema erzeugt den Client wie spezifiziert
- ✅ Remotion-Komposition rendert korrekt: Text-Overlay (mehrzeiliger
  Umbruch, weiß mit schwarzer Kontur, mittig, respektiert 84%-Breitengrenze)
  wurde als Standbild gegen hellen und dunklen Hintergrund geprüft
- ⏳ Drive-Zugriff (Listen/Download/Upload mit Service-Account), Gemini-
  Clip-Analyse, Remotion-Lambda-Render mit echtem Videomaterial und der
  tägliche Cron-Lauf sind fertig implementiert, aber noch nicht gegen echte
  Zugangsdaten geprüft - das sollte vor dem produktiven Einsatz einmal
  vollständig durchlaufen werden (Auftrag Abschnitt 8, Schritte 1-6).

## Bekannte Kostenpunkte

Alles außer dem Rendern läuft im jeweiligen Gratistarif (Vercel Hobby, Neon
Free, Gemini Free Tier). Remotion Lambda wird pro Render abgerechnet -
Bruchteile von Cent für ein 15-Sekunden-Video.
