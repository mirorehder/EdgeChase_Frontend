/**
 * Der obere Bereich der App - Marke, Titel und Kurzbeschreibung.
 * Bewusst schlank: Der eigentliche Inhalt (die Kacheln) faellt direkt darunter
 * ins Auge.
 */
export function Kopf({
  titel = "EdgeChase Insights",
  unter = "Instagram-Zahlen und Wix-Umsatz zu den vier Sparten",
}: {
  titel?: string;
  unter?: string;
}) {
  return (
    <>
      <div className="kopf">
        <div className="marke" aria-hidden />
        <h1>{titel}</h1>
      </div>
      <p className="unter">{unter}</p>
    </>
  );
}
