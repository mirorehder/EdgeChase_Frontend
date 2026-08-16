-- CreateTable
CREATE TABLE "DailyConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "hookText" TEXT,
    "textStyle" TEXT NOT NULL DEFAULT 'banner',
    "clipCount" INTEGER NOT NULL DEFAULT 4,
    "maxSecondsPerScene" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "themeHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyConfig_pkey" PRIMARY KEY ("id")
);
