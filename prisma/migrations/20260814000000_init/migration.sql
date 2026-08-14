-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMs" INTEGER,
    "description" TEXT,
    "apparelScore" DOUBLE PRECISION,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "analysisVersion" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoVideo" (
    "id" TEXT NOT NULL,
    "hookText" TEXT NOT NULL,
    "scenes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "driveUrl" TEXT,
    "driveFileName" TEXT,
    "postedMediaId" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clip_driveFileId_key" ON "Clip"("driveFileId");

-- CreateIndex
CREATE INDEX "Clip_apparelScore_idx" ON "Clip"("apparelScore");

-- CreateIndex
CREATE INDEX "Clip_lastUsedAt_idx" ON "Clip"("lastUsedAt");

-- CreateIndex
CREATE INDEX "PromoVideo_status_idx" ON "PromoVideo"("status");

-- CreateIndex
CREATE INDEX "PromoVideo_createdAt_idx" ON "PromoVideo"("createdAt");

