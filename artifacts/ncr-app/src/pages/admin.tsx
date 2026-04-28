import { Layout } from "@/components/layout";
import { useGetReportStats, useListReports, getListReportsQueryKey, useGetReport } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { BarChart3, Search, RefreshCw, X, SlidersHorizontal, Clock, CheckCircle2, XCircle, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";

const DEFECT_TYPES = ["치수불량", "외관불량", "기능불량", "재료불량", "포장불량", "기타"];
const SYNC_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];

const SYNC_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

function ReportDetail({ reportId, onClose }: { reportId: number; onClose: () => void }) {
  const { data: report, isLoading } = useGetReport(reportId);

  if (isLoading) {
    return (
      <div className="p-10 text-center text-muted-foreground flex flex-col items-center gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm">불러오는 중...</p>
      </div>
    );
  }

  if (!report) {
    return <div className="p-8 text-center text-destructive text-sm">보고서를 찾을 수 없습니다.</div>;
  }

  return (
    <div className="space-y-5 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">보고서 #{report.id.toString().padStart(4, "0")}</p>
          <h2 className="text-xl font-bold text-foreground">{report.itemCode}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{report.processName}</p>
        </div>
        <StatusBadge status={report.syncStatus} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-muted/50 rounded-xl p-3">
          <p className="text-[11px] text-muted-foreground mb-1">불량 유형</p>
          <p className="font-semibold text-destructive text-sm">{report.defectType}</p>
        </div>
        <div className="bg-muted/50 rounded-xl p-3">
          <p className="text-[11px] text-muted-foreground mb-1">접수 일시</p>
          <p className="font-medium text-sm text-foreground">{format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}</p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-xl p-4">
        <p className="text-[11px] text-muted-foreground mb-2">상세 내용</p>
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {report.description || "내용 없음"}
        </p>
      </div>

      {report.imageUrl && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="bg-muted/40 px-3 py-2 flex items-center gap-2 border-b border-border">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">첨부 사진</span>
          </div>
          <img
            src={report.imageUrl.startsWith("/api") ? report.imageUrl : `/api/storage${report.imageUrl}`}
            alt="불량 사진"
            className="w-full h-auto object-contain max-h-72 bg-white"
          />
        </div>
      )}

      <div className="pt-2 md:hidden">
        <Button variant="outline" className="w-full" onClick={onClose}>
          닫기
        </Button>
      </div>
    </div>
  );
}

