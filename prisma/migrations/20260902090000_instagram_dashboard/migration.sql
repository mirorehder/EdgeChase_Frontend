-- CreateTable
CREATE TABLE "InstagramConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramMedia" (
    "id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "permalink" TEXT,
    "istAktion" BOOLEAN NOT NULL,
    "sprache" TEXT NOT NULL,
    "aktualisiertAm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramMedia_pkey" PRIMARY KEY ("id")
);
