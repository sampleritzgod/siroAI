-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "shareEnabledAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "shareBranchId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_shareToken_key" ON "Conversation"("shareToken");
