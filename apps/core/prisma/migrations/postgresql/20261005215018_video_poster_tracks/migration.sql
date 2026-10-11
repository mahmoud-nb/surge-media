-- CreateEnum
CREATE TYPE "TextTrackKind" AS ENUM ('SUBTITLES', 'CAPTIONS', 'DESCRIPTIONS', 'CHAPTERS');

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "posterHeight" INTEGER,
ADD COLUMN     "posterKey" TEXT,
ADD COLUMN     "posterSize" INTEGER,
ADD COLUMN     "posterTime" DOUBLE PRECISION,
ADD COLUMN     "posterWidth" INTEGER;

-- CreateTable
CREATE TABLE "MediaTextTrack" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" "TextTrackKind" NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "cueCount" INTEGER NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaTextTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaTextTrack_storageKey_key" ON "MediaTextTrack"("storageKey");

-- CreateIndex
CREATE INDEX "MediaTextTrack_mediaId_idx" ON "MediaTextTrack"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_posterKey_key" ON "Media"("posterKey");

-- AddForeignKey
ALTER TABLE "MediaTextTrack" ADD CONSTRAINT "MediaTextTrack_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
