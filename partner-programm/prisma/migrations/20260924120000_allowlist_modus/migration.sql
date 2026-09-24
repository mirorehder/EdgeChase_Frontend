-- Allowlist-Modus: Reels loesen erst Onboarding aus, wenn sie von Hand als
-- Partner-Aufruf markiert sind. Vorgabe false = Allowlist (manuell), true =
-- automatische KI-Erkennung.
-- AlterTable
ALTER TABLE "PartnerConfig" ADD COLUMN     "autoErkennung" BOOLEAN NOT NULL DEFAULT false;
