-- AlterTable
ALTER TABLE "Clip" ADD COLUMN "analysisFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Clip" ADD COLUMN "analysisError" TEXT;
