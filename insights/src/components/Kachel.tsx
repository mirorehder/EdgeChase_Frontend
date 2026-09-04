/**
 * Eine einzelne Kennzahl-Kachel.
 * Grosse Zahl, kleines Label darueber - stumpf und lesbar.
 */
export function Kachel({
  label,
  wert,
  neben,
  akzent = false,
}: {
  label: string;
  wert: string;
  neben?: string;
  akzent?: boolean;
}) {
  return (
    <div className={`kachel${akzent ? " akzent" : ""}`}>
      <div className="label">{label}</div>
      <div className="wert">{wert}</div>
      {neben ? <div className="neben">{neben}</div> : null}
    </div>
  );
}
