-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "uploadSubject" TEXT,
ADD COLUMN     "uploadedByTokenId" TEXT;

-- CreateTable
CREATE TABLE "DelegatedTokenUsage" (
    "jti" TEXT NOT NULL,
    "uploads" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelegatedTokenUsage_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "DelegatedTokenUsage_expiresAt_idx" ON "DelegatedTokenUsage"("expiresAt");

-- CreateIndex
CREATE INDEX "Media_uploadedByTokenId_idx" ON "Media"("uploadedByTokenId");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_uploadedByTokenId_fkey" FOREIGN KEY ("uploadedByTokenId") REFERENCES "AccessToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
