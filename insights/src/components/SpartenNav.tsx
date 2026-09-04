import Link from "next/link";
import { SPARTEN, type Track } from "../lib/tracks";

/**
 * Die vier Sparten-Kacheln auf der Uebersicht. Jede fuehrt in die zugehoerige
 * Detailseite.
 *
 * `zahlen` sind die Anzahl geposteter Videos je Sparte - kommt aus
 * `anzahlJeSparte()`.
 */
export function SpartenNav({
  zahlen,
}: {
  zahlen: Record<Track, number>;
}) {
  return (
    <div className="sparten-nav">
      {SPARTEN.map((s) => (
        <Link
          key={s.key}
          href={`/sparte/${s.key}`}
          style={{ ["--sparte" as string]: s.farbeHex } as React.CSSProperties}
        >
          <span className="kurz">{s.kurz}</span>
          <span className="zahl">{zahlen[s.key] ?? 0} Videos</span>
          <span className="strich" aria-hidden />
        </Link>
      ))}
    </div>
  );
}
