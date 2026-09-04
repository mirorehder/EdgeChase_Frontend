import { alsZahl } from "../lib/format";
import type { SparteZusammenfassung } from "../lib/aggregation";

/**
 * Rangliste der besten Videos einer Sparte - nach Engagement (Likes +
 * Kommentare + Shares + Saves).
 *
 * Bewusst engagement- statt reichweitensortiert: Reichweite haengt stark am
 * Alter des Posts, Engagement traegt die Frage "hat der Hook eingeschlagen"
 * besser.
 */
export function Rangliste({
  top,
}: {
  top: SparteZusammenfassung["top"];
}) {
  if (top.length === 0) {
    return (
      <div className="leerzustand">Noch keine Kennzahlen zum Sortieren.</div>
    );
  }
  return (
    <div className="rangliste">
      <ol>
        {top.map((r, i) => (
          <li key={r.mediaId}>
            <span className="rang">{i + 1}.</span>
            <span className="hook" title={r.hookText}>
              {r.fileTitle || r.hookText}
            </span>
            <span className="zahl">
              <b>{alsZahl(r.engagement)}</b> · {alsZahl(r.reichweite)} R
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
