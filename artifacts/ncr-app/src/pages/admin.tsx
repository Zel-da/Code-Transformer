import { Layout } from "@/components/layout";
import { useGetReportStats, useListReports, getListReportsQueryKey, useGetReport } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { BarChart3, Search, RefreshCw, X, Clock, CheckCircle2, XCircle, ChevronLeft, ChevronRight, ImageIcon, Lock, FlaskConical } from "lucide-react";

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

function ReportDetail({ reportId, onClose }: { reportId: number; onClose: () => void }) {
  const { data: report, isLoading } = useGetReport(reportId);

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
      {/* Lock Banner */}
      {report.isLocked && (
        <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-red-500 shrink-0" />
          <span className="text-[12px] font-semibold text-red-600">SLA 초과 · 수정 잠금</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-[#F2F4F6] mb-1">
        <div>
          <p className="text-[11px] text-[#8B95A1] mb-1">보고서 #{report.id.toString().padStart(4, "0")}</p>
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

      {/* Fields */}
      <DetailRow label="접수 일시" value={format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")} />
      <DetailRow label="등록자" value={report.registrantName} />
      <DetailRow label="공장" value={report.factory} />
      <DetailRow label="발행팀" value={report.issuingTeam} />
      <DetailRow label="부적합 구분" value={report.ncrType} />
      <DetailRow label="불량 유형" value={report.defectType} />
      {report.occurrenceDate && (
        <DetailRow label="발생일" value={format(new Date(report.occurrenceDate), "yyyy.MM.dd")} />
      )}
      {report.defectQty != null && (
        <DetailRow label="불량 수량" value={`${report.defectQty}개`} />
      )}
      {report.lostManHours != null && (
        <DetailRow label="Loss 공수" value={`${report.lostManHours}H`} />
      )}
      {report.shipmentUnit && (
        <DetailRow label="출하 단위" value={report.shipmentUnit} />
      )}

      {/* Description */}
      <div className="py-3 border-b border-[#F2F4F6]">
        <p className="text-[12px] text-[#8B95A1] font-medium mb-2">상세 내용</p>
        <p className="text-[13px] leading-relaxed text-[#191F28] whitespace-pre-wrap">
          {report.description || "—"}
        </p>
      </div>

      {/* Image */}
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

      <div className="pt-4 md:hidden">
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

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  dot,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ElementType;
  dot?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#F2F4F6] px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-[#8B95A1] font-medium">{title}</span>
        {dot && <span className={`w-2 h-2 rounded-full ${dot}`}></span>}
        {!dot && <Icon className="h-3.5 w-3.5 text-[#BEC5CC]" />}
      </div>
      <div className="text-[22px] font-bold text-[#191F28] tracking-tight leading-tight">{value}</div>
      {subtitle && <div className="text-[10px] text-[#8B95A1] mt-0.5">{subtitle}</div>}
    </div>
  );
}

export default function AdminDashboard() {
  const isMobile = useIsMobile();

  const [syncStatus, setSyncStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  const { data: stats } = useGetReportStats();

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
      <div className="max-w-[1400px] mx-auto px-5 py-5 space-y-5 pb-24">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pt-1">
          <div>
            <h1 className="text-[20px] font-bold text-[#191F28]">대시보드</h1>
          </div>
          <p className="text-[12px] text-[#8B95A1]">{format(new Date(), "yyyy년 MM월 dd일 HH:mm")}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            title="전체 보고서"
            value={stats?.total ?? 0}
            subtitle={`최근 7일 ${stats?.recentCount ?? 0}건`}
            icon={BarChart3}
          />
          <StatCard
            title="동기화 대기"
            value={stats?.bySyncStatus.find((s) => s.label === "PENDING")?.count ?? 0}
            icon={Clock}
            dot="bg-amber-400"
          />
          <StatCard
            title="동기화 실패"
            value={stats?.bySyncStatus.find((s) => s.label === "FAILED")?.count ?? 0}
            icon={XCircle}
            dot="bg-red-400"
          />
          <StatCard
            title="동기화 완료"
            value={stats?.bySyncStatus.find((s) => s.label === "COMPLETED")?.count ?? 0}
            icon={CheckCircle2}
            dot="bg-emerald-400"
          />
          <StatCard
            title="SLA 잠금"
            value={stats?.lockedCount ?? 0}
            icon={Lock}
            dot="bg-slate-400"
          />
          <StatCard
            title="연구소 대기"
            value={stats?.pendingLabCount ?? 0}
            subtitle="개발품 랩 통보 미완료"
            icon={FlaskConical}
            dot="bg-violet-400"
          />
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
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

        {/* Data Table */}
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
                    <div>
                      <span className="font-semibold text-[14px] text-[#191F28]">{report.itemCode}</span>
                      <span className="text-[12px] text-[#8B95A1] ml-2">{report.processName}</span>
                    </div>
                    <StatusBadge status={report.syncStatus} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] font-medium text-[#191F28]">{report.defectType}</span>
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
                    <TableHead className="h-10 text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[160px]">접수 일시</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[120px]">품목코드</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">공정명</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">불량 유형</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide text-center w-[120px]">상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow
                      key={report.id}
                      className="cursor-pointer hover:bg-[#F8F9FA] transition-colors border-[#F2F4F6]"
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <TableCell className="text-[12px] text-[#8B95A1]">
                        {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                      </TableCell>
                      <TableCell className="font-semibold text-[13px] text-[#191F28]">{report.itemCode}</TableCell>
                      <TableCell className="text-[13px] text-[#8B95A1]">{report.processName}</TableCell>
                      <TableCell className="text-[13px] font-medium text-[#191F28]">{report.defectType}</TableCell>
                      <TableCell className="text-center">
                        <StatusBadge status={report.syncStatus} />
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

      {isMobile ? (
        <Drawer open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
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
      ) : (
        <Sheet open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <SheetContent className="sm:max-w-md w-full overflow-y-auto bg-white border-l border-[#F2F4F6]">
            <SheetHeader className="pb-4 mb-2 border-b border-[#F2F4F6]">
              <SheetTitle className="font-bold text-[17px] text-[#191F28]">보고서 상세</SheetTitle>
            </SheetHeader>
            {selectedReportId && <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
          </SheetContent>
        </Sheet>
      )}
    </Layout>
  );
}
