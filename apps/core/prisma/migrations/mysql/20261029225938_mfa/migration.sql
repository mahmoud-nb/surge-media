-- AlterTable
ALTER TABLE `User` ADD COLUMN `mfaEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `mfaLastStep` INTEGER NULL,
    ADD COLUMN `mfaSecret` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `TrustedDevice` ADD COLUMN `secondFactorAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `MfaRecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MfaRecoveryCode_codeHash_key`(`codeHash`),
    INDEX `MfaRecoveryCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MfaRecoveryCode` ADD CONSTRAINT `MfaRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
