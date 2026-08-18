-- AlterTable
ALTER TABLE "PromoVideo" ADD COLUMN "driveFolderId" TEXT;

ALTER TABLE "Concept" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ViralSchedule" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "videosPerDay" INTEGER NOT NULL DEFAULT 1,
    "conceptMode" TEXT NOT NULL DEFAULT 'rotation',
    "conceptIds" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralSchedule_pkey" PRIMARY KEY ("id")
);
