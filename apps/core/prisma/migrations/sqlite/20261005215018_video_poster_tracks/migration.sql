-- AlterTable
ALTER TABLE "Media" ADD COLUMN "posterHeight" INTEGER;
ALTER TABLE "Media" ADD COLUMN "posterKey" TEXT;
ALTER TABLE "Media" ADD COLUMN "posterSize" INTEGER;
ALTER TABLE "Media" ADD COLUMN "posterTime" REAL;
ALTER TABLE "Media" ADD COLUMN "posterWidth" INTEGER;

-- CreateTable
CREATE TABLE "MediaTextTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mediaId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "cueCount" INTEGER NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MediaTextTrack_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaTextTrack_storageKey_key" ON "MediaTextTrack"("storageKey");

-- CreateIndex
CREATE INDEX "MediaTextTrack_mediaId_idx" ON "MediaTextTrack"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_posterKey_key" ON "Media"("posterKey");
