-- AlterTable
ALTER TABLE "User" ADD COLUMN "mfaEnabledAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "mfaLastStep" INTEGER;
ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT;

-- AlterTable
ALTER TABLE "TrustedDevice" ADD COLUMN "secondFactorAt" DATETIME;

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");
