-- AlterTable
ALTER TABLE `Media` ADD COLUMN `posterHeight` INTEGER NULL,
    ADD COLUMN `posterKey` VARCHAR(191) NULL,
    ADD COLUMN `posterSize` INTEGER NULL,
    ADD COLUMN `posterTime` DOUBLE NULL,
    ADD COLUMN `posterWidth` INTEGER NULL;

-- CreateTable
CREATE TABLE `MediaTextTrack` (
    `id` VARCHAR(191) NOT NULL,
    `mediaId` VARCHAR(191) NOT NULL,
    `kind` ENUM('SUBTITLES', 'CAPTIONS', 'DESCRIPTIONS', 'CHAPTERS') NOT NULL,
    `language` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `storageKey` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `cueCount` INTEGER NOT NULL,
    `sourceFormat` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MediaTextTrack_storageKey_key`(`storageKey`),
    INDEX `MediaTextTrack_mediaId_idx`(`mediaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Media_posterKey_key` ON `Media`(`posterKey`);

-- AddForeignKey
ALTER TABLE `MediaTextTrack` ADD CONSTRAINT `MediaTextTrack_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `Media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
