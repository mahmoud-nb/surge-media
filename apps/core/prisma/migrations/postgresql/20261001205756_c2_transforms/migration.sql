-- CreateEnum
CREATE TYPE "TransformPolicy" AS ENUM ('OPEN', 'SIGNED', 'PRESETS');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "transformPolicy" "TransformPolicy" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "TransformPreset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "transformation" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransformPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "TransformPreset_projectId_idx" ON "TransformPreset"("projectId");

-- AddForeignKey
ALTER TABLE "TransformPreset" ADD CONSTRAINT "TransformPreset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
