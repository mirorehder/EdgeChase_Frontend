-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'promo',
    "durationMs" INTEGER,
    "sourceFolderId" TEXT,
    "sourceFolderName" TEXT,
    "rootFolderId" TEXT,
    "manualRank" INTEGER,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "apparelScore" DOUBLE PRECISION,
    "stuntScore" DOUBLE PRECISION,
    "momentArt" TEXT,
    "momentDescription" TEXT,
    "highlightStartMs" INTEGER,
    "highlightEndMs" INTEGER,
    "peakMs" INTEGER,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "analysisVersion" INTEGER,
    "analysisFailures" INTEGER NOT NULL DEFAULT 0,
    "analysisError" TEXT,
    "editedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'info',
    "track" TEXT NOT NULL DEFAULT 'promo',
    "message" TEXT NOT NULL,
    "videoId" TEXT,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoVideo" (
    "id" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'promo',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "hookText" TEXT NOT NULL,
    "textStyle" TEXT,
    "requestedVia" TEXT,
    "themeHint" TEXT,
    "videoVolume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "scenes" JSONB NOT NULL,
    "textPhases" JSONB,
    "fileTitle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "driveUrl" TEXT,
    "driveFileName" TEXT,
    "driveFolderId" TEXT,
    "conceptId" TEXT,
    "soundAudioId" TEXT,
    "soundTitle" TEXT,
    "soundStatus" TEXT,
    "postedMediaId" TEXT,
    "postedAt" TIMESTAMP(3),
    "publicUrl" TEXT,
    "postError" TEXT,
    "postCaption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "hookText" TEXT,
    "hookMode" TEXT NOT NULL DEFAULT 'ki',
    "hookTexts" JSONB NOT NULL DEFAULT '[]',
    "hookIndex" INTEGER NOT NULL DEFAULT 0,
    "captionMode" TEXT NOT NULL DEFAULT 'ki',
    "captions" JSONB NOT NULL DEFAULT '[]',
    "captionIndex" INTEGER NOT NULL DEFAULT 0,
    "textStyle" TEXT NOT NULL DEFAULT 'banner',
    "clipCount" INTEGER NOT NULL DEFAULT 4,
    "maxSecondsPerScene" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "videoVolume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "themeHint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'promo',
    "sourceUrl" TEXT,
    "hookText" TEXT NOT NULL,
    "textPhases" JSONB NOT NULL DEFAULT '[]',
    "textStyle" TEXT NOT NULL DEFAULT 'reference',
    "clipCount" INTEGER NOT NULL,
    "totalSeconds" DOUBLE PRECISION NOT NULL,
    "secondsPerScene" DOUBLE PRECISION NOT NULL,
    "theme" TEXT,
    "notes" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "soundUrl" TEXT,
    "soundAudioId" TEXT,
    "soundKind" TEXT,
    "soundTitle" TEXT,
    "soundArtist" TEXT,
    "soundStatus" TEXT NOT NULL DEFAULT 'ohne',
    "soundNote" TEXT,
    "soundCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFolder" (
    "id" TEXT NOT NULL,
    "driveFolderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'viral',
    "description" TEXT NOT NULL DEFAULT '',
    "autoAnalyze" BOOLEAN NOT NULL DEFAULT true,
    "useInVideos" BOOLEAN NOT NULL DEFAULT true,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackSchedule" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "videosPerDay" INTEGER NOT NULL DEFAULT 1,
    "conceptMode" TEXT NOT NULL DEFAULT 'rotation',
    "conceptIds" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AusgabeOrdner" (
    "track" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "folderName" TEXT NOT NULL DEFAULT '',
    "folderUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AusgabeOrdner_pkey" PRIMARY KEY ("track","kind")
);

-- CreateTable
CREATE TABLE "PostZeitplan" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "postsPerDay" INTEGER NOT NULL DEFAULT 1,
    "fensterVonMin" INTEGER NOT NULL DEFAULT 480,
    "fensterBisMin" INTEGER NOT NULL DEFAULT 1260,
    "minAbstandMin" INTEGER NOT NULL DEFAULT 120,
    "alsTrialReel" BOOLEAN NOT NULL DEFAULT true,
    "quelle" TEXT NOT NULL DEFAULT 'scheduled',
    "hashtags" TEXT NOT NULL DEFAULT '',
    "postingTimes" TEXT NOT NULL DEFAULT '',
    "trendSounds" JSONB NOT NULL DEFAULT '[]',
    "soundTags" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostZeitplan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoundTag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'stimmung',
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoundTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLauf" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "track" TEXT NOT NULL,
    "gepostet" BOOLEAN NOT NULL DEFAULT false,
    "grund" TEXT,
    "mediaId" TEXT,
    "videoTitel" TEXT,

    CONSTRAINT "PostLauf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clip_driveFileId_key" ON "Clip"("driveFileId");

-- CreateIndex
CREATE INDEX "Clip_apparelScore_idx" ON "Clip"("apparelScore");

-- CreateIndex
CREATE INDEX "Clip_lastUsedAt_idx" ON "Clip"("lastUsedAt");

-- CreateIndex
CREATE INDEX "Clip_track_idx" ON "Clip"("track");

-- CreateIndex
CREATE INDEX "Clip_rootFolderId_idx" ON "Clip"("rootFolderId");

-- CreateIndex
CREATE INDEX "ActivityLog_at_idx" ON "ActivityLog"("at");

-- CreateIndex
CREATE INDEX "PromoVideo_status_idx" ON "PromoVideo"("status");

-- CreateIndex
CREATE INDEX "PromoVideo_createdAt_idx" ON "PromoVideo"("createdAt");

-- CreateIndex
CREATE INDEX "PromoVideo_track_idx" ON "PromoVideo"("track");

-- CreateIndex
CREATE INDEX "PromoVideo_origin_idx" ON "PromoVideo"("origin");

-- CreateIndex
CREATE INDEX "PromoVideo_track_postedAt_idx" ON "PromoVideo"("track", "postedAt");

-- CreateIndex
CREATE INDEX "Concept_createdAt_idx" ON "Concept"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SourceFolder_driveFolderId_key" ON "SourceFolder"("driveFolderId");

-- CreateIndex
CREATE INDEX "SourceFolder_track_idx" ON "SourceFolder"("track");

-- CreateIndex
CREATE UNIQUE INDEX "SoundTag_key_key" ON "SoundTag"("key");

-- CreateIndex
CREATE INDEX "PostLauf_at_idx" ON "PostLauf"("at");

-- CreateIndex
CREATE INDEX "PostLauf_track_at_idx" ON "PostLauf"("track", "at");

