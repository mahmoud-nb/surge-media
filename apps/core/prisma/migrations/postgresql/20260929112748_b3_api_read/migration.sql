-- Les colonnes de recherche des médias (searchTitle, searchName, searchAlt) sont remplies au démarrage
-- du serveur (server/plugins/search-backfill.ts) : la suppression des accents n'est pas portable en SQL.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "publicListing" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "searchAlt" TEXT,
ADD COLUMN     "searchName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "searchTitle" TEXT;

-- CreateTable
CREATE TABLE "CacheRevision" (
    "scope" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CacheRevision_pkey" PRIMARY KEY ("scope")
);
