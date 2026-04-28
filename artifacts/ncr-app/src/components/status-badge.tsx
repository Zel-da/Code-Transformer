import { Badge } from "@/components/ui/badge";

type SyncStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export function StatusBadge({ status }: { status: SyncStatus | string }) {
  let classes = "bg-gray-100 text-gray-500 border-gray-200";
  let dot = "bg-gray-400";

  switch (status) {
    case "PENDING":
      classes = "bg-amber-50 text-amber-600 border-amber-200";
      dot = "bg-amber-400";
      break;
    case "PROCESSING":
      classes = "bg-blue-50 text-blue-600 border-blue-200";
      dot = "bg-blue-400";
      break;
    case "COMPLETED":
      classes = "bg-emerald-50 text-emerald-600 border-emerald-200";
      dot = "bg-emerald-400";
      break;
    case "FAILED":
      classes = "bg-red-50 text-red-500 border-red-200";
      dot = "bg-red-400";
      break;
  }

  const statusLabel: Record<string, string> = {
    PENDING: "대기",
    PROCESSING: "처리 중",
    COMPLETED: "완료",
    FAILED: "실패",
  };

  return (
    <Badge
      variant="outline"
      className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap border ${classes} gap-1.5`}
    >
      <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${dot} ${
        (status === "PENDING" || status === "PROCESSING") ? "animate-pulse" : ""
      }`}></span>
      {statusLabel[status] ?? status}
    </Badge>
  );
}
