import type { BibliotheksStand } from "@/lib/soundBibliothek";
import { chFormatZeitstempel } from "@/lib/zeit";

/**
 * Zustand der Sound-Bibliothek - nur Anzeige. Die Bibliothek fuellt sich
 * taeglich von selbst; hier sieht man, ob das klappt.
 */
export function SoundBibliothekStatus({ stand }: { stand: BibliotheksStand }) {
  const schwach = stand.brauchbar < 5;
  return (
    <p className="sparte-hinweis">
      Sound-Bibliothek: {stand.brauchbar} brauchbare Sounds (aggressiv, nicht saisonal), {stand.aktiv} aktiv
      insgesamt, {stand.bewertet} bewertet
      {stand.gesperrt > 0 ? `, ${stand.gesperrt} bei Instagram gesperrt` : ""}
      {stand.veraltet > 0 ? `, ${stand.veraltet} veraltet` : ""}. Letzter Zufluss:{" "}
      {stand.letzteAufnahme ? `${chFormatZeitstempel(stand.letzteAufnahme)} CH` : "noch keiner"}.
      {schwach ? " Zu wenig - die Sounds kommen dann aus dem alten Trend-Sound-Pool." : ""}
    </p>
  );
}
