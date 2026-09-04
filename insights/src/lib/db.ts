/**
 * Prisma-Client - Einzelinstanz.
 *
 * In der Entwicklung wuerde Next.js bei jedem Hot Reload einen neuen Client
 * erzeugen und die DB mit Verbindungen fluten; auf globalThis abgelegt haelt
 * sich der Client ueber die Neubauten hinweg.
 *
 * Insights nutzt die DB AUSSCHLIESSLICH lesend - die einzigen Aufrufer stehen
 * in `mapping.ts`.
 */
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __insightsPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__insightsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__insightsPrisma = prisma;
}
