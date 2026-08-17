import { NextRequest } from "next/server";
import { isTrack, type Track } from "./drive";

/**
 * Liest die Sparte aus dem Abfrageparameter "track".
 *
 * Voreinstellung ist "promo": Aufrufe ohne Angabe stammen aus der Zeit vor der
 * Trennung (Zeitplan, Kurzbefehle) und meinen die Werbevideos.
 */
export function trackFromRequest(request: NextRequest): Track {
  const value = new URL(request.url).searchParams.get("track");
  return isTrack(value) ? value : "promo";
}

/** Dieselbe Prüfung für einen Wert aus einem JSON-Rumpf. */
export function trackFromValue(value: unknown): Track {
  return isTrack(value) ? value : "promo";
}
