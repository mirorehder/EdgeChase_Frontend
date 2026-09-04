import { alsDatum, alsZahl } from "../lib/format";
import type { MediaKennzahlen } from "../lib/instagram";
import type { GepostetesVideo } from "../lib/mapping";

/**
 * Liste der letzten Reels einer Sparte - je mit Vorschau, Titel und den
 * wichtigsten Kennzahlen (Reichweite, Aufrufe, Likes, Kommentare).
 *
 * Bewusst kein Klick zum Video: die Anwendung ist eine Auswertung, kein
 * Player. Vorschaubild + Hook-Text reichen.
 */
export function VideoListe({
  videos,
  kennzahlen,
}: {
  videos: GepostetesVideo[];
  kennzahlen: Map<string, MediaKennzahlen>;
}) {
  if (videos.length === 0) {
    return <div className="leerzustand">Noch keine geposteten Videos.</div>;
  }
  return (
    <div className="video-liste">
      {videos.map((v) => {
        const k = kennzahlen.get(v.mediaId);
        const titel = v.fileTitle || v.hookText;
        return (
          <div key={v.id} className="video-zeile">
            <div className="thumb">
              {k?.vorschau ? (
                // Vorschau kommt vom Instagram-CDN - kein next/image, damit
                // wir uns keine wechselnden Hostnamen einfangen.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={k.vorschau} alt="" loading="lazy" />
              ) : (
                "kein Bild"
              )}
            </div>
            <div>
              <div className="titel">{titel}</div>
              <div className="meta">
                {alsDatum(v.postedAt)} · {v.origin === "scheduled" ? "auto" : "Hand"}
              </div>
            </div>
            <div className="zahlen">
              <div>
                <b>{alsZahl(k?.reichweite ?? null)}</b> Reichweite
              </div>
              <div>
                <b>{alsZahl(k?.aufrufe ?? null)}</b> Aufrufe
              </div>
              <div>
                <b>{alsZahl(k?.likes ?? null)}</b> Likes ·{" "}
                <b>{alsZahl(k?.kommentare ?? null)}</b> K
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
