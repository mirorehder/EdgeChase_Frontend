import { NextRequest } from "next/server";
import { env } from "./env";

/**
 * Prüft den Zugangsschlüssel für Aufrufe von aussen.
 *
 * Ein iOS-Kurzbefehl kann sich nicht anmelden, deshalb ein fester Schlüssel -
 * derselbe, der auch den Zeitplan schützt. Er wird als Kopfzeile oder als
 * Abfrageparameter akzeptiert, weil sich in Kurzbefehlen beides einrichten
 * lässt und der Parameter der bequemere Weg ist.
 *
 * Aufrufe aus dem eigenen Dashboard brauchen ihn nicht: sie kommen aus der
 * bereits geladenen Seite und werden am Ursprung erkannt.
 */
export function istBerechtigt(request: NextRequest): boolean {
  const secret = env.cronSecret;

  const header = request.headers.get("x-api-key");
  if (header && header === secret) return true;

  const param = new URL(request.url).searchParams.get("secret");
  if (param && param === secret) return true;

  // Gleiche Herkunft: der Aufruf stammt aus dem eigenen Dashboard.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && new URL(origin).host === host) return true;

  return false;
}
