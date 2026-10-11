-- Les colonnes de recherche des médias (searchTitle, searchName, searchAlt) sont remplies au démarrage
-- du serveur (server/plugins/search-backfill.ts) : la suppression des accents n'est pas portable en SQL.

-- AlterTable
ALTER TABLE `Project` ADD COLUMN `publicListing` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Media` ADD COLUMN `searchAlt` VARCHAR(191) NULL,
    ADD COLUMN `searchName` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `searchTitle` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `CacheRevision` (
    `scope` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`scope`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
