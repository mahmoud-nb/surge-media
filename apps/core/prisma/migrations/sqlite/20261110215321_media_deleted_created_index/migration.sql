-- DropIndex
DROP INDEX "Media_deletedAt_idx";

-- CreateIndex
CREATE INDEX "Media_deletedAt_createdAt_idx" ON "Media"("deletedAt", "createdAt");
