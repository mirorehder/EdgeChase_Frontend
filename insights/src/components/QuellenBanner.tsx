/**
 * Ein knappes Statusband, das zeigt, welche Datenquellen verbunden sind.
 *
 * Bewusst dezent, aber ehrlich: fehlt eine Quelle, weiss der Nutzer sofort
 * warum eine Zahl "–" ist - statt zu raten, ob es null Daten oder ein Fehler
 * ist.
 */
export function QuellenBanner({
  db,
  wix,
  igTracks,
  igGesamt,
  coupon,
}: {
  db: boolean;
  wix: boolean;
  igTracks: Array<{ label: string; verbunden: boolean }>;
  igGesamt: boolean;
  coupon?: boolean;
}) {
  const alles =
    db &&
    wix &&
    igGesamt &&
    (coupon === undefined ? true : coupon);
  if (alles) return null;

  const punkte: Array<{ text: string; ok: boolean }> = [
    { text: "Neon-DB", ok: db },
    { text: "Instagram", ok: igGesamt },
    { text: "Wix", ok: wix },
  ];
  if (coupon !== undefined) punkte.push({ text: "Coupon-App", ok: coupon });

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "10px 14px",
        marginBottom: 16,
        fontSize: 12,
        color: "var(--muted)",
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--text)" }}>Quellen:</span>
      {punkte.map((p) => (
        <span key={p.text} style={{ display: "inline-flex", gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: p.ok ? "var(--ok)" : "var(--warn)",
              alignSelf: "center",
            }}
          />
          {p.text} {p.ok ? "verbunden" : "nicht verbunden"}
        </span>
      ))}
      {!igGesamt && igTracks.some((t) => !t.verbunden) ? (
        <span>
          (fehlend:{" "}
          {igTracks
            .filter((t) => !t.verbunden)
            .map((t) => t.label)
            .join(", ")}
          )
        </span>
      ) : null}
    </div>
  );
}
