-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
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
    "metadata" JSONB,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Media_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Media" ("altText", "checksum", "createdAt", "deletedAt", "duration", "folderId", "height", "id", "kind", "metadata", "mimeType", "originalName", "projectId", "size", "storageKey", "title", "updatedAt", "uploadedById", "visibility", "width") SELECT "altText", "checksum", "createdAt", "deletedAt", "duration", "folderId", "height", "id", "kind", "metadata", "mimeType", "originalName", "projectId", "size", "storageKey", "title", "updatedAt", "uploadedById", "visibility", "width" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");
CREATE INDEX "Media_projectId_createdAt_idx" ON "Media"("projectId", "createdAt");
CREATE INDEX "Media_projectId_checksum_idx" ON "Media"("projectId", "checksum");
CREATE INDEX "Media_folderId_idx" ON "Media"("folderId");
CREATE INDEX "Media_deletedAt_idx" ON "Media"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
