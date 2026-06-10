import { useState } from "react";
import { useLocation } from "wouter";
import { useListReports } from "@workspace/api-client-react";
import type { Report } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { format } from "date-fns";
import { ChevronRight, FlaskConical, RefreshCw } from "lucide-react";

const QC_STATUS_COLORS: Record<string, string> = {
  OPEN:           "bg-blue-50 text-blue-700",
  IN_REVIEW:      "bg-amber-50 text-amber-700",
  PENDING_COLLAB: "bg-purple-50 text-purple-700",
  RESOLVED:       "bg-emerald-50 text-emerald-700",
  APPROVED:       "bg-teal-50 text-teal-700",
  ERP_SYNCED:     "bg-[#F2F4F6] text-[#4E5968]",
};

const QC_STATUS_LABELS: Record<string, string> = {
  OPEN:           "접수",
  IN_REVIEW:      "검토 중",
  PENDING_COLLAB: "협업 대기",
  RESOLVED:       "조치 완료",
  APPROVED:       "승인 완료",
  ERP_SYNCED:     "ERP 등록",
};

type QcStatusEnum = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";
type FilterKey = "미완료" | QcStatusEnum | "전체";

const FILTERS: FilterKey[] = ["미완료", "OPEN", "IN_REVIEW", "PENDING_COLLAB", "RESOLVED", "APPROVED", "전체"];
const FILTER_LABELS: Record<FilterKey, string> = {
  "미완료": "미완료",
  "OPEN": "접수",
  "IN_REVIEW": "검토 중",
  "PENDING_COLLAB": "협업 대기",
  "RESOLVED": "조치 완료",
  "APPROVED": "승인 완료",
  "전체": "전체",
};

function matchesFilter(report: Report, filter: FilterKey): boolean {
  const qs = report.qcStatus ?? null;
  if (filter === "전체") return true;
  if (filter === "미완료") return qs === null || qs === "OPEN" || qs === "IN_REVIEW" || qs === "PENDING_COLLAB";
  return qs === filter;
}

function QcStatusChip({ status }: { status: string | null | undefined }) {
  if (!status) {
    return (
      <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-[#F2F4F6] text-[#BEC5CC]">
        미접수
      </span>
    );
  }
  const cls = QC_STATUS_COLORS[status] ?? "bg-[#F2F4F6] text-[#4E5968]";
  const label = QC_STATUS_LABELS[status] ?? status;
  return (
    <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${cls}`}>
      {label}
    </span>
  );
}

export default function QcListPage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<FilterKey>("미완료");

  const { data: page1, isLoading: l1 } = useListReports({ page: 1, pageSize: 100 });
  const { data: page2, isLoading: l2 } = useListReports({ page: 2, pageSize: 100 });

  const isLoading = l1 || l2;

  const allReports: Report[] = [
    ...(page1?.data ?? []),
    ...(page2?.data ?? []),
  ];

  const filtered = allReports.filter((r) => matchesFilter(r, filter));

  const pendingCount = allReports.filter((r) => matchesFilter(r, "미완료")).length;
  const doneCount = allReports.filter(
    (r) => r.qcStatus === "RESOLVED" || r.qcStatus === "APPROVED" || r.qcStatus === "ERP_SYNCED"
  ).length;

  return (
    <Layout>
      <div className="max-w-[900px] mx-auto px-5 py-5 pb-24 space-y-4">

        {/* 헤더 */}
        <div className="flex items-center gap-3 pt-1">
          <div className="p-2 bg-[#F2F4F6] rounded-xl">
            <FlaskConical className="h-4 w-4 text-[#4E5968]" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-[#191F28]">QC 분석</h1>
            <p className="text-[13px] text-[#8B95A1] mt-0.5">보고서를 선택해 QC 분석 내용을 입력하세요</p>
          </div>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl border border-[#F2F4F6] px-4 py-3 text-center">
            <p className="text-[22px] font-bold text-[#191F28]">{isLoading ? "…" : allReports.length}</p>
            <p className="text-[11px] text-[#8B95A1] mt-0.5">전체 보고서</p>
          </div>
          <div className="bg-amber-50 rounded-2xl border border-amber-100 px-4 py-3 text-center">
            <p className="text-[22px] font-bold text-amber-700">{isLoading ? "…" : pendingCount}</p>
            <p className="text-[11px] text-amber-500 mt-0.5">분석 미완료</p>
          </div>
          <div className="bg-emerald-50 rounded-2xl border border-emerald-100 px-4 py-3 text-center">
            <p className="text-[22px] font-bold text-emerald-700">{isLoading ? "…" : doneCount}</p>
            <p className="text-[11px] text-emerald-500 mt-0.5">조치 완료</p>
          </div>
        </div>

        {/* 필터 */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {FILTERS.map((f) => {
            const count = allReports.filter((r) => matchesFilter(r, f)).length;
            const isActive = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  isActive
                    ? "bg-[#1A1A1A] text-white"
                    : "bg-white border border-[#F2F4F6] text-[#8B95A1] hover:text-[#191F28]"
                }`}
              >
                {FILTER_LABELS[f]}
                {!isLoading && (
                  <span className={`text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${
                    isActive ? "bg-white/20 text-white" : "bg-[#F2F4F6] text-[#4E5968]"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 리스트 */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
          {isLoading ? (
            <div className="h-48 flex flex-col items-center justify-center gap-3 text-[#8B95A1]">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">불러오는 중...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-center">
              <FlaskConical className="h-8 w-8 text-[#BEC5CC]" />
              <p className="text-[14px] font-semibold text-[#191F28]">
                {filter === "미완료" ? "분석 대기 중인 보고서가 없습니다" : `"${FILTER_LABELS[filter]}" 항목이 없습니다`}
              </p>
              <p className="text-[12px] text-[#8B95A1]">다른 필터를 선택해 보세요</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F2F4F6]">
              {filtered.map((report) => (
                <button
                  key={report.id}
                  onClick={() => navigate(`/qc/${report.id}`)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-[#F8F9FA] active:bg-[#F2F4F6] transition-colors text-left"
                >
                  <div className="w-11 h-11 rounded-xl bg-[#F8F9FA] flex items-center justify-center shrink-0">
                    <span className="text-[12px] font-bold text-[#8B95A1]">
                      #{String(report.id).padStart(3, "0")}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-semibold text-[#191F28] truncate">
                        {report.itemCode}
                      </span>
                      {report.ncrType && (
                        <span className="text-[10px] font-semibold bg-[#F2F4F6] text-[#4E5968] rounded px-1.5 py-0.5 shrink-0">
                          {report.ncrType}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#8B95A1] truncate">
                      {[report.processName, report.defectType].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-[11px] text-[#BEC5CC] mt-0.5">
                      {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                      {report.factory && <span className="ml-2">{report.factory}공장</span>}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <QcStatusChip status={report.qcStatus} />
                    <ChevronRight className="h-4 w-4 text-[#BEC5CC]" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {page1 && page1.total > 200 && (
          <p className="text-center text-[12px] text-[#8B95A1]">
            전체 {page1.total}건 중 최근 200건을 표시합니다
          </p>
        )}
      </div>
    </Layout>
  );
}
