-- DropForeignKey
ALTER TABLE `AccessToken` DROP FOREIGN KEY `AccessToken_sessionId_fkey`;

-- DropIndex
DROP INDEX `AccessToken_sessionId_idx` ON `AccessToken`;

-- AlterTable
ALTER TABLE `AccessToken` DROP COLUMN `sessionId`;
