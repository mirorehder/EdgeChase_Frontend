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
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  if (origin && sameHost(origin, host)) return true;

  // Bei einem einfachen GET aus der eigenen Seite schickt der Browser gar
  // keine Origin-Kopfzeile - nur einen Verweis auf die aufrufende Seite. Ohne
  // diese zweite Prüfung scheitern lesende Aufrufe aus dem Dashboard an der
  // Berechtigung, obwohl sie genau von dort stammen.
  const referer = request.headers.get("referer");
  if (referer && sameHost(referer, host)) return true;

  return false;
}

function sameHost(url: string, host: string): boolean {
  try {
    return new URL(url).host === host;
  } catch {
    return false;
  }
}
