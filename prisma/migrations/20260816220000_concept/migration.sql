-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "hookText" TEXT NOT NULL,
    "textStyle" TEXT NOT NULL DEFAULT 'reference',
    "clipCount" INTEGER NOT NULL,
    "totalSeconds" DOUBLE PRECISION NOT NULL,
    "secondsPerScene" DOUBLE PRECISION NOT NULL,
    "theme" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Concept_createdAt_idx" ON "Concept"("createdAt");
