/**
 * Detailseite einer Sparte.
 *
 * Aufbau:
 *   - Kopfzeile mit Sparte-Name und Zeitraum-Umschalter
 *   - Vier Kennzahl-Kacheln (Reichweite, Aufrufe, Engagement-Rate,
 *     Kommentare)
 *   - Verlauf der Reichweite je Tag (Balken)
 *   - Rangliste der besten Reels
 *   - Liste der letzten Reels
 *   - Nur fuer "promo": Funnel-Bereich (Kommentare → Codes → Umsatz)
 */
import { notFound } from "next/navigation";
import { Kopf } from "../../../components/Kopf";
import { Kachel } from "../../../components/Kachel";
import { BalkenDiagramm } from "../../../components/BalkenDiagramm";
import { Rangliste } from "../../../components/Rangliste";
import { VideoListe } from "../../../components/VideoListe";
import { Zeitraumleiste } from "../../../components/Zeitraumleiste";
import { gepostetImZeitraum } from "../../../lib/mapping";
import { kennzahlenViele, kommentareFuer } from "../../../lib/instagram";
import { fasseSparteZusammen } from "../../../lib/aggregation";
import { alsProzent, alsZahl, alsGeld } from "../../../lib/format";
import { istTrack, sparte, type Track } from "../../../lib/tracks";
import { bestellungenSeit, wixZugang } from "../../../lib/wix";
import { codeUmsatzKarte, funnelFuerVideo } from "../../../lib/funnel";
import { codesFuerMedia } from "../../../lib/couponGenerator";

export const dynamic = "force-dynamic";

export default async function SparteSeite({
  params,
  searchParams,
}: {
  params: { track: string };
  searchParams: { tage?: string };
}) {
  if (!istTrack(params.track)) notFound();
  const track: Track = params.track;
  const s = sparte(track);
  const tage = normalisiereTage(searchParams?.tage);
  const zeitraumTage = tage === 0 ? 3650 : tage;

  const videos = await gepostetImZeitraum(track, zeitraumTage);
  const kennzahlen = await kennzahlenViele(
    track,
    videos.map((v) => v.mediaId),
  );
  const karte = new Map(kennzahlen.map((k) => [k.mediaId, k]));
  const zus = fasseSparteZusammen(videos, karte);

  return (
    <main
      style={{ ["--sparte" as string]: s.farbeHex } as React.CSSProperties}
    >
      <Kopf titel={s.label} unter={s.untertitel} />
      <div style={{ marginBottom: 16 }}>
        <a
          href="/"
          style={{ color: "var(--muted)", fontSize: 13 }}
        >
          ← Uebersicht
        </a>
      </div>
      <Zeitraumleiste aktiv={tage} basisPfad={`/sparte/${track}`} />

      <div className="kacheln">
        <Kachel
          label="Reichweite"
          wert={alsZahl(zus.summen.reichweite)}
          neben={`${zus.summen.videos} Reels, ${zus.summen.mitDaten} mit Daten`}
          akzent
        />
        <Kachel
          label="Aufrufe"
          wert={alsZahl(zus.summen.aufrufe)}
          neben={`ø ${alsZahl(zus.mittel.aufrufe)}`}
        />
        <Kachel
          label="Engagement-Rate"
          wert={alsProzent(zus.mittel.engagementRate)}
          neben={`${alsZahl(zus.summen.likes)} L · ${alsZahl(zus.summen.kommentare)} K`}
        />
        <Kachel
          label="Shares / Saves"
          wert={`${alsZahl(zus.summen.shares)} · ${alsZahl(zus.summen.saves)}`}
        />
      </div>

      <div className="karte">
        <h2>
          Reichweite je Tag
          <span className="rand">
            ({tage === 0 ? "gesamter Zeitraum" : `letzte ${tage} Tage`})
          </span>
        </h2>
        <BalkenDiagramm
          werte={zus.verlauf.map((v) => v.reichweite)}
          labels={zus.verlauf.map((v) => v.tag.slice(5))}
          farbe={s.farbeHex}
          format={(n) => alsZahl(n)}
        />
      </div>

      <div className="karte">
        <h2>Beste Reels nach Engagement</h2>
        <Rangliste top={zus.top} />
      </div>

      <div className="karte">
        <h2>Letzte Reels</h2>
        <VideoListe videos={videos.slice(0, 20)} kennzahlen={karte} />
      </div>

      {track === "promo" ? (
        <PromoFunnelBereich videos={videos.slice(0, 20)} kennzahlen={karte} />
      ) : null}
    </main>
  );
}

