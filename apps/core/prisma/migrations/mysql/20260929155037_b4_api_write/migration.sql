-- AlterTable
ALTER TABLE `Media` ADD COLUMN `uploadSubject` VARCHAR(191) NULL,
    ADD COLUMN `uploadedByTokenId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `DelegatedTokenUsage` (
    `jti` VARCHAR(191) NOT NULL,
    `uploads` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `DelegatedTokenUsage_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`jti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Media_uploadedByTokenId_idx` ON `Media`(`uploadedByTokenId`);

-- AddForeignKey
ALTER TABLE `Media` ADD CONSTRAINT `Media_uploadedByTokenId_fkey` FOREIGN KEY (`uploadedByTokenId`) REFERENCES `AccessToken`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