interface QueryParams {
  page: number;
  pageSize: number;
  defectType?: string;
  syncStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground font-medium">{title}</span>
        <div className={`p-2 rounded-xl ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}

export default function AdminDashboard() {
  const isMobile = useIsMobile();

  const [defectType, setDefectType] = useState<string>("all");
  const [syncStatus, setSyncStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  const { data: stats } = useGetReportStats();

  const queryParams = useMemo<QueryParams>(() => {
    const p: QueryParams = { page, pageSize: 20 };
    if (defectType !== "all") p.defectType = defectType;
    if (syncStatus !== "all") p.syncStatus = syncStatus;
    if (dateFrom) p.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) p.dateTo = new Date(dateTo + "T23:59:59").toISOString();
    return p;
  }, [defectType, syncStatus, dateFrom, dateTo, page]);

  const { data: reportsData, isLoading: isLoadingReports } = useListReports(queryParams, {
    query: { queryKey: getListReportsQueryKey(queryParams), enabled: true },
  });

  const reports = reportsData?.data ?? [];

  const handleReset = () => {
    setDefectType("all");
    setSyncStatus("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasFilters = defectType !== "all" || syncStatus !== "all" || dateFrom || dateTo;

  return (
    <Layout>
      <div className="flex-1 p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto pb-24">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              대시보드
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">부적합 보고서 현황 및 관리</p>
          </div>
          <p className="text-xs text-muted-foreground">{format(new Date(), "yyyy년 MM월 dd일 HH:mm")}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <StatCard
            title="전체 보고서"
            value={stats?.total ?? 0}
            subtitle={`최근 7일 ${stats?.recentCount ?? 0}건`}
            icon={BarChart3}
            color="bg-primary/10 text-primary"
          />
          <StatCard
            title="동기화 대기"
            value={stats?.bySyncStatus.find((s) => s.label === "PENDING")?.count ?? 0}
            icon={Clock}
            color="bg-amber-100 text-amber-500"
          />
          <StatCard
            title="동기화 실패"
            value={stats?.bySyncStatus.find((s) => s.label === "FAILED")?.count ?? 0}
            icon={XCircle}
            color="bg-red-100 text-red-500"
          />
          <StatCard
            title="동기화 완료"
            value={stats?.bySyncStatus.find((s) => s.label === "COMPLETED")?.count ?? 0}
            icon={CheckCircle2}
            color="bg-emerald-100 text-emerald-500"
          />
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
              필터
            </span>
            {hasFilters && (
              <button
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <X className="w-3 h-3" /> 초기화
              </button>
            )}
          </div>
          <div className="p-4 grid gap-3 grid-cols-2 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">불량 유형</Label>
              <Select value={defectType} onValueChange={(val) => { setDefectType(val); setPage(1); }}>
                <SelectTrigger className="h-9 rounded-lg text-sm bg-background">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">전체</SelectItem>
                  {DEFECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">동기화 상태</Label>
              <Select value={syncStatus} onValueChange={(val) => { setSyncStatus(val); setPage(1); }}>
                <SelectTrigger className="h-9 rounded-lg text-sm bg-background">
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
              <Label className="text-xs font-medium text-muted-foreground">시작일</Label>
              <Input
                type="date"
                className="h-9 rounded-lg text-sm bg-background"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">종료일</Label>
              <Input
                type="date"
                className="h-9 rounded-lg text-sm bg-background"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">보고서 목록</span>
            {reportsData?.total !== undefined && (
              <span className="text-xs text-muted-foreground">총 {reportsData.total}건</span>
            )}
          </div>

          {isLoadingReports ? (
            <div className="h-56 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm">불러오는 중...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="h-56 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Search className="h-8 w-8 opacity-30" />
              <p className="text-sm">조건에 맞는 보고서가 없습니다.</p>
            </div>
          ) : isMobile ? (
            <div className="divide-y divide-border">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors active:bg-muted/50"
                  onClick={() => setSelectedReportId(report.id)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="font-semibold text-foreground">{report.itemCode}</span>
                      <span className="text-sm text-muted-foreground ml-2">{report.processName}</span>
                    </div>
                    <StatusBadge status={report.syncStatus} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-destructive font-medium">{report.defectType}</span>
                    <span className="text-xs text-muted-foreground">{format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground w-[160px]">접수 일시</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground w-[120px]">품목코드</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">공정명</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">불량 유형</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground text-center w-[120px]">상태</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow
                      key={report.id}
                      className="cursor-pointer hover:bg-muted/20 transition-colors"
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                      </TableCell>
                      <TableCell className="font-semibold text-sm">{report.itemCode}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{report.processName}</TableCell>
                      <TableCell className="text-sm font-medium text-destructive">{report.defectType}</TableCell>
                      <TableCell className="text-center">
                        <StatusBadge status={report.syncStatus} />
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <span className="text-xs text-primary opacity-0 group-hover:opacity-100">보기</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {reportsData && reportsData.total > reportsData.pageSize && (
            <div className="border-t border-border px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {page} / {Math.ceil(reportsData.total / reportsData.pageSize)} 페이지
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 rounded-lg"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 rounded-lg"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= Math.ceil(reportsData.total / reportsData.pageSize)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isMobile ? (
        <Drawer open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <DrawerContent className="bg-background rounded-t-3xl">
            <div className="mx-auto w-full max-w-sm px-5 pt-3 pb-10 max-h-[85vh] overflow-y-auto">
              <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4"></div>
              <DrawerHeader className="px-0 text-left pb-3 mb-1">
                <DrawerTitle className="font-bold text-lg">보고서 상세</DrawerTitle>
              </DrawerHeader>
              {selectedReportId && <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <SheetContent className="sm:max-w-md w-full overflow-y-auto bg-background border-l border-border shadow-xl">
            <SheetHeader className="pb-4 mb-2 border-b border-border">
              <SheetTitle className="font-bold text-lg">보고서 상세</SheetTitle>
            </SheetHeader>
            {selectedReportId && <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
          </SheetContent>
        </Sheet>
      )}
    </Layout>
  );
}
