-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "invitedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "id", "isActive", "lastLoginAt", "locale", "name", "passwordHash", "role", "updatedAt") SELECT "createdAt", "email", "id", "isActive", "lastLoginAt", "locale", "name", "passwordHash", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_invitedById_idx" ON "User"("invitedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Reprise de données (rôle Gestionnaire) :
-- 1. les développeurs propriétaires d'au moins un projet deviennent gestionnaires (aucune perte de droits) ;
UPDATE "User" SET "role" = 'MANAGER'
WHERE "role" = 'DEVELOPER'
  AND EXISTS (SELECT 1 FROM "ProjectMember" m WHERE m."userId" = "User"."id" AND m."role" = 'OWNER');
-- 2. un gestionnaire est propriétaire de tout projet dont il est membre ;
UPDATE "ProjectMember" SET "role" = 'OWNER'
WHERE "role" <> 'OWNER' AND "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'MANAGER');
-- 3. les autres adhésions sont ramenées au plafond du rôle de plateforme (rôle enregistré = rôle exercé).
UPDATE "ProjectMember" SET "role" = 'DEVELOPER'
WHERE "role" = 'OWNER' AND "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'DEVELOPER');
UPDATE "ProjectMember" SET "role" = 'EDITOR'
WHERE "role" <> 'EDITOR' AND "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'EDITOR');
