import { useListReportAuditLogs } from "@workspace/api-client-react";
import type { AuditLog } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

const QC_STATUS_LABELS: Record<string, string> = {
  OPEN: "접수",
  IN_REVIEW: "검토중",
  PENDING_COLLAB: "협업 검토",
  RESOLVED: "처리완료",
  APPROVED: "승인",
  ERP_SYNCED: "ERP 연동",
};

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  STATUS_CHANGED:      { label: "상태 변경",        color: "bg-blue-50 border-blue-200 text-blue-700",   icon: "🔄" },
  QC_FIELDS_UPDATED:   { label: "QC 정보 수정",     color: "bg-amber-50 border-amber-200 text-amber-700", icon: "✏️" },
  REPORT_UPDATED:      { label: "보고서 수정",       color: "bg-orange-50 border-orange-200 text-orange-700", icon: "📝" },
  QC_ACTION_SUBMITTED: { label: "QC 조치 기록",     color: "bg-green-50 border-green-200 text-green-700", icon: "✅" },
  COMMENT_EDITED:      { label: "댓글 수정",         color: "bg-purple-50 border-purple-200 text-purple-700", icon: "💬" },
  COMMENT_DELETED:     { label: "댓글 삭제",         color: "bg-red-50 border-red-200 text-red-700",      icon: "🗑️" },
};

const FIELD_LABELS: Record<string, string> = {
  qcStatus:            "처리 상태",
  itemCode:            "품목 코드",
  modelName:           "모델명",
  processName:         "공정명",
  processCd:           "공정 코드",
  plantCd:             "공장",
  factory:             "공장명",
  registrantName:      "등록자",
  occurrenceDate:      "발생일",
  defectQty:           "불량 수량",
  description:         "설명",
  actionDirection:     "조치 방향",
  shipmentUnit:        "출하 단위",
  flawTypeCd:          "불량 유형",
  lostManHours:        "손실 공수",
  qcCorrectiveResult:  "시정 결과",
  deptCd:              "부서",
  issuingTeam:         "발행 팀",
  ncrGbnCd:            "NCR 구분",
  vendorCd:            "거래처 코드",
  vendorNm:            "거래처명",
  itemGroup:           "품목 그룹",
  remarks:             "비고",
  managerCd:           "담당자 코드",
  managerNm:           "담당자명",
  qcAction:            "QC 조치 내용",
  body:                "댓글 내용",
  commentId:           "댓글 ID",
  defectType:          "불량 유형명",
  ncrType:             "NCR 유형",
  syncStatus:          "동기화 상태",
};

function formatValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "(없음)";
  if (key === "qcStatus") return QC_STATUS_LABELS[val as string] ?? (val as string);
  if (typeof val === "string") {
    // ISO date → readable
    if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
      try {
        return format(new Date(val), "yyyy-MM-dd HH:mm", { locale: ko });
      } catch { return val; }
    }
    return val || "(비어 있음)";
  }
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "예" : "아니오";
  return JSON.stringify(val);
}

function DiffRow({ fieldKey, before, after }: { fieldKey: string; before: unknown; after: unknown }) {
  const label = FIELD_LABELS[fieldKey] ?? fieldKey;
  const bStr = formatValue(fieldKey, before);
  const aStr = formatValue(fieldKey, after);
  if (bStr === aStr) return null;
  return (
    <div className="grid grid-cols-[140px_1fr_1fr] gap-2 text-[12px] py-1 border-b border-dashed border-[#F2F4F6] last:border-0">
      <span className="text-[#8B95A1] font-medium truncate">{label}</span>
      <span className="text-[#EF4444] bg-red-50 px-2 py-0.5 rounded line-through truncate">{bStr}</span>
      <span className="text-[#22C55E] bg-green-50 px-2 py-0.5 rounded truncate">{aStr}</span>
    </div>
  );
}

function AuditEntry({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_LABELS[log.action] ?? { label: log.action, color: "bg-gray-50 border-gray-200 text-gray-700", icon: "📋" };
  const before = (log.beforeVal ?? {}) as Record<string, unknown>;
  const after = (log.afterVal ?? {}) as Record<string, unknown>;
  const diffKeys = Object.keys({ ...before, ...after }).filter((k) => {
    const bStr = formatValue(k, before[k]);
    const aStr = formatValue(k, after[k]);
    return bStr !== aStr;
  });
  const hasDiff = diffKeys.length > 0;

  return (
    <div className="relative pl-7">
      {/* 타임라인 점 */}
      <span className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white ring-2 ring-[#E5E8EB] bg-white flex items-center justify-center text-[9px] shadow-sm">
        {meta.icon}
      </span>

      <div className={`rounded-xl border px-3 py-2.5 ${meta.color} mb-3`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-[13px] truncate">{meta.label}</span>
            {log.detail && (
              <span className="text-[11px] opacity-75 truncate">— {log.detail}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] opacity-70 whitespace-nowrap">
              {log.actorName} · {format(new Date(log.createdAt), "MM/dd HH:mm", { locale: ko })}
            </span>
            {hasDiff && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-0.5 text-[11px] opacity-70 hover:opacity-100 transition-opacity"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {diffKeys.length}개 항목
              </button>
            )}
          </div>
        </div>

        {hasDiff && expanded && (
          <div className="mt-2 pt-2 border-t border-current/10">
            <div className="grid grid-cols-[140px_1fr_1fr] gap-2 text-[11px] text-current/60 mb-1 px-0">
              <span>항목</span>
              <span>변경 전</span>
              <span>변경 후</span>
            </div>
            {diffKeys.map((k) => (
              <DiffRow key={k} fieldKey={k} before={before[k]} after={after[k]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AuditTimeline({ reportId }: { reportId: number }) {
  const { data: logs, isLoading } = useListReportAuditLogs(reportId);

  return (
    <div className="bg-white rounded-2xl border border-[#E5E8EB] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#F2F4F6] flex items-center gap-2">
        <History className="h-4 w-4 text-[#8B95A1]" />
        <h3 className="text-[14px] font-bold text-[#191F28]">변경 이력</h3>
        {logs && logs.length > 0 && (
          <span className="ml-auto text-[12px] text-[#8B95A1]">총 {logs.length}건</span>
        )}
      </div>

      <div className="px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-[#8B95A1] text-[13px] gap-2">
            <div className="h-4 w-4 rounded-full border-2 border-[#D1D5DB] border-t-[#4E5968] animate-spin" />
            불러오는 중...
          </div>
        ) : !logs || logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <History className="h-8 w-8 text-[#D1D5DB]" />
            <p className="text-[13px] text-[#8B95A1]">아직 변경 이력이 없습니다.</p>
          </div>
        ) : (
          <div className="relative">
            {/* 세로 라인 */}
            <div className="absolute left-[6px] top-2 bottom-2 w-px bg-[#E5E8EB]" />
            {logs.map((log) => (
              <AuditEntry key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
