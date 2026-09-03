import { prisma } from "@/lib/db";
import { EIGENES_KONTO_HINWEIS, GUTSCHEIN, istEffektivAktion } from "@/lib/instagram/verarbeitung";
import { Schalter } from "./Schalter";
import { Uebersteuerung } from "./Uebersteuerung";

/**
 * Die Übersichtsseite des Kommentar-Automaten.
 *
 * Sie ist der Grund, warum der Automat nicht unbeobachtet irgendwo läuft:
 * hier steht, welches Reel wie viele Kommentare bekommen hat, welcher Code an
 * wen ging, ob DM und Antwort ankamen - und was übersprungen wurde und warum.
 * Der Aus-Schalter sitzt bewusst ganz oben.
 */
export const dynamic = "force-dynamic";

/** So weit zurück reicht die Tagesauswertung. */
const TAGE = 14;

function tagesschluessel(datum: Date): string {
  return datum.toISOString().slice(0, 10);
}

function datumLesbar(schluessel: string): string {
  const [jahr, monat, tag] = schluessel.split("-");
  return `${tag}.${monat}.${jahr.slice(2)}`;
}

function zeitLesbar(datum: Date): string {
  return datum.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function StartSeite() {
  const seit = new Date(Date.now() - TAGE * 24 * 60 * 60 * 1000);

  const [config, zeilen, medien, wartend, gesamtCodes] = await Promise.all([
    prisma.instagramConfig.findUnique({ where: { id: "default" } }),
    // Die Menge ist überschaubar - ein paar Kommentare je Reel -, deshalb
    // wird im Speicher ausgewertet statt mit mehreren Aggregat-Abfragen.
    prisma.instagramComment.findMany({
      where: { createdAt: { gte: seit } },
      orderBy: { createdAt: "desc" },
    }),
    // Alle bekannten Reels, nicht nur die automatisch erkannten - sonst liesse
    // sich eine fälschlich übergangene Aktion nirgends von Hand nachtragen.
    prisma.instagramMedia.findMany({ orderBy: { aktualisiertAm: "desc" } }),
    prisma.instagramComment.count({ where: { status: "empfangen" } }),
    prisma.instagramComment.count({ where: { couponCode: { not: null } } }),
  ]);

  const verarbeitet = zeilen.filter((z) => z.status === "verarbeitet");
  const heute = tagesschluessel(new Date());
  const heutige = zeilen.filter((z) => tagesschluessel(z.createdAt) === heute);
  const fehlerhafte = zeilen.filter((z) => z.status === "fehler");

  // Wie lange zwischen Eingang und Erledigung vergeht. Das ist die Zahl, um
  // die es bei der ganzen Umstellung ging - vorher war es bis zu ein Tag.
  const dauern = verarbeitet
    .map((z) => (z.updatedAt.getTime() - z.createdAt.getTime()) / 1000)
    .filter((s) => s >= 0 && s < 3600)
    .sort((a, b) => a - b);
  const mittlereDauer = dauern.length ? dauern[Math.floor(dauern.length / 2)] : null;

  const dmQuote = verarbeitet.length
    ? Math.round((verarbeitet.filter((z) => z.dmGesendet).length / verarbeitet.length) * 100)
    : null;

  // Tage absteigend, aber nur solche mit Kommentaren - leere Zeilen sagen
  // nichts und blähen die Tabelle auf.
  const proTag = new Map<string, typeof zeilen>();
  for (const zeile of zeilen) {
    const schluessel = tagesschluessel(zeile.createdAt);
    proTag.set(schluessel, [...(proTag.get(schluessel) ?? []), zeile]);
  }

  // Für den Verlauf zählen auch die leeren Tage - eine Lücke ist die
  // Information, dass an dem Tag nichts kam, und nicht das Fehlen des Tages.
  const verlauf = Array.from({ length: TAGE }, (_, i) => {
    const datum = new Date(Date.now() - (TAGE - 1 - i) * 24 * 60 * 60 * 1000);
    const schluessel = tagesschluessel(datum);
    return { schluessel, anzahl: proTag.get(schluessel)?.length ?? 0 };
  });
  const hoechstwert = Math.max(...verlauf.map((t) => t.anzahl), 1);

  const proReel = new Map<string, typeof zeilen>();
  for (const zeile of zeilen) {
    proReel.set(zeile.mediaId, [...(proReel.get(zeile.mediaId) ?? []), zeile]);
  }

  // Übersteuerung geht vor Texterkennung - dieselbe Regel wie beim
  // Verarbeiten selbst (istEffektivAktion in verarbeitung.ts), sonst würde
  // die Übersicht etwas anderes zeigen als das, wonach tatsächlich
  // entschieden wird.
  const aktiveMedien = medien.filter(istEffektivAktion);
  // Nur die zuletzt gesehenen, sonst wächst diese Liste mit jedem
  // durchlaufenden Reel unbegrenzt - und ein Reel von vor Wochen von Hand
  // nachzutragen ist selten eilig.
  const andereMedien = medien.filter((m) => !istEffektivAktion(m)).slice(0, 15);

  // Antworten auf die eigenen Kommentare sind kein Vorgang, den es sich
  // anzusehen lohnt - sie entstehen bei jedem Lauf von selbst und würden die
  // Tabelle nur mit sich wiederholenden Zeilen zumüllen. Die Gesamtzahl bleibt
  // trotzdem sichtbar, in "Warum übersprungen wurde" weiter unten.
  const sichtbareZeilen = zeilen.filter((z) => z.hinweis !== EIGENES_KONTO_HINWEIS);

  const uebersprungen = zeilen.filter((z) => z.status === "uebersprungen");
  const gruende = new Map<string, number>();
  for (const zeile of uebersprungen) {
    const grund = zeile.hinweis ?? "Ohne Angabe";
    gruende.set(grund, (gruende.get(grund) ?? 0) + 1);
  }

  return (
    <main>
      <h1>Instagram-Kommentar-Automat</h1>
      <p className="subtitle">
        Kommentiert jemand seinen Namen unter einem Aktions-Reel, entsteht ein Gutschein über{" "}
        {GUTSCHEIN.prozent}% ({GUTSCHEIN.gueltigTage} Tage, einmal einlösbar), geht per DM raus und
        wird öffentlich beantwortet. Ausgelöst von Instagram selbst, nicht von einem Zeitplan.
      </p>

      <Schalter start={config?.enabled ?? true} wartend={wartend} />

      {fehlerhafte.length > 0 && (
        <div className="ig-fehlerkasten">
          <strong>
            {fehlerhafte.length} {fehlerhafte.length === 1 ? "Kommentar" : "Kommentare"} mit Fehler
          </strong>
          <ul>
            {fehlerhafte.slice(0, 5).map((z) => (
              <li key={z.id}>
                {z.text.slice(0, 40)} — {z.hinweis?.slice(0, 160)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="value">{heutige.length}</div>
          <div className="label">Kommentare heute</div>
        </div>
        <div className="stat-card">
          <div className="value">{verarbeitet.length}</div>
          <div className="label">Codes in {TAGE} Tagen</div>
        </div>
        <div className="stat-card">
          <div className="value">{dmQuote === null ? "–" : `${dmQuote}%`}</div>
          <div className="label">DM angenommen</div>
        </div>
        <div className="stat-card">
          <div className="value">
            {mittlereDauer === null ? "–" : `${Math.round(mittlereDauer)}s`}
          </div>
          <div className="label">Bis erledigt (Median)</div>
        </div>
        <div className="stat-card">
          <div className="value">{gesamtCodes}</div>
          <div className="label">Codes insgesamt</div>
        </div>
      </div>

      <h2 className="abschnitt-titel">Verlauf</h2>
      <div className="ig-verlauf">
        {verlauf.map(({ schluessel, anzahl }) => (
          <div className="ig-balken" key={schluessel} title={`${datumLesbar(schluessel)}: ${anzahl}`}>
            <div
              className="ig-balken-fuellung"
              style={{ height: `${hoechstwert ? (anzahl / hoechstwert) * 100 : 0}%` }}
            />
            <div className="ig-balken-tag">{schluessel.slice(8)}</div>
          </div>
        ))}
      </div>

      <h2 className="abschnitt-titel">Pro Tag</h2>
      {proTag.size === 0 ? (
        <p className="empty-state">Noch keine Kommentare eingegangen.</p>
      ) : (
        <table className="ig-tabelle">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Kommentare</th>
              <th>Codes</th>
              <th>DMs</th>
              <th>Antworten</th>
              <th>Übersprungen</th>
            </tr>
          </thead>
          <tbody>
            {[...proTag.entries()]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([tag, eintraege]) => (
                <tr key={tag}>
                  <td>{datumLesbar(tag)}</td>
                  <td>{eintraege.length}</td>
                  <td>{eintraege.filter((z) => z.couponCode).length}</td>
                  <td>{eintraege.filter((z) => z.dmGesendet).length}</td>
                  <td>{eintraege.filter((z) => z.antwortGesendet).length}</td>
                  <td className="ig-schwach">
                    {eintraege.filter((z) => z.status === "uebersprungen").length}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <h2 className="abschnitt-titel">Aktions-Reels</h2>
      {aktiveMedien.length === 0 ? (
        <p className="empty-state">
          Noch kein Reel als Aktions-Reel erkannt. Das passiert beim ersten Kommentar darunter.
        </p>
      ) : (
        <div className="ig-reels">
          {aktiveMedien
            .map((media) => ({ media, eintraege: proReel.get(media.id) ?? [] }))
            .sort((a, b) => b.eintraege.length - a.eintraege.length)
            .map(({ media, eintraege }) => (
              <div className="ig-reel" key={media.id}>
                <div className="ig-reel-kopf">
                  <span className="tag">{media.sprache.toUpperCase()}</span>
                  {media.permalink ? (
                    <a href={media.permalink} target="_blank" rel="noreferrer">
                      Reel öffnen ↗
                    </a>
                  ) : (
                    <span className="ig-schwach">{media.id}</span>
                  )}
                </div>
                <div className="ig-reel-caption">{media.caption.split("\n")[0].slice(0, 120)}</div>
                <div className="ig-schwach">
                  {eintraege.length} Kommentare · {eintraege.filter((z) => z.couponCode).length}{" "}
                  Codes · {eintraege.filter((z) => z.dmGesendet).length} DMs
                </div>
                <Uebersteuerung
                  mediaId={media.id}
                  ueberschreibung={media.ueberschreibung}
                  automatischErkannt={media.istAktion}
                />
              </div>
            ))}
        </div>
      )}

      {andereMedien.length > 0 && (
        <>
          <h2 className="abschnitt-titel">Andere zuletzt gesehene Reels</h2>
          <p className="subtitle">
            Diese Reels wurden nicht als Aktions-Reel erkannt. Gehört eines doch dazu, lässt es sich
            hier von Hand nachtragen.
          </p>
          <div className="ig-reels">
            {andereMedien.map((media) => (
              <div className="ig-reel" key={media.id}>
                <div className="ig-reel-kopf">
                  <span className="tag">{media.sprache.toUpperCase()}</span>
                  {media.permalink ? (
                    <a href={media.permalink} target="_blank" rel="noreferrer">
                      Reel öffnen ↗
                    </a>
                  ) : (
                    <span className="ig-schwach">{media.id}</span>
                  )}
                </div>
                <div className="ig-reel-caption">{media.caption.split("\n")[0].slice(0, 120)}</div>
                <Uebersteuerung
                  mediaId={media.id}
                  ueberschreibung={media.ueberschreibung}
                  automatischErkannt={media.istAktion}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="abschnitt-titel">Letzte Kommentare</h2>
      {sichtbareZeilen.length === 0 ? (
        <p className="empty-state">Nichts vorhanden.</p>
      ) : (
        <table className="ig-tabelle">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Kommentar</th>
              <th>Name</th>
              <th>Code</th>
              <th>DM</th>
              <th>Antwort</th>
            </tr>
          </thead>
          <tbody>
            {sichtbareZeilen.slice(0, 40).map((zeile) => (
              <tr key={zeile.id} className={zeile.status === "fehler" ? "ig-zeile-fehler" : ""}>
                <td className="ig-schwach">{zeitLesbar(zeile.createdAt)}</td>
                <td>
                  {zeile.text.slice(0, 30) || "—"}
                  {zeile.authorUsername && (
                    <div className="ig-schwach">@{zeile.authorUsername}</div>
                  )}
                  {zeile.status !== "verarbeitet" && zeile.hinweis && (
                    <div className="ig-schwach">{zeile.hinweis.slice(0, 90)}</div>
                  )}
                </td>
                <td>{zeile.name ?? "—"}</td>
                <td>{zeile.couponCode ? <code>{zeile.couponCode}</code> : "—"}</td>
                <td>{zeile.couponCode ? (zeile.dmGesendet ? "✓" : "✗") : "—"}</td>
                <td>{zeile.couponCode ? (zeile.antwortGesendet ? "✓" : "✗") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {gruende.size > 0 && (
        <>
          <h2 className="abschnitt-titel">Warum übersprungen wurde</h2>
          <ul className="ig-gruende">
            {[...gruende.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([grund, anzahl]) => (
                <li key={grund}>
                  <strong>{anzahl}×</strong> {grund}
                </li>
              ))}
          </ul>
        </>
      )}
    </main>
  );
}
