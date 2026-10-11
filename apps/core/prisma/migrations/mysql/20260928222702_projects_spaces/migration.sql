-- DropForeignKey
ALTER TABLE `Media` DROP FOREIGN KEY `Media_projectId_fkey`;

-- DropIndex
DROP INDEX `Media_projectId_createdAt_idx` ON `Media`;

-- AlterTable
ALTER TABLE `Project` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `createdById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Folder` MODIFY `projectId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Media` ADD COLUMN `duplicatedFromId` VARCHAR(191) NULL,
    MODIFY `projectId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ProjectMember` (
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'DEVELOPER', 'EDITOR') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProjectMember_userId_idx`(`userId`),
    PRIMARY KEY (`projectId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Media_projectId_deletedAt_createdAt_idx` ON `Media`(`projectId`, `deletedAt`, `createdAt`);

-- CreateIndex
CREATE INDEX `Media_duplicatedFromId_idx` ON `Media`(`duplicatedFromId`);

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectMember` ADD CONSTRAINT `ProjectMember_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectMember` ADD CONSTRAINT `ProjectMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Media` ADD CONSTRAINT `Media_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Media` ADD CONSTRAINT `Media_duplicatedFromId_fkey` FOREIGN KEY (`duplicatedFromId`) REFERENCES `Media`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise de données (ajoutée à la main) : les médias du projet technique « default »
-- (utilisé avant l'écran Projets) rejoignent la bibliothèque de l'organisation, puis ce
-- projet est supprimé (aucune clé d'API ni origine n'a pu y être créée).
UPDATE `Media` SET `projectId` = NULL WHERE `projectId` IN (SELECT `id` FROM `Project` WHERE `slug` = 'default');
UPDATE `Folder` SET `projectId` = NULL WHERE `projectId` IN (SELECT `id` FROM `Project` WHERE `slug` = 'default');
DELETE FROM `Project` WHERE `slug` = 'default';
