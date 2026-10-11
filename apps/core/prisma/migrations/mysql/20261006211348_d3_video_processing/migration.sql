-- AlterTable
ALTER TABLE `Media` ADD COLUMN `processingState` ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED') NULL;

-- CreateTable
CREATE TABLE `MediaJob` (
    `id` VARCHAR(191) NOT NULL,
    `mediaId` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `runAfter` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedBy` VARCHAR(191) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `step` VARCHAR(191) NULL,
    `progress` DOUBLE NULL,
    `result` JSON NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorDetail` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `MediaJob_status_runAfter_priority_idx`(`status`, `runAfter`, `priority`),
    INDEX `MediaJob_mediaId_idx`(`mediaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MediaRendition` (
    `id` VARCHAR(191) NOT NULL,
    `mediaId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `container` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `codecs` VARCHAR(191) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `duration` DOUBLE NOT NULL,
    `bitrate` INTEGER NOT NULL,
    `size` INTEGER NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MediaRendition_storageKey_key`(`storageKey`),
    UNIQUE INDEX `MediaRendition_mediaId_name_key`(`mediaId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MediaJob` ADD CONSTRAINT `MediaJob_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `Media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MediaRendition` ADD CONSTRAINT `MediaRendition_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `Media`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
