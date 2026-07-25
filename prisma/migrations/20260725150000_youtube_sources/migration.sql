-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'YOUTUBE';

-- AlterTable
ALTER TABLE "Source" ADD COLUMN "metadata" JSONB;
