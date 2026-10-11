-- CreateEnum
CREATE TYPE "ProcessingState" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "processingState" "ProcessingState";

-- CreateTable
CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" "MediaJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "step" TEXT,
    "progress" DOUBLE PRECISION,
    "result" JSONB,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaRendition" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "codecs" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaRendition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaJob_status_runAfter_priority_idx" ON "MediaJob"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "MediaJob_mediaId_idx" ON "MediaJob"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRendition_storageKey_key" ON "MediaRendition"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRendition_mediaId_name_key" ON "MediaRendition"("mediaId", "name");

-- AddForeignKey
ALTER TABLE "MediaJob" ADD CONSTRAINT "MediaJob_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRendition" ADD CONSTRAINT "MediaRendition_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
