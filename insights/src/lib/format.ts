/**
 * Anzeigeformate - deutsch, kurz, mit sinnvollen Rundungen.
 */

/** 12345 -> "12.345", 1234567 -> "1,2 Mio". */
export function alsZahl(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(".", ",")} Mio`;
  if (Math.abs(n) >= 10_000)
    return `${(n / 1000).toFixed(1).replace(".", ",")} Tsd`;
  return new Intl.NumberFormat("de-DE").format(Math.round(n));
}

/** Geldbetrag: 1234.5 EUR -> "1.234,50 €". */
export function alsGeld(n: number | null | undefined, waehrung = "EUR"): string {
  if (n == null || !Number.isFinite(n)) return "–";
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: waehrung || "EUR",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${alsZahl(n)} ${waehrung}`;
  }
}

/** Prozentangabe: 0.0234 -> "2,3 %". */
export function alsProzent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(1).replace(".", ",")} %`;
}

/** Datum kompakt: "04.09.26". */
export function alsDatum(d: Date | string | null | undefined): string {
  if (!d) return "–";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(dt);
}
