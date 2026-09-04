import Link from "next/link";

/**
 * 7/30/90 Tage Umschalter. Der aktive Wert kommt aus dem Query-Parameter -
 * so bleibt der Umschalter zustandslos, ist als Link in beiden Themes
 * anklickbar und funktioniert auch ohne JavaScript.
 */
export function Zeitraumleiste({
  aktiv,
  basisPfad,
}: {
  aktiv: number;
  basisPfad: string;
}) {
  const stufen = [
    { tage: 7, label: "7 T" },
    { tage: 30, label: "30 T" },
    { tage: 90, label: "90 T" },
    { tage: 0, label: "alle" },
  ];
  return (
    <div className="zeitraum">
      {stufen.map((s) => (
        <Link
          key={s.tage}
          href={s.tage === 0 ? basisPfad : `${basisPfad}?tage=${s.tage}`}
          className={s.tage === aktiv ? "aktiv" : ""}
        >
          {s.label}
        </Link>
      ))}
    </div>
  );
}
