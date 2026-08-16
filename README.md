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

Am einfachsten über Vercel selbst: im Projekt auf **Storage → Create
Database → Neon**. Vercel legt die Datenbank an und hinterlegt
`DATABASE_URL` (gepoolt) und `DATABASE_URL_UNPOOLED` (direkt) automatisch
als Umgebungsvariablen - es muss nichts von Hand kopiert werden.

Beide Werte werden gebraucht: die Anwendung nutzt die gepoolte Verbindung,
`prisma migrate deploy` beim Build zwingend die direkte, weil Neons Pooler
im Transaction-Mode keine DDL-Anweisungen zulässt.

Alternativ ein Projekt direkt auf [neon.tech](https://neon.tech) anlegen
und beide Connection-Strings selbst hinterlegen (der direkte ist der ohne
`-pooler` im Hostnamen).

### 2. Google-Service-Account

1. Projekt in der [Google Cloud Console](https://console.cloud.google.com)
   anlegen, **Google Drive API** aktivieren.
2. Unter „IAM & Verwaltung" > „Dienstkonten" ein neues Dienstkonto anlegen,
   JSON-Schlüssel erzeugen und herunterladen.
3. Den EdgeChase-Ordner für die E-Mail-Adresse des Dienstkontos freigeben
   (`xyz@projekt.iam.gserviceaccount.com`), Rolle **Betrachter** genügt.
   Eine Freigabe auf dem Wurzelordner vererbt sich auf alle Unterordner.
4. Den kompletten Inhalt der heruntergeladenen JSON-Datei einzeilig als
   `GOOGLE_SERVICE_ACCOUNT_JSON` hinterlegen (z.B. `cat key.json | jq -c .`).

Das Dienstkonto wird **ausschliesslich zum Lesen** verwendet.

### 2b. OAuth für den Upload

Dienstkonten haben kein Speicherkontingent und können in Drive nichts
anlegen - jeder Upload scheitert mit „Service Accounts do not have storage
quota", auch in einem Ordner mit Bearbeiter-Freigabe. Nur Shared Drives
umgehen das, die es aber erst mit Google Workspace gibt. Der Upload läuft
deshalb per OAuth im Namen des Nutzers:

1. In der Cloud Console einen **OAuth-Client vom Typ „Desktop-App"** anlegen,
   Client-ID und -Schlüssel übernehmen.
2. Den **Zustimmungsbildschirm veröffentlichen** („In Produktion"). Im
   Testmodus macht Google das Refresh-Token nach sieben Tagen ungültig.
   Da nur `drive.file` angefordert wird - ein nicht sensibler Bereich -
   ist dafür kein Überprüfungsverfahren nötig.
3. Refresh-Token einmalig holen:
   ```bash
   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
     npx tsx scripts/oauth-url.ts            # Link öffnen, bestätigen
   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
     npx tsx scripts/oauth-url.ts <code>     # Code aus der Adresszeile
   ```

Den Zielordner legt die Anwendung selbst an (Name aus
`DRIVE_OUTPUT_FOLDER_NAME`, Standard „EdgeChase Promo-Videos"). Das ist
kein Komfort, sondern Notwendigkeit: mit `drive.file` sieht sie nur, was
sie selbst erzeugt hat - ein von Hand angelegter Ordner wäre unsichtbar
und der Upload dorthin schlüge fehl. Verschieben lässt er sich hinterher
beliebig.

### Ordnerstruktur des Rohmaterials

`DRIVE_SOURCE_FOLDER_ID` zeigt auf den **Wurzelordner**, nicht auf einen
einzelnen Clip-Ordner. Der Baum darunter wird rekursiv eingelesen, und der
Ordnername jedes Clips wird mitgespeichert. Bei der Zusammenstellung
bekommt Gemini diesen Namen als Themensignal mit, damit die Clips eines
Videos thematisch zusammenpassen (Parkour zu Parkour, Rooftop zu Rooftop)
statt wahllos gemischt zu werden.

Zwei Dinge werden dabei automatisch übersprungen:

- der Zielordner (sonst kämen fertige Videos als Rohmaterial zurück),
- die Ordner aus `DRIVE_EXCLUDED_FOLDER_NAMES`, standardmäßig
  „Referenz-Videos" (fremdes Material) und „Logos etc.".

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
- ✅ Remotion-Komposition rendert korrekt: Text-Overlay (mehrzeiliger
  Umbruch, weiß mit schwarzer Kontur, mittig, respektiert 84%-Breitengrenze)
  wurde als Standbild gegen hellen und dunklen Hintergrund geprüft
- ✅ **Schritt 1** an echten Daten: 571 Clips aus 20 Ordnern werden
  rekursiv gelistet (inkl. Ordnerzuordnung und Laufzeiten, ohne
  macOS-Schattendateien), eine Testdatei landet im selbst angelegten
  Zielordner und wird dort wiedergefunden (`scripts/verify-drive.ts`)
- ✅ **Schritt 2** an echten Daten: 25 Clips eines Quellordners analysiert,
  Beschreibungen benennen die Kleidungsstücke konkret (bis hin zum
  Schriftzug auf den Shirts), Ausschnitte beginnen nie am Dateianfang
  (`scripts/verify-analysis.ts`, `scripts/local-pipeline.ts analyze`)
- ✅ **Schritt 3** an echten Daten: fünf Durchläufe liefern unterschiedliche
  Clip-Kombinationen und Hook-Texte zwischen 62 und 70 Zeichen
  (`scripts/local-pipeline.ts compose`)
- ✅ **Schritt 4** an echten Daten: Remotion Lambda ist in `eu-central-1`
  ausgerollt, ein 10-Sekunden-Video rendert in 72 Sekunden und landet
  anschliessend in Drive (`scripts/local-pipeline.ts lambda`)
- ✅ **Schritt 5**: Upload mit Wiederholung und Duplikatschutz, mehrfach
  ausgeführt
- ⏳ **Schritt 6** steht aus: Die Kette ist bisher nur über die
  Zwischendatei von `local-pipeline.ts` gelaufen, nicht über die
  Datenbank. `composeVideo` und `processJob` sind geschrieben, aber noch
  nie gegen Neon ausgeführt worden - der Nachweis ist ein Klick auf
  "Jetzt Video erzeugen" im Dashboard.

### Stolpersteine, die beim Einrichten auftraten

Festgehalten, weil sie sich nicht aus dem Code erschliessen:

- **Dienstkonten können nichts in Drive anlegen** (kein Speicherkontingent).
  Deshalb der zweigleisige Zugriff: Dienstkonto liest, OAuth schreibt.
- **Frische AWS-Konten** haben ein sehr kleines Kontingent gleichzeitiger
  Lambda-Ausführungen und erlauben höchstens 3008 MB Speicher pro Funktion.
- **Signierte S3-URLs funktionieren in Remotion nicht** - der interne Proxy
  setzt die Abfrageparameter neu zusammen und bricht damit die Signatur.
- **Die Lambda-Festplatte muss gross sein** (10 GB), weil jeder Rohclip zum
  Auslesen einzelner Bilder komplett dorthin geladen wird.
- **Vercel muss das Projekt als Next.js kennen.** Enthielt das Repository
  beim Import eine statische Seite, sucht Vercel danach dauerhaft einen
  `public`-Ordner und bricht nach einem ansonsten erfolgreichen Build ab.

## Bekannte Kostenpunkte

Alles außer dem Rendern läuft im jeweiligen Gratistarif (Vercel Hobby, Neon
Free, Gemini Free Tier). Remotion Lambda wird pro Render abgerechnet -
Bruchteile von Cent für ein 15-Sekunden-Video.
