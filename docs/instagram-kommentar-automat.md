# Instagram-Kommentar-Automat einrichten

Reagiert auf Kommentare unter „kommentiere deinen Namen"-Reels: legt einen
Wix-Gutschein mit dem Namen an, schickt ihn per DM und antwortet öffentlich
unter dem Kommentar. Ausgelöst wird das von einem Meta-Webhook, nicht von
einem Zeitplan — zwischen Kommentar und Code vergehen dadurch Sekunden.

Der Code ist fertig und ausgerollt. Was hier steht, sind die Schritte, die
sich nur ausserhalb des Repos erledigen lassen: Zugangsdaten beschaffen und
den Webhook bei Meta anmelden.

Reihenfolge einhalten — Schritt 4 braucht die Adresse aus Schritt 3, und der
Webhook lässt sich erst anmelden, wenn die Anwendung schon läuft.

---

## 1. Wix-API-Key anlegen

Nur Account-Inhaber und Mitinhaber dürfen das.

1. [manage.wix.com](https://manage.wix.com) → Account-Einstellungen → **API-Keys**
2. **Neuen Key erstellen**, Name z. B. `EdgeChase Kommentar-Automat`
3. Berechtigungen: die Gutschein-Verwaltung von Wix Stores
   (Coupons — verwalten). Nicht mehr als nötig.
4. Site-Zugriff: nur **EdgeChase** auswählen, nicht „alle Sites"
5. Key kopieren — er wird **nur einmal angezeigt**

Der Key läuft nicht ab. Er muss nur erneuert werden, wenn er zurückgezogen
wird.

## 2. Instagram-Zugangsdaten aus der Meta-App holen

Es ist dieselbe Meta-App, die schon hinter dem bestehenden MCP-Server steckt —
eine neue wird nicht gebraucht.

1. [developers.facebook.com](https://developers.facebook.com) → deine App
2. **Einstellungen → Grundeinstellungen** → *App-Geheimnis* anzeigen und
   kopieren → das ist `IG_APP_SECRET`
3. Ein Zugriffstoken des EdgeChase-Kontos mit den Berechtigungen für
   Kommentare und Nachrichten → das ist `IG_ACCESS_TOKEN`

   Falls du das bestehende Token des MCP-Servers wiederverwendest: es
   funktioniert, aber die beiden hängen dann aneinander. Wird dort etwas neu
   verbunden, steht auch der Automat still. Ein eigenes Token ist sauberer.
4. Ein Prüfwort für den Webhook frei ausdenken (irgendeine zufällige
   Zeichenfolge) → das ist `IG_WEBHOOK_VERIFY_TOKEN`. Es wird nur einmal beim
   Anmelden gebraucht und muss auf beiden Seiten identisch sein.

## 3. Variablen in Vercel eintragen

Vercel → Projekt `EdgeChase_Frontend` → **Settings → Environment Variables**.
Alle für *Production*:

| Variable | Woher |
|---|---|
| `IG_ACCESS_TOKEN` | Schritt 2.3 |
| `IG_APP_SECRET` | Schritt 2.2 |
| `IG_WEBHOOK_VERIFY_TOKEN` | Schritt 2.4, frei gewählt |
| `WIX_API_KEY` | Schritt 1 |

Bereits vorhanden und unverändert: `GEMINI_API_KEY`, `CRON_SECRET`,
`DATABASE_URL`.

Nicht nötig, solange es beim EdgeChase-Konto und der EdgeChase-Site bleibt:
`IG_USER_ID` und `WIX_SITE_ID` stehen als Vorgabe im Code.

Danach **neu ausrollen** (Deployments → … → Redeploy). Der Build legt dabei
auch die neue Datenbanktabelle an.

## 4. Prüfen, bevor ein echter Kommentar kommt

Es gibt eine Route, die jedes Teilstück einzeln anfasst, ohne dass etwas
verschickt wird: kein Gutschein, keine DM, keine Antwort. `<SECRET>` ist dein
`CRON_SECRET`.

```
https://<deine-domain>/api/instagram/test?secret=<SECRET>&pruefe=env
```
Zeigt, welche Zugangsdaten angekommen sind (nur ob, nie welche). Alles auf
`true`, bevor es weitergeht.

```
…&pruefe=wix
```
Liest den Gutschein-Bestand und schlägt einen freien Code vor. Kommt hier eine
Antwort, stimmen Key, Site und Berechtigung. Angelegt wird nichts.

```
…&pruefe=caption&mediaId=<ID eines Reels>
```
Sagt, ob das Reel als Aktions-Reel erkannt wird und in welcher Sprache
geantwortet würde. Beweist nebenbei, dass das Instagram-Token trägt.

```
…&pruefe=antwort&name=Lars&sprache=de
```
Erzeugt dreimal eine Antwort, damit du beurteilen kannst, ob sie
unterschiedlich genug klingen. Nichts davon wird gepostet.

Bei jedem Aufruf kommt entweder das Ergebnis oder die Fehlermeldung von Wix
bzw. Meta im Klartext zurück — daran lässt sich ablesen, woran es hakt.

## 5. Webhook bei Meta anmelden

Erst jetzt, wenn Schritt 4 sauber durchläuft.

1. Meta-App → **Webhooks** → Instagram
2. **Callback-URL**: `https://<deine-domain>/api/instagram/webhook`
3. **Verify Token**: das Prüfwort aus Schritt 2.4
4. **Bestätigen und speichern** — Meta ruft die Adresse einmal auf und erwartet
   das Prüfwort zurück. Schlägt das fehl, stimmt entweder die Adresse nicht
   oder das Prüfwort weicht ab.
5. Beim Feld **`comments`** auf **Abonnieren** klicken

Die App muss im Live-Modus sein und die Berechtigungen für Kommentare und
Nachrichten haben — beides ist bereits der Fall, sonst hätten die bisherigen
DMs nicht funktioniert.

## 6. Scharfer Test

Mit einem Zweitkonto unter einem Aktions-Reel einen Vornamen kommentieren.
Innerhalb weniger Sekunden sollten Gutschein, DM und öffentliche Antwort da
sein.

Kommt nichts:

- **Meta-App → Webhooks → Recent Deliveries** zeigt, ob Meta überhaupt
  ausgeliefert hat und mit welchem Statuscode.
  - `403` heisst: Signatur abgelehnt → `IG_APP_SECRET` stimmt nicht.
  - `500` heisst: die Datenbank war nicht erreichbar → Meta versucht es
    erneut.
  - `200` heisst: angenommen, der Fehler liegt dahinter.
- **Vercel → Logs**, gefiltert auf `/api/instagram/`.
- In der Datenbank steht in `InstagramComment` zu jedem Kommentar der Status
  und im Feld `hinweis` der Grund. „Das Reel ruft nicht zur Namens-Aktion
  auf" heisst zum Beispiel, dass die Bildunterschrift nicht als Aktion erkannt
  wurde — das lässt sich mit `?pruefe=caption` nachstellen.
- Liegengebliebenes lässt sich jederzeit nachholen:
  `POST /api/instagram/process` mit der Kopfzeile `x-api-key: <CRON_SECRET>`.

## 7. Alte Routine abschalten

Sobald der Webhook läuft, sind die beiden täglichen Routinen
„EdgeChase Rabatt-Code Workflow" überflüssig — und würden dieselben Kommentare
ein zweites Mal anfassen. In der claude.ai-Routines-Übersicht **beide**
löschen (es sind Duplikate).

Die Doppelsperre im Automaten schützt nur vor doppelten Webhooks, nicht vor
einer zweiten Stelle, die dieselbe Arbeit über einen anderen Weg macht.

---

## Was der Automat entscheidet

Übersprungen wird ein Kommentar, wenn:

- er vom eigenen Konto stammt (sonst antwortet die Anwendung sich selbst,
  endlos)
- er eine Antwort innerhalb eines Threads ist (ein „ok cool" unter unserer
  Antwort ist kein Namensruf)
- die Bildunterschrift des Reels nicht nach einem Namen für einen Code fragt
- kein Name erkennbar ist — weder im Kommentar noch im Handle

Die Namenserkennung nimmt nur das erste Wort und nur, wenn es nicht auf der
Sperrliste steht. Sie ist absichtlich streng: ein übersprungener Kommentar
kostet eine Nachfrage, ein falsch erkannter schickt einer fremden Person einen
Gutschein auf „Video". Die Fälle stehen in `scripts/pruefe-instagram-namen.ts`
und lassen sich mit `npm run instagram:pruefe` jederzeit nachrechnen.

Konditionen (15 %, eine Woche, einmal einlösbar, Schlagwort „Instagram")
stehen an einer Stelle: `GUTSCHEIN` in `src/lib/instagram/verarbeitung.ts`.

## Was der Automat nicht kann

Er kann nicht feststellen, ob ein Profil privat ist — diese Angabe gibt Meta
über keine Schnittstelle heraus. Die DM wird deshalb immer versucht. Bei
privaten Konten nimmt Meta sie an (die API meldet Erfolg), stellt sie aber in
die Nachrichtenanfragen, wo sie ohne Benachrichtigung liegen bleibt. Genau
deshalb weist die öffentliche Antwort jedes Mal darauf hin, dass man uns bei
privatem Profil zuerst selbst anschreiben soll.

Geht die DM gar nicht erst raus, wird die öffentliche Antwort umformuliert und
bittet nur noch um die erste Nachricht — sie behauptet dann nicht, es liege
etwas im Postfach.
