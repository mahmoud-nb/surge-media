-- Reprise de données (ajoutée à la main) : l'ancien format de jeton n'a jamais été accepté par aucune API
-- (aucune interface ne permettait d'en créer) ; les éventuelles lignes sont supprimées pour que la
-- colonne obligatoire `type` puisse être ajoutée.
DELETE FROM `AccessToken`;

-- AlterTable
ALTER TABLE `Session` ADD COLUMN `passwordVerifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `AccessToken` ADD COLUMN `allProjects` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `environment` VARCHAR(191) NULL,
    ADD COLUMN `includeLibrary` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lastUsedIp` VARCHAR(191) NULL,
    ADD COLUMN `publicValue` VARCHAR(191) NULL,
    ADD COLUMN `replacedById` VARCHAR(191) NULL,
    ADD COLUMN `type` ENUM('PERSONAL', 'SECRET', 'PUBLISHABLE') NOT NULL,
    ADD COLUMN `userId` VARCHAR(191) NULL,
    MODIFY `projectId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AccessTokenProject` (
    `tokenId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,

    INDEX `AccessTokenProject_projectId_idx`(`projectId`),
    PRIMARY KEY (`tokenId`, `projectId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actorUserId` VARCHAR(191) NULL,
    `tokenId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `ipAddress` VARCHAR(191) NULL,
    `data` JSON NULL,

    INDEX `AuditEvent_projectId_at_idx`(`projectId`, `at`),
    INDEX `AuditEvent_actorUserId_at_idx`(`actorUserId`, `at`),
    INDEX `AuditEvent_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `AccessToken_userId_idx` ON `AccessToken`(`userId`);

-- CreateIndex
CREATE INDEX `AccessToken_replacedById_idx` ON `AccessToken`(`replacedById`);

-- AddForeignKey
ALTER TABLE `AccessToken` ADD CONSTRAINT `AccessToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessToken` ADD CONSTRAINT `AccessToken_replacedById_fkey` FOREIGN KEY (`replacedById`) REFERENCES `AccessToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessTokenProject` ADD CONSTRAINT `AccessTokenProject_tokenId_fkey` FOREIGN KEY (`tokenId`) REFERENCES `AccessToken`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccessTokenProject` ADD CONSTRAINT `AccessTokenProject_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise de données (ajoutée à la main) : pour les sessions déjà ouvertes, la dernière saisie du
-- mot de passe est la connexion elle-même.
UPDATE `Session` SET `passwordVerifiedAt` = `createdAt`;
