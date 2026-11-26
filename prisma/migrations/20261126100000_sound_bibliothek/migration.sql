-- Sound-Bibliothek und der am Post tatsächlich verwendete Sound.
ALTER TABLE "PromoVideo" ADD COLUMN "postSoundAudioId" TEXT;
ALTER TABLE "PromoVideo" ADD COLUMN "postSoundTitle" TEXT;
ALTER TABLE "PromoVideo" ADD COLUMN "postSoundHerkunft" TEXT;

CREATE TABLE "SoundBibliothek" (
    "audioId" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "kuenstler" TEXT,
    "dauerMs" INTEGER NOT NULL,
    "typ" TEXT NOT NULL DEFAULT 'original_sound',
    "alterTage" INTEGER,
    "ersterFundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "zuletztGesehenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'aktiv',
    "sperrGrund" TEXT,
    "fehlversuche" INTEGER NOT NULL DEFAULT 0,
    "bewertetAt" TIMESTAMP(3),
    "druck" DOUBLE PRECISION,
    "startStaerke" DOUBLE PRECISION,
    "saisonal" BOOLEAN NOT NULL DEFAULT false,
    "tauglich" BOOLEAN,
    "vibeTags" TEXT[],
    "vibeBeschreibung" TEXT,

    CONSTRAINT "SoundBibliothek_pkey" PRIMARY KEY ("audioId")
);

CREATE INDEX "SoundBibliothek_status_zuletztGesehenAt_idx" ON "SoundBibliothek"("status", "zuletztGesehenAt");
