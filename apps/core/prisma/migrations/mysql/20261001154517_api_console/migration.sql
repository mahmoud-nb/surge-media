-- AlterTable
ALTER TABLE `AccessToken` ADD COLUMN `sessionId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `AccessToken_sessionId_idx` ON `AccessToken`(`sessionId`);

-- AddForeignKey
ALTER TABLE `AccessToken` ADD CONSTRAINT `AccessToken_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
