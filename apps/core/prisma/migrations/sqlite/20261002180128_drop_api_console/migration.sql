-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_AccessToken" ("allProjects", "createdAt", "createdById", "environment", "expiresAt", "id", "includeLibrary", "lastUsedAt", "lastUsedIp", "name", "prefix", "projectId", "publicValue", "replacedById", "revokedAt", "scopes", "tokenHash", "type", "userId") SELECT "allProjects", "createdAt", "createdById", "environment", "expiresAt", "id", "includeLibrary", "lastUsedAt", "lastUsedIp", "name", "prefix", "projectId", "publicValue", "replacedById", "revokedAt", "scopes", "tokenHash", "type", "userId" FROM "AccessToken";
DROP TABLE "AccessToken";
ALTER TABLE "new_AccessToken" RENAME TO "AccessToken";
CREATE UNIQUE INDEX "AccessToken_tokenHash_key" ON "AccessToken"("tokenHash");
CREATE INDEX "AccessToken_projectId_idx" ON "AccessToken"("projectId");
CREATE INDEX "AccessToken_userId_idx" ON "AccessToken"("userId");
CREATE INDEX "AccessToken_replacedById_idx" ON "AccessToken"("replacedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
