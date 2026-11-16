-- AlterTable
ALTER TABLE `Media` ADD COLUMN `sourceRef` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Media_projectId_sourceRef_idx` ON `Media`(`projectId`, `sourceRef`);
