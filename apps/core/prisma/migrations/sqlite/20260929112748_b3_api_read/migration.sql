-- Les colonnes de recherche des médias (searchTitle, searchName, searchAlt) sont remplies au démarrage
-- du serveur (server/plugins/search-backfill.ts) : la suppression des accents n'est pas portable en SQL.

-- CreateTable
CREATE TABLE "CacheRevision" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" DATETIME,
    "publicListing" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("archivedAt", "createdAt", "createdById", "description", "id", "name", "slug", "updatedAt") SELECT "archivedAt", "createdAt", "createdById", "description", "id", "name", "slug", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "folderId" TEXT,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "storageKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" REAL,
    "title" TEXT,
    "altText" TEXT,
    "searchTitle" TEXT,
    "searchName" TEXT NOT NULL DEFAULT '',
    "searchAlt" TEXT,
    "metadata" JSONB,
    "uploadedById" TEXT,
    "duplicatedFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Media_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Media_duplicatedFromId_fkey" FOREIGN KEY ("duplicatedFromId") REFERENCES "Media" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Media" ("altText", "checksum", "createdAt", "deletedAt", "duplicatedFromId", "duration", "folderId", "height", "id", "kind", "metadata", "mimeType", "originalName", "projectId", "size", "storageKey", "title", "updatedAt", "uploadedById", "version", "visibility", "width") SELECT "altText", "checksum", "createdAt", "deletedAt", "duplicatedFromId", "duration", "folderId", "height", "id", "kind", "metadata", "mimeType", "originalName", "projectId", "size", "storageKey", "title", "updatedAt", "uploadedById", "version", "visibility", "width" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");
CREATE INDEX "Media_projectId_deletedAt_createdAt_idx" ON "Media"("projectId", "deletedAt", "createdAt");
CREATE INDEX "Media_projectId_checksum_idx" ON "Media"("projectId", "checksum");
CREATE INDEX "Media_folderId_idx" ON "Media"("folderId");
CREATE INDEX "Media_deletedAt_idx" ON "Media"("deletedAt");
CREATE INDEX "Media_duplicatedFromId_idx" ON "Media"("duplicatedFromId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
