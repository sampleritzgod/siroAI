import type { SourceIndexingStatus } from "@/generated/prisma/client";

export function formatIndexingStatus(status: SourceIndexingStatus): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "PROCESSING":
      return "Processing";
    case "INDEXED":
      return "Indexed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}