/**
 * Der Promo-Funnel-Bereich: je Video eine Zeile mit Kommentare → Codes →
 * eingeloest → Umsatz. Nicht messbare Ebenen zeigen einen Hinweis, nicht 0.
 */
async function PromoFunnelBereich({
  videos,
  kennzahlen,
}: {
  videos: Array<import("../../../lib/mapping").GepostetesVideo>;
  kennzahlen: Map<string, import("../../../lib/instagram").MediaKennzahlen>;
}) {
  const wixVerbunden = wixZugang() !== null;
  const [codesJeMedia, bestellungen] = await Promise.all([
    Promise.all(videos.map((v) => codesFuerMedia(v.mediaId))),
    wixVerbunden
      ? bestellungenSeit(
          new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        )
      : Promise.resolve([]),
  ]);
  const umsatzKarte = codeUmsatzKarte(bestellungen);
  const couponVerbunden = codesJeMedia.some((c) => c.verbunden);

  const zeilen = videos.map((v, i) => {
    const k = kennzahlen.get(v.mediaId);
    const c = codesJeMedia[i];
    return {
      video: v,
      funnel: funnelFuerVideo({
        mediaId: v.mediaId,
        kommentare: k?.kommentare ?? null,
        ausgegebeneCodes: c.verbunden ? c.codes.map((x) => x.code) : null,
        codeUmsatz: wixVerbunden ? umsatzKarte : null,
        wixVerbunden,
      }),
    };
  });

  return (
    <div className="karte">
      <h2>
        Promo-Funnel
        <span className="rand">
          (Kommentar → Rabattcode → eingeloest → Umsatz)
        </span>
      </h2>
      {!couponVerbunden ? (
        <p className="hinweis">
          Die Coupon-App ist nicht verbunden (COUPON_API_URL/COUPON_API_KEY
          fehlen). Kommentar-Zahl kommt aus Instagram; Codes und Umsatz je
          Video werden erst sichtbar, sobald die Coupon-App die Zuordnung
          liefert.
        </p>
      ) : !wixVerbunden ? (
        <p className="hinweis">
          Wix ist nicht verbunden - eingeloeste Codes und Umsatz je Video
          bleiben leer, bis WIX_API_KEY und WIX_SITE_ID gesetzt sind.
        </p>
      ) : null}

      <div className="funnel">
        {zeilen.map(({ video, funnel }) => (
          <div key={video.id} className="karte" style={{ marginBottom: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              {video.fileTitle || video.hookText}
            </div>
            <div className="funnel">
              <FunnelStufe
                label="Kommentare"
                wert={funnel.kommentare}
                zeigeAls="zahl"
              />
              <FunnelStufe
                label="Ausgegebene Codes"
                wert={funnel.ausgegebeneCodes}
                zeigeAls="zahl"
              />
              <FunnelStufe
                label="Eingeloeste Codes"
                wert={funnel.eingeloesteCodes}
                zeigeAls="zahl"
              />
              <FunnelStufe
                label="Umsatz"
                wert={funnel.umsatz}
                zeigeAls="geld"
                waehrung={funnel.waehrung}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelStufe({
  label,
  wert,
  zeigeAls,
  waehrung,
}: {
  label: string;
  wert: import("../../../lib/funnel").FunnelEbene;
  zeigeAls: "zahl" | "geld";
  waehrung?: string;
}) {
  if (!wert.messbar) {
    return (
      <div className="stufe leer">
        <div>
          <div className="label">{label}</div>
          <div className="hinweis">{wert.hinweis ?? "nicht messbar"}</div>
        </div>
        <div className="wert">–</div>
      </div>
    );
  }
  return (
    <div className="stufe">
      <div className="label">{label}</div>
      <div className="wert">
        {zeigeAls === "geld" ? alsGeld(wert.wert, waehrung) : alsZahl(wert.wert)}
      </div>
    </div>
  );
}

function normalisiereTage(v: string | undefined): number {
  const n = Number(v);
  if ([7, 30, 90, 0].includes(n)) return n;
  return 30;
}
