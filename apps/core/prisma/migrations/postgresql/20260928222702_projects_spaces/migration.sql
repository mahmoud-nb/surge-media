-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'DEVELOPER', 'EDITOR');

-- DropForeignKey
ALTER TABLE "Media" DROP CONSTRAINT "Media_projectId_fkey";

-- DropIndex
DROP INDEX "Media_projectId_createdAt_idx";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Folder" ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "duplicatedFromId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE INDEX "Media_projectId_deletedAt_createdAt_idx" ON "Media"("projectId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Media_duplicatedFromId_idx" ON "Media"("duplicatedFromId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_duplicatedFromId_fkey" FOREIGN KEY ("duplicatedFromId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise de données (ajoutée à la main) : les médias du projet technique « default »
-- (utilisé avant l'écran Projets) rejoignent la bibliothèque de l'organisation, puis ce
-- projet est supprimé (aucune clé d'API ni origine n'a pu y être créée).
UPDATE "Media" SET "projectId" = NULL WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "slug" = 'default');
UPDATE "Folder" SET "projectId" = NULL WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "slug" = 'default');
DELETE FROM "Project" WHERE "slug" = 'default';
