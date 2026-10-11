-- AlterTable
ALTER TABLE "Media" ADD COLUMN "processingState" TEXT;

-- CreateTable
CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "leaseUntil" DATETIME,
    "step" TEXT,
    "progress" REAL,
    "result" JSONB,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "MediaJob_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaRendition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "codecs" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "duration" REAL NOT NULL,
    "bitrate" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaRendition_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MediaJob_status_runAfter_priority_idx" ON "MediaJob"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "MediaJob_mediaId_idx" ON "MediaJob"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRendition_storageKey_key" ON "MediaRendition"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRendition_mediaId_name_key" ON "MediaRendition"("mediaId", "name");
