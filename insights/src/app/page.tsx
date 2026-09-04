/**
 * Die Uebersichtsseite.
 *
 * Kopfzeile: Umsatz (Wix), Reichweite gesamt (IG), Top-Sparte, Anzahl
 * Videos - alles im gewaehlten Zeitraum. Darunter die vier Sparten als
 * Kacheln, das Umsatz-Diagramm der letzten Tage und die besten Videos aus
 * allen Sparten zusammen.
 *
 * Alles wird SSR-gerendert - keine Client-Komponenten hier, weil sich der
 * Zustand ueber den Zeitraum-Query-Parameter aendert.
 */
import { Kopf } from "../components/Kopf";
import { SpartenNav } from "../components/SpartenNav";
import { Kachel } from "../components/Kachel";
import { BalkenDiagramm } from "../components/BalkenDiagramm";
import { Zeitraumleiste } from "../components/Zeitraumleiste";
import { anzahlJeSparte, gepostetImZeitraum } from "../lib/mapping";
import { kennzahlenViele } from "../lib/instagram";
import { umsatzLetzteTage } from "../lib/wix";
import { fasseSparteZusammen } from "../lib/aggregation";
import { alsGeld, alsZahl } from "../lib/format";
import { SPARTEN, type Track } from "../lib/tracks";

// Die Uebersicht laeuft immer serverseitig frisch - die Zwischenspeicherung
// steckt in `zwischengespeichert`, nicht in der Seite.
export const dynamic = "force-dynamic";

export default async function UebersichtSeite({
  searchParams,
}: {
  searchParams: { tage?: string };
}) {
  const tage = normalisiereTage(searchParams?.tage);
  const zeitraumTage = tage === 0 ? 3650 : tage; // "alle" praktisch = 10 Jahre

  const [zahlen, wix, ...proSparte] = await Promise.all([
    anzahlJeSparte(),
    umsatzLetzteTage(zeitraumTage),
    ...SPARTEN.map((s) =>
      ladeSparteMitKennzahlen(s.key, zeitraumTage),
    ),
  ]);

  const reichweiteGesamt = proSparte.reduce(
    (s, p) => s + p.zusammenfassung.summen.reichweite,
    0,
  );
  const aufrufeGesamt = proSparte.reduce(
    (s, p) => s + p.zusammenfassung.summen.aufrufe,
    0,
  );
  const videosGesamt = proSparte.reduce(
    (s, p) => s + p.zusammenfassung.summen.videos,
    0,
  );

  const topSparte = [...proSparte]
    .map((p) => ({ key: p.track, wert: p.zusammenfassung.summen.reichweite }))
    .sort((a, b) => b.wert - a.wert)[0];

  return (
    <>
      <Kopf />
      <Zeitraumleiste aktiv={tage} basisPfad="/" />

      <div className="kacheln">
        <Kachel
          label="Umsatz Wix"
          wert={
            wix.verbunden
              ? alsGeld(wix.umsatz, wix.waehrung)
              : "nicht verbunden"
          }
          neben={
            wix.verbunden
              ? `${wix.bestellungen} bezahlte Bestellungen`
              : "WIX_API_KEY/SITE_ID fehlen"
          }
        />
        <Kachel
          label="Reichweite gesamt"
          wert={alsZahl(reichweiteGesamt)}
          neben={`${videosGesamt} Reels im Zeitraum`}
        />
        <Kachel label="Aufrufe gesamt" wert={alsZahl(aufrufeGesamt)} />
        <Kachel
          label="Top-Sparte"
          wert={
            topSparte && topSparte.wert > 0
              ? SPARTEN.find((s) => s.key === topSparte.key)!.kurz
              : "–"
          }
          neben={
            topSparte && topSparte.wert > 0
              ? `${alsZahl(topSparte.wert)} Reichweite`
              : undefined
          }
        />
      </div>

      <h2 style={{ margin: "8px 0 12px", fontSize: 14 }}>Sparten</h2>
      <SpartenNav zahlen={zahlen} />

      {wix.verbunden ? (
        <div className="karte">
          <h2>
            Umsatzverlauf
            <span className="rand">
              (Wix, letzte {tage === 0 ? "10 Jahre" : `${tage} Tage`})
            </span>
          </h2>
          <BalkenDiagramm
            werte={wix.bestellungenNachTag.map((t) => t.umsatz)}
            labels={wix.bestellungenNachTag.map((t) => t.tag.slice(5))}
            farbe="var(--accent)"
            format={(n) => alsGeld(n, wix.waehrung)}
          />
          {wix.topArtikel.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                Bestverkaufte Artikel
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {wix.topArtikel.map((a) => (
                  <li
                    key={a.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 13,
                    }}
                  >
                    <span>
                      {a.name}{" "}
                      <span style={{ color: "var(--muted)" }}>({a.menge}×)</span>
                    </span>
                    <b>{alsGeld(a.umsatz, wix.waehrung)}</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="karte">
          <h2>Umsatz Wix</h2>
          <div className="leerzustand">
            Wix ist noch nicht verbunden. Setze in den Umgebungsvariablen
            WIX_API_KEY, WIX_SITE_ID und WIX_ACCOUNT_ID, damit Bestellungen
            und Umsatz erscheinen.
          </div>
        </div>
      )}

      <div className="karte">
        <h2>
          Sparten im Vergleich
          <span className="rand">(Reichweite)</span>
        </h2>
        <BalkenDiagramm
          werte={proSparte.map((p) => p.zusammenfassung.summen.reichweite)}
          labels={proSparte.map((p) => sparteKurz(p.track))}
          farbe="var(--accent)"
          format={(n) => alsZahl(n)}
        />
      </div>
    </>
  );
}

async function ladeSparteMitKennzahlen(track: Track, tage: number) {
  const videos = await gepostetImZeitraum(track, tage);
  const kennzahlen = await kennzahlenViele(
    track,
    videos.map((v) => v.mediaId),
  );
  const karte = new Map(kennzahlen.map((k) => [k.mediaId, k]));
  return { track, videos, zusammenfassung: fasseSparteZusammen(videos, karte) };
}

function sparteKurz(t: Track): string {
  return SPARTEN.find((s) => s.key === t)!.kurz;
}

function normalisiereTage(v: string | undefined): number {
  const n = Number(v);
  if ([7, 30, 90, 0].includes(n)) return n;
  return 30;
}
