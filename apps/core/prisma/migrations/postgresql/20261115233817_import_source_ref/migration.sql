-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "sourceRef" TEXT;

-- CreateIndex
CREATE INDEX "Media_projectId_sourceRef_idx" ON "Media"("projectId", "sourceRef");
