# Instagram Video Webhook → KI-Analyse

Eigenständiges **Vercel-Projekt** (Next.js App Router), das per **Instagram-Messaging-Webhook**
registriert, wenn der Account **`edgechase.official`** ein **Video als DM** an deinen Account sendet,
und das Video anschließend **automatisch per KI analysiert** (Claude + extrahierte Keyframes + Audio-Transkript).
Das Ergebnis wird geloggt und in **Vercel KV** gespeichert (per API abrufbar).

Dies ist ein **neues, separates** Projekt neben deinen bestehenden Vercel-MCP-Servern. Es liegt im
Unterordner `instagram-video-webhook/` und wird in Vercel als eigenes Projekt mit
**Root Directory = `instagram-video-webhook`** deployt.

---

## Ablauf

```
Instagram DM (Video von @edgechase.official)
        │  Meta Webhook (Feld "messages")
        ▼
POST /api/instagram/webhook
   1. Signatur prüfen (X-Hub-Signature-256, HMAC mit META_APP_SECRET)
   2. Video-Attachment filtern
   3. Absender-IGSID → @username via Graph API → mit ALLOWED_SENDER_USERNAME abgleichen
   4. Dedupe (Meta-Retries) → sofort 200 OK
   5. waitUntil → POST /api/process (intern, per Secret geschützt)
        ▼
POST /api/process
   Download → ffmpeg (Keyframes + Audio) → Whisper-Transkript → Claude (Vision+Text) → Vercel KV
        ▼
GET /api/analyses            (Liste)
GET /api/analyses/<mid>      (Einzelergebnis)
```

> **Warum löst der Webhook den Absender direkt über die Graph API auf und nicht über den MCP?**
> MCP-Tools laufen nur in einer Claude-Session, nicht in einer Serverless-Function. Der Webhook nutzt
> daher denselben Instagram-Access-Token wie dein MCP direkt gegen die Graph API. Den MCP kannst du
> für Setup/Test verwenden (z.B. `list_conversations`, um die Konversation mit `edgechase.official`
> zu bestätigen).

---

## Setup

### 1. Abhängigkeiten & lokaler Build

```bash
cd instagram-video-webhook
npm install
npm run build
```

### 2. Meta-App / Instagram konfigurieren

1. Meta-App mit Produkt **Instagram** (Messaging) — dieselbe App, deren Access-Token dein MCP nutzt.
2. Erforderliche Berechtigungen: `instagram_business_manage_messages` (bzw. `instagram_manage_messages`).
3. **Webhooks** → Instagram → Feld **`messages`** abonnieren.
4. Callback-URL: `https://<deine-vercel-domain>/api/instagram/webhook`
5. Verify-Token: identisch zu `IG_WEBHOOK_VERIFY_TOKEN`.

Meta ruft zur Verifikation `GET .../api/instagram/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`
auf; der Endpoint gibt die Challenge zurück, wenn der Token stimmt.

### 3. Vercel-Projekt anlegen

1. Neues Vercel-Projekt aus diesem Repo, **Root Directory = `instagram-video-webhook`**.
2. **Storage** binden: Storage → Marketplace → **Upstash Redis** an das Projekt hängen. Dabei werden
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (bzw. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)
   automatisch gesetzt. (Der frühere „Vercel KV"-Store ist deprecated; das Projekt nutzt `@upstash/redis`,
   das mit beiden Env-Namen funktioniert.)
3. **Pro-Plan empfohlen**: `/api/process` braucht bis zu 300 s (`maxDuration`); auf Hobby ist die
   Laufzeit begrenzt und lange Videos können abbrechen.
4. Environment-Variablen setzen (siehe unten).

### 4. Environment-Variablen

Siehe [`.env.example`](./.env.example). Wichtig:

