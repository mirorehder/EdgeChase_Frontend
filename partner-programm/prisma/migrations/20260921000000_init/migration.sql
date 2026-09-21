-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "igUsername" TEXT,
    "name" TEXT,
    "sprache" TEXT,
    "status" TEXT NOT NULL DEFAULT 'neu',
    "gesperrt" BOOLEAN NOT NULL DEFAULT false,
    "quelle" TEXT NOT NULL,
    "triggerMediaId" TEXT,
    "triggerCommentId" TEXT,
    "couponCode" TEXT,
    "wixCouponId" TEXT,
    "provisionssatz" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "kaeuferRabatt" INTEGER NOT NULL DEFAULT 15,
    "agbVersion" TEXT,
    "zustimmungAm" TIMESTAMP(3),
    "letzteBotAktion" TEXT,
    "eskalationsGrund" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerNachricht" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "richtung" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "igMessageId" TEXT,
    "klassifikation" TEXT,
    "sicherheit" DOUBLE PRECISION,
    "eskaliert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerNachricht_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerBestellung" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "wixOrderId" TEXT NOT NULL,
    "bestellwertNetto" DECIMAL(10,2) NOT NULL,
    "waehrung" TEXT NOT NULL DEFAULT 'CHF',
    "provisionssatz" DOUBLE PRECISION NOT NULL,
    "provision" DECIMAL(10,2) NOT NULL,
    "couponCode" TEXT NOT NULL,
    "monat" TEXT NOT NULL,
    "bestelltAm" TIMESTAMP(3) NOT NULL,
    "storniert" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerBestellung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAuszahlung" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "monat" TEXT NOT NULL,
    "betrag" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offen',
    "methode" TEXT,
    "ausgezahltAm" TIMESTAMP(3),
    "notiz" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerAuszahlung_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerMedia" (
    "id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "permalink" TEXT,
    "istAufruf" BOOLEAN NOT NULL,
    "analyseHinweis" TEXT,
    "ueberschreibung" BOOLEAN,
    "sprache" TEXT NOT NULL,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_igUserId_key" ON "Partner"("igUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_triggerCommentId_key" ON "Partner"("triggerCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_couponCode_key" ON "Partner"("couponCode");

-- CreateIndex
CREATE INDEX "Partner_status_idx" ON "Partner"("status");

-- CreateIndex
CREATE INDEX "Partner_couponCode_idx" ON "Partner"("couponCode");

-- CreateIndex
CREATE INDEX "Partner_createdAt_idx" ON "Partner"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerNachricht_igMessageId_key" ON "PartnerNachricht"("igMessageId");

-- CreateIndex
CREATE INDEX "PartnerNachricht_partnerId_createdAt_idx" ON "PartnerNachricht"("partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerBestellung_wixOrderId_key" ON "PartnerBestellung"("wixOrderId");

-- CreateIndex
CREATE INDEX "PartnerBestellung_partnerId_idx" ON "PartnerBestellung"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerBestellung_monat_idx" ON "PartnerBestellung"("monat");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAuszahlung_partnerId_monat_key" ON "PartnerAuszahlung"("partnerId", "monat");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "PartnerNachricht" ADD CONSTRAINT "PartnerNachricht_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerBestellung" ADD CONSTRAINT "PartnerBestellung_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAuszahlung" ADD CONSTRAINT "PartnerAuszahlung_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

