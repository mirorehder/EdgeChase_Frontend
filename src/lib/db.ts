import { PrismaClient } from "@prisma/client";

// Next.js lädt Module in der Entwicklung bei jedem Request neu; ohne den
// globalThis-Cache entstünde pro Reload eine neue Prisma-Instanz und damit
// eine neue Connection-Pool-Verbindung zu Neon.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
