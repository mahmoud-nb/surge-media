-- Reprise de données (ajoutée à la main) : l'ancien format de jeton n'a jamais été accepté par aucune API
-- (aucune interface ne permettait d'en créer) ; les éventuelles lignes sont supprimées pour que la
-- colonne obligatoire "type" puisse être ajoutée.
DELETE FROM "AccessToken";

-- CreateTable
CREATE TABLE "AccessTokenProject" (
    "tokenId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    PRIMARY KEY ("tokenId", "projectId"),
    CONSTRAINT "AccessTokenProject_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AccessToken" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessTokenProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "tokenId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ipAddress" TEXT,
    "data" JSONB
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordVerifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("createdAt", "expiresAt", "id", "ipAddress", "lastSeenAt", "tokenHash", "userAgent", "userId") SELECT "createdAt", "expiresAt", "id", "ipAddress", "lastSeenAt", "tokenHash", "userAgent", "userId" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "new_AccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "environment" TEXT,
    "userId" TEXT,
    "allProjects" BOOLEAN NOT NULL DEFAULT false,
    "includeLibrary" BOOLEAN NOT NULL DEFAULT false,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "publicValue" TEXT,
    "scopes" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "lastUsedIp" TEXT,
    "revokedAt" DATETIME,
    "replacedById" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AccessToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "AccessToken" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AccessToken" ("createdAt", "createdById", "expiresAt", "id", "lastUsedAt", "name", "prefix", "projectId", "revokedAt", "scopes", "tokenHash") SELECT "createdAt", "createdById", "expiresAt", "id", "lastUsedAt", "name", "prefix", "projectId", "revokedAt", "scopes", "tokenHash" FROM "AccessToken";
DROP TABLE "AccessToken";
ALTER TABLE "new_AccessToken" RENAME TO "AccessToken";
CREATE UNIQUE INDEX "AccessToken_tokenHash_key" ON "AccessToken"("tokenHash");
CREATE INDEX "AccessToken_projectId_idx" ON "AccessToken"("projectId");
CREATE INDEX "AccessToken_userId_idx" ON "AccessToken"("userId");
CREATE INDEX "AccessToken_replacedById_idx" ON "AccessToken"("replacedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AccessTokenProject_projectId_idx" ON "AccessTokenProject"("projectId");

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_at_idx" ON "AuditEvent"("projectId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_at_idx" ON "AuditEvent"("actorUserId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- Reprise de données (ajoutée à la main) : pour les sessions déjà ouvertes, la dernière saisie du
-- mot de passe est la connexion elle-même.
UPDATE "Session" SET "passwordVerifiedAt" = "createdAt";
