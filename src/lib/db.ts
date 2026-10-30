import { PrismaClient } from "@prisma/client";

// Next.js lädt Module in der Entwicklung bei jedem Request neu; ohne den
// globalThis-Cache entstünde pro Reload eine neue Prisma-Instanz und damit
// eine neue Connection-Pool-Verbindung zu Neon.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Die Datenbank-Adresse mit grosszügigeren Wartezeiten.
 *
 * Neons Rechenknoten schläft nach einigen Minuten Ruhe ein. Bei einem Aufruf
 * pro Stunde (externer Pinger) muss er jedes Mal neu aufwachen - Prisma wartet
 * aber standardmässig nur 5 Sekunden auf die Verbindung und meldet sonst
 * "Can't reach database server". Das hat im Betrieb gelegentlich den ganzen
 * Aufruf scheitern lassen. Werte, die schon in der Adresse stehen, bleiben
 * unangetastet.
 */
function datenbankAdresse(): string | undefined {
  const roh = process.env.DATABASE_URL;
  if (!roh) return undefined;
  // Nur anhängen, nie neu schreiben: so bleibt die Adresse samt Zugangsdaten
  // Zeichen für Zeichen die, die Vercel gesetzt hat.
  let adresse = roh;
  for (const [name, wert] of [["connect_timeout", "15"], ["pool_timeout", "15"]]) {
    if (!new RegExp(`[?&]${name}=`).test(adresse)) {
      adresse += `${adresse.includes("?") ? "&" : "?"}${name}=${wert}`;
    }
  }
  return adresse;
}

const adresse = datenbankAdresse();

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient(adresse ? { datasourceUrl: adresse } : undefined);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Führt eine Datenbankabfrage aus und wiederholt sie, wenn der Server beim
 * Verbindungsaufbau nicht antwortet (schlafender Neon-Knoten).
 *
 * Nur für Abfragen, die gefahrlos wiederholt werden können: der Fehler tritt
 * vor jeder Ausführung auf, es ist also nichts halb passiert. Andere Fehler
 * gehen sofort durch.
 */
export async function mitDbWiederholung<T>(
  abfrage: () => Promise<T>,
  opt: { versuche?: number; pauseMs?: number; schlaf?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const versuche = opt.versuche ?? 3;
  const pauseMs = opt.pauseMs ?? 2_000;
  const schlaf = opt.schlaf ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let i = 1; ; i++) {
    try {
      return await abfrage();
    } catch (err) {
      const nichtErreichbar =
        err instanceof Error && err.name === "PrismaClientInitializationError";
      if (!nichtErreichbar || i >= versuche) throw err;
      await schlaf(pauseMs);
    }
  }
}
