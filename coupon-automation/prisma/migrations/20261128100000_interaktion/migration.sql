-- Interaktions-Kampagne: neue Felder und Tabellen

-- 1. Neue Felder auf InstagramMedia
ALTER TABLE "InstagramMedia" ADD COLUMN "kampagne" TEXT;
ALTER TABLE "InstagramMedia" ADD COLUMN "interaktionRabatt" INTEGER;
ALTER TABLE "InstagramMedia" ADD COLUMN "interaktionGueltigStunden" INTEGER;

-- 2. Konfigurations-Tabelle für die Interaktions-Kampagne
CREATE TABLE "InteraktionConfig" (
    "id"             TEXT    NOT NULL DEFAULT 'default',
    "enabled"        BOOLEAN NOT NULL DEFAULT true,
    "rabattProzent"  INTEGER NOT NULL DEFAULT 25,
    "gueltigStunden" INTEGER NOT NULL DEFAULT 24,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InteraktionConfig_pkey" PRIMARY KEY ("id")
);

-- 3. Teilnahme-Tabelle
CREATE TABLE "InteraktionTeilnahme" (
    "id"               TEXT         NOT NULL,
    "igScopedId"       TEXT         NOT NULL,
    "mediaId"          TEXT         NOT NULL,
    "messageId"        TEXT         NOT NULL,
    "status"           TEXT         NOT NULL DEFAULT 'neu',
    "name"             TEXT,
    "code"             TEXT,
    "codeId"           TEXT,
    "hinweis"          TEXT,
    "folgeStatus"      TEXT,
    "codeGesendetAm"   TIMESTAMP(3),
    "codeEingeloestAm" TIMESTAMP(3),
    "codeGueltigBis"   TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InteraktionTeilnahme_pkey" PRIMARY KEY ("id")
);

-- Eindeutige Indizes auf InteraktionTeilnahme
CREATE UNIQUE INDEX "InteraktionTeilnahme_messageId_key"
    ON "InteraktionTeilnahme"("messageId");

CREATE UNIQUE INDEX "InteraktionTeilnahme_igScopedId_mediaId_key"
    ON "InteraktionTeilnahme"("igScopedId", "mediaId");

CREATE INDEX "InteraktionTeilnahme_status_idx"
    ON "InteraktionTeilnahme"("status");

CREATE INDEX "InteraktionTeilnahme_igScopedId_idx"
    ON "InteraktionTeilnahme"("igScopedId");
