-- Reprise de données (ajoutée à la main) : l'ancien format de jeton n'a jamais été accepté par aucune API
-- (aucune interface ne permettait d'en créer) ; les éventuelles lignes sont supprimées pour que la
-- colonne obligatoire "type" puisse être ajoutée.
DELETE FROM "AccessToken";

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('PERSONAL', 'SECRET', 'PUBLISHABLE');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "passwordVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "AccessToken" ADD COLUMN     "allProjects" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "environment" TEXT,
ADD COLUMN     "includeLibrary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastUsedIp" TEXT,
ADD COLUMN     "publicValue" TEXT,
ADD COLUMN     "replacedById" TEXT,
ADD COLUMN     "type" "TokenType" NOT NULL,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AccessTokenProject" (
    "tokenId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "AccessTokenProject_pkey" PRIMARY KEY ("tokenId","projectId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "tokenId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ipAddress" TEXT,
    "data" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessTokenProject_projectId_idx" ON "AccessTokenProject"("projectId");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_at_idx" ON "AuditEvent"("projectId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_at_idx" ON "AuditEvent"("actorUserId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE INDEX "AccessToken_userId_idx" ON "AccessToken"("userId");

-- CreateIndex
CREATE INDEX "AccessToken_replacedById_idx" ON "AccessToken"("replacedById");

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "AccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessTokenProject" ADD CONSTRAINT "AccessTokenProject_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AccessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessTokenProject" ADD CONSTRAINT "AccessTokenProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise de données (ajoutée à la main) : pour les sessions déjà ouvertes, la dernière saisie du
-- mot de passe est la connexion elle-même.
UPDATE "Session" SET "passwordVerifiedAt" = "createdAt";
