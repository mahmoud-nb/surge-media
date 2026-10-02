-- DropForeignKey
ALTER TABLE "AccessToken" DROP CONSTRAINT "AccessToken_sessionId_fkey";

-- DropIndex
DROP INDEX "AccessToken_sessionId_idx";

-- AlterTable
ALTER TABLE "AccessToken" DROP COLUMN "sessionId";
