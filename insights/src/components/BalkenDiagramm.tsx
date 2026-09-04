/**
 * Ein sehr schlankes Balken-Diagramm als Inline-SVG.
 *
 * Absichtlich ohne Bibliothek: die App soll klein bleiben, und ein Balken je
 * Tag ist nichts, wofuer eine Diagramm-Bibliothek geholt werden muesste.
 *
 * Werte:
 *   labels[i] wird als Achsentitel unter dem Balken angezeigt (max 6 werden
 *   gerendert - sonst wird es unlesbar; die Balken bleiben alle da).
 */
export function BalkenDiagramm({
  werte,
  labels,
  farbe = "var(--accent)",
  hoehe = 160,
  format = (n: number) => String(n),
}: {
  werte: number[];
  labels: string[];
  farbe?: string;
  hoehe?: number;
  format?: (n: number) => string;
}) {
  if (werte.length === 0) {
    return <div className="leerzustand">Noch keine Datenpunkte.</div>;
  }
  const max = Math.max(1, ...werte);
  const w = 100;
  const h = 100;
  const spalten = werte.length;
  const luecke = spalten > 40 ? 0.5 : 2;
  const breite = (w - luecke * (spalten - 1)) / spalten;
  const beschriftungen = labels.length > 6 ? auswahl(labels, 6) : labels;
  return (
    <div>
      <svg
        className="chart"
        viewBox={`0 0 ${w} ${h + 12}`}
        preserveAspectRatio="none"
        style={{ height: `${hoehe}px` }}
        role="img"
        aria-label="Balken-Diagramm"
      >
        {werte.map((v, i) => {
          const hh = (v / max) * h;
          const x = i * (breite + luecke);
          const y = h - hh;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={breite}
                height={hh}
                rx={0.6}
                fill={farbe}
                opacity={0.9}
              >
                <title>
                  {labels[i] ?? ""}: {format(v)}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: "var(--muted)",
          fontSize: 10,
          marginTop: 4,
        }}
      >
        {beschriftungen.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/** Gleichmaessige Auswahl aus einer Liste, incl. erstem und letztem Element. */
function auswahl<T>(liste: T[], n: number): T[] {
  if (liste.length <= n) return liste;
  const raus: T[] = [];
  for (let i = 0; i < n; i += 1) {
    raus.push(liste[Math.round((i * (liste.length - 1)) / (n - 1))]);
  }
  return raus;
}
