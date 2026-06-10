import { Layout } from "@/components/layout";
import { useListReports, getListReportsQueryKey, useGetReport, useUpdateReportSyncStatus, useUpdateReportStatus, getGetReportQueryKey, getGetReportStatsQueryKey } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { format, differenceInDays } from "date-fns";
import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/auth";
import { useLocation } from "wouter";
import { Search, RefreshCw, X, XCircle, ChevronLeft, ChevronRight, ImageIcon, Lock, ClipboardCheck, AlertTriangle } from "lucide-react";

function SlaBadge({ occurrenceDate }: { occurrenceDate?: string | null }) {
  if (!occurrenceDate) return null;
  const days = differenceInDays(new Date(), new Date(occurrenceDate));
  if (days >= 7) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-600 border border-red-200">
        <AlertTriangle className="h-2.5 w-2.5" />
        {days}일 경과
      </span>
    );
  }
  if (days >= 5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold rounded-full px-2 py-0.5 bg-amber-100 text-amber-600 border border-amber-200">
        <AlertTriangle className="h-2.5 w-2.5" />
        {days}일 경과
      </span>
    );
  }
  return null;
}

const QC_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:           { label: "접수",       cls: "bg-blue-50 text-blue-700 border border-blue-200" },
  IN_REVIEW:      { label: "검토 중",    cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  PENDING_COLLAB: { label: "협업 대기",  cls: "bg-purple-50 text-purple-700 border border-purple-200" },
  RESOLVED:       { label: "조치 완료",  cls: "bg-green-50 text-green-700 border border-green-200" },
  APPROVED:       { label: "승인 완료",  cls: "bg-teal-50 text-teal-700 border border-teal-200" },
  ERP_SYNCED:     { label: "ERP 등록",   cls: "bg-[#F2F4F6] text-[#4E5968] border border-[#E5E8EB]" },
};

const SYNC_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];
const SYNC_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-0 py-3 border-b border-[#F2F4F6] flex justify-between items-start gap-4">
      <span className="text-[12px] text-[#8B95A1] font-medium shrink-0 pt-0.5">{label}</span>
      <span className="text-[13px] font-medium text-[#191F28] text-right">{value || "—"}</span>
    </div>
  );
}

type QcStatus = "OPEN" | "IN_REVIEW" | "PENDING_COLLAB" | "RESOLVED" | "APPROVED" | "ERP_SYNCED";

// ERP_SYNCED는 RPA 성공 시 자동 전이만 — 수동 전이 불가
const TRANSITION_MATRIX: Record<QcStatus, Partial<Record<QcStatus, string[]>>> = {
  OPEN:           { IN_REVIEW: ["admin", "reviewer", "approver"] },
  IN_REVIEW:      { PENDING_COLLAB: ["admin", "reviewer"], RESOLVED: ["admin", "reviewer"], OPEN: ["admin"] },
  PENDING_COLLAB: { RESOLVED: ["admin", "reviewer", "collaborator"], IN_REVIEW: ["admin", "reviewer"] },
  RESOLVED:       { APPROVED: ["admin", "approver"], IN_REVIEW: ["admin", "reviewer"] },
  APPROVED:       {},
  ERP_SYNCED:     {},
};

const TRANSITION_LABELS: Partial<Record<QcStatus, string>> = {
  OPEN:           "접수로 되돌리기",
  IN_REVIEW:      "검토 시작",
  PENDING_COLLAB: "협업 요청",
  RESOLVED:       "조치 완료",
  APPROVED:       "승인",
  ERP_SYNCED:     "ERP 등록",
};

