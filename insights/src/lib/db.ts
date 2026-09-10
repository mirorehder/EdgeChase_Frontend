/**
 * Prisma-Client - lazy, gemeinsam genutzt, mit ehrlichem Leerzustand.
 *
 * Zwei Ziele:
 *
 * 1) Kein Client-Aufbau beim Modul-Import. Sonst schlaegt der Next.js-Build
 *    auf Vercel fehl, wenn DATABASE_URL noch nicht gesetzt ist - obwohl die
 *    Seiten dynamisch sind und niemand tatsaechlich abfragt. Erst der erste
 *    Zugriff auf `prisma()` erzeugt den Client.
 *
 * 2) In der Entwicklung teilt sich der Client ueber globalThis mit, damit ein
 *    Hot Reload die DB nicht mit Verbindungen flutet.
 *
 * Insights nutzt die DB AUSSCHLIESSLICH lesend - die einzigen Aufrufer
 * stehen in `mapping.ts`. Fehlt DATABASE_URL, geben die dortigen Funktionen
 * saubere Leerwerte zurueck; die Oberflaeche zeigt einen ehrlichen
 * Leerzustand statt eines Absturzes.
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __insightsPrisma: PrismaClient | undefined;
}

/**
 * True, wenn wenigstens die Verbindungszeichenkette gesetzt ist. Nur dann
 * lohnt sich ein Abfrageversuch. So laesst sich in den Aufrufern klar
 * unterscheiden zwischen "nicht verbunden" (Env-Var fehlt) und "verbunden,
 * aber Fehler" (etwa Netzausfall).
 */
export function dbVerbunden(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function prisma(): PrismaClient {
  if (globalThis.__insightsPrisma) return globalThis.__insightsPrisma;
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
  if (process.env.NODE_ENV !== "production") {
    globalThis.__insightsPrisma = client;
  }
  return client;
}