| Variable | Zweck |
|---|---|
| `META_APP_SECRET` | Signaturprüfung des Webhook-Payloads |
| `IG_WEBHOOK_VERIFY_TOKEN` | Verify-Token (identisch in Meta-Konfiguration) |
| `IG_ACCESS_TOKEN` | Langlebiger Instagram-Token (wie MCP) |
| `IG_GRAPH_BASE` | `https://graph.instagram.com/v21.0` (Default) |
| `ALLOWED_SENDER_USERNAME` | `edgechase.official` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude-Analyse (Default `claude-opus-4-8`) |
| `OPENAI_API_KEY` | Whisper-Transkription (optional, siehe unten) |
| `INTERNAL_TASK_SECRET` | Schutz der internen `/api/process`-Route |
| `FRAME_COUNT` | Anzahl extrahierter Keyframes (Default 6) |
| `READ_API_TOKEN` | (optional) schützt `GET /api/analyses` |

**Transkription optional:** Ohne `OPENAI_API_KEY` (oder mit `TRANSCRIPTION_ENABLED=false`) läuft die
Analyse nur auf Basis der Keyframes weiter. Für einen anderen OpenAI-kompatiblen Anbieter
(z.B. Groq `whisper-large-v3`) `OPENAI_BASE_URL` + `TRANSCRIPTION_MODEL` setzen.

---

## Lokal testen

```bash
cp .env.example .env.local   # Werte eintragen
npm run dev
```

**Webhook-Verifikation:**

```bash
curl "http://localhost:3000/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=DEIN_TOKEN&hub.challenge=12345"
# → 12345
```

**Signiertes POST-Event simulieren** (Video-Attachment von einem IGSID, der zu `edgechase.official`
auflöst — Lookup erfordert gültigen `IG_ACCESS_TOKEN` und eine bestehende Konversation):

```bash
BODY='{"object":"instagram","entry":[{"id":"IG_ACCOUNT_ID","time":1700000000,"messaging":[{"sender":{"id":"SENDER_IGSID"},"recipient":{"id":"IG_ACCOUNT_ID"},"timestamp":1700000000,"message":{"mid":"test-mid-1","attachments":[{"type":"video","payload":{"url":"https://.../video.mp4"}}]}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | awk '{print $2}')"
curl -X POST http://localhost:3000/api/instagram/webhook \
  -H "content-type: application/json" \
  -H "x-hub-signature-256: $SIG" \
  --data "$BODY"
```

**Ergebnis abrufen:**

```bash
curl http://localhost:3000/api/analyses
curl http://localhost:3000/api/analyses/test-mid-1
```

---

## Projektstruktur

```
instagram-video-webhook/
├─ app/
│  ├─ api/
│  │  ├─ instagram/webhook/route.ts  # GET-Verifikation + POST-Empfang/Filter/ACK
│  │  ├─ process/route.ts            # interne Analyse (ffmpeg→Whisper→Claude→KV)
│  │  └─ analyses/route.ts           # Liste
│  │  └─ analyses/[id]/route.ts      # Einzelergebnis
│  ├─ layout.tsx / page.tsx          # Status-Landingpage
├─ lib/
│  ├─ signature.ts   # HMAC-Signaturprüfung
│  ├─ instagram.ts   # IGSID→Username (Graph API, KV-Cache)
│  ├─ video.ts       # Download + ffmpeg (Keyframes + Audio)
│  ├─ transcribe.ts  # Audio→Text (Whisper)
│  ├─ analyze.ts     # Frames+Transkript → Claude
│  ├─ redis.ts       # Upstash-Redis-Client
│  ├─ store.ts       # Records, Index, Dedupe (Upstash Redis)
│  └─ types.ts
├─ next.config.js    # ffmpeg-Binary ins Function-Bundle tracen
├─ vercel.json       # maxDuration/memory für /api/process
└─ .env.example
```

## Hinweise

- **ffmpeg** wird über das npm-Paket `ffmpeg-static` mitgeliefert (kein Systempaket nötig);
  `next.config.js` sorgt dafür, dass die Binary ins Serverless-Bundle kommt.
- **Dedupe** verhindert doppelte Analysen bei Meta-Webhook-Retries (KV `SET NX`, TTL 24 h).
- Es werden **nur Videos** von **genau** `ALLOWED_SENDER_USERNAME` verarbeitet; alles andere wird
  quittiert und verworfen.