function ReportDetail({ reportId, onClose }: { reportId: number; onClose: () => void }) {
  const { data: report, isLoading } = useGetReport(reportId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const resetRetry = useUpdateReportSyncStatus();
  const updateStatus = useUpdateReportStatus();

  const handleResetRetry = async () => {
    if (!report) return;
    try {
      await resetRetry.mutateAsync({ id: report.id, data: { syncStatus: "PENDING", resetRetry: true } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(report.id) }),
      ]);
      toast({ title: "재시도 초기화 완료", description: "보고서가 PENDING으로 재설정되었습니다." });
    } catch {
      toast({ title: "오류", description: "재시도 초기화에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleTransition = async (to: QcStatus) => {
    if (!report) return;
    try {
      await updateStatus.mutateAsync({ id: report.id, data: { status: to } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(report.id) }),
      ]);
      toast({ title: "상태 변경 완료", description: `${QC_STATUS_BADGE[to]?.label ?? to}(으)로 변경되었습니다.` });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "상태 변경에 실패했습니다.";
      toast({ title: "오류", description: msg, variant: "destructive" });
    }
  };

  const availableTransitions: QcStatus[] = (() => {
    if (!report || !user) return [];
    const from = (report.qcStatus ?? "OPEN") as QcStatus;
    const row = TRANSITION_MATRIX[from] ?? {};
    return (Object.entries(row) as [QcStatus, string[]][])
      .filter(([, roles]) => roles.includes(user.role))
      .map(([to]) => to);
  })();

  if (isLoading) {
    return (
      <div className="p-10 text-center flex flex-col items-center gap-3 text-[#8B95A1]">
        <RefreshCw className="h-5 w-5 animate-spin" />
        <p className="text-[13px]">불러오는 중...</p>
      </div>
    );
  }

  if (!report) {
    return <div className="p-8 text-center text-[13px] text-red-500">보고서를 찾을 수 없습니다.</div>;
  }

  return (
    <div className="py-2">
      {report.isLocked && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <span className="text-[12px] font-semibold text-red-600">SLA 초과 · 수정 잠금</span>
        </div>
      )}

      {report.syncStatus === "FAILED" && (
        <div className="mb-3 rounded-xl bg-orange-50 border border-orange-200 px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <XCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-orange-700">동기화 최종 실패</p>
              {report.syncLastError && (
                <p className="text-[11px] text-orange-500 truncate">{report.syncLastError}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleResetRetry}
            disabled={resetRetry.isPending}
            className="shrink-0 h-7 px-3 rounded-lg bg-[#1A1A1A] text-white text-[11px] font-semibold disabled:opacity-50 flex items-center gap-1"
          >
            {resetRetry.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            재시도
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#F2F4F6] mb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[11px] text-[#8B95A1]">보고서 #{report.id.toString().padStart(4, "0")}</p>
            {report.ncrNumber && (
              <span className="text-[11px] font-bold text-[#4E5968] bg-[#F2F4F6] rounded px-1.5 py-0.5">{report.ncrNumber}</span>
            )}
          </div>
          <h2 className="text-[18px] font-bold text-[#191F28]">{report.itemCode}</h2>
          <p className="text-[13px] text-[#8B95A1] mt-0.5">{report.processName}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status={report.syncStatus} />
          {report.productType && (
            <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${report.productType === "개발" ? "bg-amber-100 text-amber-700" : "bg-[#F2F4F6] text-[#4E5968]"}`}>
              {report.productType}
            </span>
          )}
        </div>
      </div>

      <DetailRow label="접수 일시" value={format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")} />
      <DetailRow label="등록자" value={report.registrantName} />
      <DetailRow label="공장" value={report.factory} />
      <DetailRow label="발행팀" value={report.issuingTeam} />
      <DetailRow label="부적합 구분" value={report.ncrType} />
      {report.actionDirection && (
        <DetailRow label="조치 방향" value={
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[12px] font-semibold">
            {report.actionDirection}
          </span>
        } />
      )}
      <DetailRow label="불량 유형" value={report.defectType} />
      {report.occurrenceDate && (
        <DetailRow label="발생일" value={format(new Date(report.occurrenceDate), "yyyy.MM.dd")} />
      )}
      {report.defectQty != null && (
        <DetailRow label="불량 수량" value={`${report.defectQty}개`} />
      )}
      {report.shipmentUnit && (
        <DetailRow label="출하 단위" value={report.shipmentUnit} />
      )}

      <div className="py-3 border-b border-[#F2F4F6]">
        <p className="text-[12px] text-[#8B95A1] font-medium mb-2">상세 내용</p>
        <p className="text-[13px] leading-relaxed text-[#191F28] whitespace-pre-wrap">
          {report.description || "—"}
        </p>
      </div>

      {report.imageUrl && (
        <div className="mt-3 overflow-hidden rounded-xl border border-[#F2F4F6]">
          <div className="bg-[#F8F9FA] px-3 py-2 flex items-center gap-2 border-b border-[#F2F4F6]">
            <ImageIcon className="h-3.5 w-3.5 text-[#8B95A1]" />
            <span className="text-[11px] text-[#8B95A1]">첨부 사진</span>
          </div>
          <img
            src={report.imageUrl.startsWith("/api") ? report.imageUrl : `/api/storage${report.imageUrl}`}
            alt="불량 사진"
            className="w-full h-auto object-contain max-h-72 bg-white"
          />
        </div>
      )}

      {/* QC 분석 결과 섹션 */}
      {(report.qcStatus || report.qcCorrectiveResult || report.lostManHours != null || report.flawTypeCd) && (
        <div className="mt-4 rounded-xl border border-[#F2F4F6] overflow-hidden">
          <div className="bg-[#F8F9FA] px-3 py-2 flex items-center gap-2 border-b border-[#F2F4F6]">
            <ClipboardCheck className="h-3.5 w-3.5 text-[#8B95A1]" />
            <span className="text-[11px] font-semibold text-[#8B95A1]">QC 분석 결과</span>
            {report.qcStatus && (
              <span className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${QC_STATUS_BADGE[report.qcStatus]?.cls ?? "bg-[#F2F4F6] text-[#8B95A1]"}`}>
                {QC_STATUS_BADGE[report.qcStatus]?.label ?? report.qcStatus}
              </span>
            )}
          </div>
          <div className="px-3">
            {report.flawTypeCd && <DetailRow label="불량유형" value={report.flawTypeCd} />}
            {report.lostManHours != null && <DetailRow label="손실공수" value={`${report.lostManHours}h`} />}
            {report.qcCorrectiveResult && (
              <div className="py-3 border-b border-[#F2F4F6]">
                <p className="text-[12px] text-[#8B95A1] font-medium mb-1.5">조치결과</p>
                <p className="text-[13px] leading-relaxed text-[#191F28] whitespace-pre-wrap">{report.qcCorrectiveResult}</p>
              </div>
            )}
            {report.qcSubmittedAt && (
              <DetailRow label="QC 제출일시" value={format(new Date(report.qcSubmittedAt), "yyyy.MM.dd HH:mm")} />
            )}
          </div>
        </div>
      )}

      {/* 역할별 상태 전이 버튼 */}
      {availableTransitions.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#F2F4F6] overflow-hidden">
          <div className="bg-[#F8F9FA] px-3 py-2 border-b border-[#F2F4F6]">
            <span className="text-[11px] font-semibold text-[#8B95A1]">상태 전이</span>
          </div>
          <div className="px-3 py-3 flex flex-wrap gap-2">
            {availableTransitions.map((to) => (
              <button
                key={to}
                type="button"
                onClick={() => handleTransition(to)}
                disabled={updateStatus.isPending}
                className={`px-4 py-2 rounded-xl text-[13px] font-semibold border transition-all disabled:opacity-50 ${
                  to === "APPROVED" || to === "ERP_SYNCED"
                    ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                    : to === "OPEN"
                    ? "bg-[#F2F4F6] text-[#4E5968] border-[#E5E8EB]"
                    : "bg-white text-[#191F28] border-[#E5E8EB] hover:border-[#1A1A1A]/30"
                }`}
              >
                {TRANSITION_LABELS[to] ?? to}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* QC 분석 입력 버튼: 관리자/검토자/승인자 */}
      {(user?.role === "admin" || user?.role === "reviewer" || user?.role === "approver") && (
        <div className="pt-4">
          <button
            onClick={() => { onClose(); navigate(`/qc/${report.id}`); }}
            className="w-full bg-[#1A1A1A] text-white font-semibold text-[14px] rounded-2xl py-3.5 flex items-center justify-center gap-2"
          >
            <ClipboardCheck className="h-4 w-4" />
            QC 분석 입력
          </button>
        </div>
      )}

      <div className="pt-3 md:hidden">
        <button
          onClick={onClose}
          className="w-full bg-[#F2F4F6] text-[#191F28] font-semibold text-[14px] rounded-2xl py-3.5"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

interface QueryParams {
  page: number;
  pageSize: number;
  syncStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}

export default function LedgerPage() {
  const isMobile = useIsMobile();

  const [syncStatus, setSyncStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  const queryParams = useMemo<QueryParams>(() => {
    const p: QueryParams = { page, pageSize: 20 };
    if (syncStatus !== "all") p.syncStatus = syncStatus;
    if (dateFrom) p.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) p.dateTo = new Date(dateTo + "T23:59:59").toISOString();
    return p;
  }, [syncStatus, dateFrom, dateTo, page]);

  const { data: reportsData, isLoading: isLoadingReports } = useListReports(queryParams, {
    query: { queryKey: getListReportsQueryKey(queryParams), enabled: true },
  });

  const reports = reportsData?.data ?? [];

  const handleReset = () => {
    setSyncStatus("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasFilters = syncStatus !== "all" || dateFrom || dateTo;

  return (
    <Layout>
      <div className="max-w-[1400px] mx-auto px-5 py-5 pb-24">

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pt-1 mb-5">
          <h1 className="text-[20px] font-bold text-[#191F28]">관리대장</h1>
          <p className="text-[12px] text-[#8B95A1]">{format(new Date(), "yyyy년 MM월 dd일 HH:mm")}</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden mb-5">
          <div className="p-4 grid gap-3 grid-cols-1 md:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">동기화 상태</p>
              <Select value={syncStatus} onValueChange={(val) => { setSyncStatus(val); setPage(1); }}>
                <SelectTrigger className="h-9 rounded-xl text-[13px] bg-[#F8F9FA] border-0 focus:ring-0">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">전체</SelectItem>
                  {SYNC_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{SYNC_STATUS_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">시작일</p>
              <input
                type="date"
                className="w-full h-9 rounded-xl text-[13px] bg-[#F8F9FA] border-0 px-3 outline-none text-[#191F28]"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">종료일</p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="flex-1 h-9 rounded-xl text-[13px] bg-[#F8F9FA] border-0 px-3 outline-none text-[#191F28]"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                />
                {hasFilters && (
                  <button
                    onClick={handleReset}
                    className="h-9 px-3 rounded-xl text-[12px] text-[#8B95A1] bg-[#F2F4F6] hover:text-[#191F28] hover:bg-[#E5E8EB] flex items-center gap-1 transition-colors shrink-0"
                  >
                    <X className="w-3 h-3" /> 초기화
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 분할 레이아웃: 목록 + 상세 */}
        <div className="md:flex md:gap-5 md:items-start">

          {/* 목록 열 */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#F2F4F6] flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#191F28]">보고서 목록</span>
                {reportsData?.total !== undefined && (
                  <span className="text-[12px] text-[#8B95A1]">총 {reportsData.total}건</span>
                )}
              </div>

              {isLoadingReports ? (
                <div className="h-56 flex flex-col items-center justify-center text-[#8B95A1] gap-3">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <p className="text-[13px]">불러오는 중...</p>
                </div>
              ) : reports.length === 0 ? (
                <div className="h-56 flex flex-col items-center justify-center text-[#BEC5CC] gap-3">
                  <Search className="h-8 w-8 opacity-40" />
                  <p className="text-[13px]">조건에 맞는 보고서가 없습니다.</p>
                </div>
              ) : isMobile ? (
                <div className="divide-y divide-[#F2F4F6]">
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      className="px-5 py-4 cursor-pointer active:bg-[#F8F9FA] transition-colors"
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-[14px] text-[#191F28]">{report.itemCode}</span>
                            {report.ncrNumber && (
                              <span className="text-[10px] font-bold text-[#4E5968] bg-[#F2F4F6] rounded px-1 py-0.5">{report.ncrNumber}</span>
                            )}
                          </div>
                          <span className="text-[12px] text-[#8B95A1]">{report.processName}</span>
                        </div>
                        <StatusBadge status={report.syncStatus} />
                      </div>
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-[#191F28]">{report.defectType}</span>
                          <SlaBadge occurrenceDate={report.occurrenceDate} />
                        </div>
                        <span className="text-[11px] text-[#8B95A1]">{format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#F8F9FA] hover:bg-[#F8F9FA]">
                        <TableHead className="h-10 text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[130px]">NCR 번호</TableHead>
                        <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[130px]">접수 일시</TableHead>
                        <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[110px]">품목코드</TableHead>
                        <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">공정명</TableHead>
                        <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide hidden lg:table-cell">SLA</TableHead>
                        <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide text-center w-[110px]">상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports.map((report) => (
                        <TableRow
                          key={report.id}
                          className={`cursor-pointer transition-colors border-[#F2F4F6] ${
                            selectedReportId === report.id
                              ? "bg-[#F2F4F6] hover:bg-[#F2F4F6]"
                              : "hover:bg-[#F8F9FA]"
                          }`}
                          onClick={() => setSelectedReportId(report.id)}
                        >
                          <TableCell className="font-mono font-semibold text-[12px] text-[#4E5968]">
                            {report.ncrNumber ?? "—"}
                          </TableCell>
                          <TableCell className="text-[12px] text-[#8B95A1]">
                            {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                          </TableCell>
                          <TableCell className="font-semibold text-[13px] text-[#191F28]">{report.itemCode}</TableCell>
                          <TableCell className="text-[13px] text-[#8B95A1]">{report.processName}</TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <SlaBadge occurrenceDate={report.occurrenceDate} />
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex flex-col items-center gap-1">
                              <StatusBadge status={report.syncStatus} />
                              {report.qcStatus && (
                                <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${QC_STATUS_BADGE[report.qcStatus]?.cls ?? "bg-[#F2F4F6] text-[#8B95A1]"}`}>
                                  {QC_STATUS_BADGE[report.qcStatus]?.label ?? report.qcStatus}
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {reportsData && reportsData.total > reportsData.pageSize && (
                <div className="border-t border-[#F2F4F6] px-5 py-3 flex items-center justify-between">
                  <span className="text-[12px] text-[#8B95A1]">
                    {page} / {Math.ceil(reportsData.total / reportsData.pageSize)} 페이지
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="h-8 w-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center disabled:opacity-40"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      className="h-8 w-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center disabled:opacity-40"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= Math.ceil(reportsData.total / reportsData.pageSize)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 상세 패널: md+ 인라인 표시 */}
          {selectedReportId && (
            <div className="hidden md:flex flex-col w-[400px] xl:w-[440px] shrink-0 sticky top-[78px] bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden max-h-[calc(100vh-100px)]">
              <div className="px-5 py-3.5 border-b border-[#F2F4F6] flex items-center justify-between shrink-0">
                <h2 className="font-bold text-[17px] text-[#191F28]">보고서 상세</h2>
                <button
                  onClick={() => setSelectedReportId(null)}
                  className="h-8 w-8 rounded-xl bg-[#F2F4F6] flex items-center justify-center text-[#4E5968] hover:bg-[#E5E8EB] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-2">
                <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 모바일 Drawer */}
      <Drawer open={selectedReportId !== null && isMobile} onOpenChange={(open) => !open && setSelectedReportId(null)}>
        <DrawerContent className="bg-white rounded-t-3xl">
          <div className="mx-auto w-full max-w-sm px-5 pt-3 pb-10 max-h-[85vh] overflow-y-auto">
            <div className="w-10 h-1 bg-[#E5E8EB] rounded-full mx-auto mb-4"></div>
            <DrawerHeader className="px-0 text-left pb-3 mb-1">
              <DrawerTitle className="font-bold text-[17px] text-[#191F28]">보고서 상세</DrawerTitle>
            </DrawerHeader>
            {selectedReportId && <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
          </div>
        </DrawerContent>
      </Drawer>
    </Layout>
  );
}
