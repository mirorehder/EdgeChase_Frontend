-- CreateTable
CREATE TABLE "InstagramComment" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT,
    "authorUsername" TEXT,
    "text" TEXT NOT NULL,
    "name" TEXT,
    "couponCode" TEXT,
    "couponId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'empfangen',
    "hinweis" TEXT,
    "dmGesendet" BOOLEAN NOT NULL DEFAULT false,
    "antwortGesendet" BOOLEAN NOT NULL DEFAULT false,
    "antwortText" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramComment_status_idx" ON "InstagramComment"("status");

-- CreateIndex
CREATE INDEX "InstagramComment_createdAt_idx" ON "InstagramComment"("createdAt");
