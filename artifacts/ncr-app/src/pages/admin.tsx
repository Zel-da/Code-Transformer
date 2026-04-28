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
import { Activity, Search, RefreshCw, XSquare, Crosshair, FilterX, Clock, CheckSquare, SquareTerminal } from "lucide-react";

const DEFECT_TYPES = ["치수불량", "외관불량", "기능불량", "재료불량", "포장불량", "기타"];
const SYNC_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];

function ReportDetail({ reportId, onClose }: { reportId: number, onClose: () => void }) {
  const { data: report, isLoading } = useGetReport(reportId);

  if (isLoading) {
    return (
      <div className="p-8 text-center font-mono text-primary animate-pulse flex flex-col items-center">
        <RefreshCw className="h-8 w-8 animate-spin mb-4" />
        <div>FETCHING_RECORD_{reportId}...</div>
      </div>
    );
  }

  if (!report) {
    return <div className="p-8 text-destructive font-mono text-center border border-destructive bg-destructive/10">ERR: RECORD_NOT_FOUND</div>;
  }

  return (
    <div className="space-y-6 py-4 font-mono">
      {/* Header Block */}
      <div className="border-b-2 border-border pb-4 flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground tracking-widest mb-1">ID: {report.id.toString().padStart(6, '0')}</div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground uppercase">{report.itemCode}</h2>
          <div className="text-sm mt-1">{report.processName}</div>
        </div>
        <div className="text-right">
          <StatusBadge status={report.syncStatus} />
          <div className="text-xs text-muted-foreground mt-2">{format(new Date(report.reportDate), "yy/MM/dd HH:mm:ss")}</div>
        </div>
      </div>

      {/* Detail Grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6">
        <div className="border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Defect Type</div>
          <div className="font-bold text-destructive text-lg">{report.defectType}</div>
        </div>
        <div className="border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Sync Status</div>
          <div className="font-bold">{report.syncStatus}</div>
        </div>
      </div>

      {/* Description */}
      <div className="border border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center">
          <Crosshair className="h-3 w-3 mr-1" /> Description
        </div>
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap font-sans">
          {report.description || "NO_DATA_PROVIDED"}
        </p>
      </div>

      {/* Evidence */}
      {report.imageUrl && (
        <div className="border border-border bg-card p-1">
          <div className="p-2 border-b border-border bg-muted/50 text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between">
            <span>Evidence.jpg</span>
            <span>ATTACHED</span>
          </div>
          <div className="relative bg-black min-h-[200px] flex items-center justify-center overflow-hidden">
            {/* Scanlines */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.3)_50%)] bg-[length:100%_4px] pointer-events-none z-10"></div>
            <img 
              src={report.imageUrl.startsWith('/api') ? report.imageUrl : `/api/storage${report.imageUrl}`} 
              alt="Defect Evidence" 
              className="w-full h-auto object-contain max-h-80 opacity-90 relative z-0" 
            />
          </div>
        </div>
      )}

      {/* Close Action (Mobile primarily) */}
      <div className="pt-4 md:hidden">
        <Button 
          variant="outline" 
          className="w-full h-12 rounded-none border-2 border-border font-mono font-bold uppercase tracking-widest"
          onClick={onClose}
        >
          [ CLOSE_PANEL ]
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

// Stat Box Component
function StatBox({ title, value, subtitle, icon: Icon, colorClass, borderClass }: any) {
  return (
    <div className={`border-2 ${borderClass} bg-card relative overflow-hidden flex flex-col p-4`}>
      {/* Decorative corner accent */}
      <div className={`absolute top-0 right-0 w-8 h-8 ${colorClass} opacity-20 translate-x-4 -translate-y-4 rotate-45`}></div>
      
      <div className="flex justify-between items-start mb-4 relative z-10">
        <span className="text-xs font-mono font-bold tracking-widest text-muted-foreground uppercase">{title}</span>
        <Icon className={`h-4 w-4 ${colorClass}`} />
      </div>
      <div className="mt-auto relative z-10">
        <div className={`text-4xl font-mono font-bold tracking-tighter ${colorClass}`}>{value}</div>
        {subtitle && <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1">{subtitle}</div>}
      </div>
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
    query: {
      queryKey: getListReportsQueryKey(queryParams),
      enabled: true
    }
  });

  const reports = reportsData?.data ?? [];

  const handleReset = () => {
    setDefectType("all");
    setSyncStatus("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  return (
    <Layout>
      <div className="flex-1 p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto pb-24">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-border pb-4">
          <div>
            <h2 className="text-3xl font-mono font-bold tracking-tighter uppercase text-white flex items-center">
              <Activity className="mr-3 h-6 w-6 text-primary" />
              SYSTEM_OVERVIEW
            </h2>
            <div className="text-sm font-mono text-muted-foreground uppercase tracking-widest mt-1">Live Telemetry & Records</div>
          </div>
          <div className="font-mono text-xs flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              <span className="text-primary">LIVE</span>
            </div>
            <div className="text-muted-foreground">
              {format(new Date(), "yyyy-MM-dd HH:mm:ss")}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBox 
            title="TOTAL_RECORDS" 
            value={stats?.total ?? 0} 
            subtitle={`${stats?.recentCount ?? 0} RECENT (7D)`}
            icon={Activity} 
            colorClass="text-white"
            borderClass="border-border"
          />
          <StatBox 
            title="PENDING_SYNC" 
            value={stats?.bySyncStatus.find(s => s.label === 'PENDING')?.count ?? 0} 
            icon={Clock} 
            colorClass="text-[#f59e0b]"
            borderClass="border-[#f59e0b]/30"
          />
          <StatBox 
            title="SYNC_FAILED" 
            value={stats?.bySyncStatus.find(s => s.label === 'FAILED')?.count ?? 0} 
            icon={XSquare} 
            colorClass="text-[#ef4444]"
            borderClass="border-[#ef4444]/30"
          />
          <StatBox 
            title="SYNC_COMPLETED" 
            value={stats?.bySyncStatus.find(s => s.label === 'COMPLETED')?.count ?? 0} 
            icon={CheckSquare} 
            colorClass="text-[#10b981]"
            borderClass="border-[#10b981]/30"
          />
        </div>

        {/* Control Panel (Filters) */}
        <div className="border-2 border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-4 py-2 flex items-center justify-between">
            <span className="font-mono text-xs font-bold tracking-widest uppercase flex items-center text-muted-foreground">
              <Search className="w-3 h-3 mr-2" /> QUERY_PARAMETERS
            </span>
            <button onClick={handleReset} className="text-[10px] font-mono text-primary hover:text-primary/80 uppercase flex items-center transition-colors">
              <FilterX className="w-3 h-3 mr-1" /> RESET_ALL
            </button>
          </div>
          <div className="p-4 grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            <div className="space-y-2">
              <Label className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Defect_Type</Label>
              <Select value={defectType} onValueChange={(val) => { setDefectType(val); setPage(1); }}>
                <SelectTrigger className="h-10 rounded-none border border-border bg-background font-mono text-sm">
                  <SelectValue placeholder="ANY" />
                </SelectTrigger>
                <SelectContent className="rounded-none border border-border">
                  <SelectItem value="all" className="font-mono text-sm">-- ANY --</SelectItem>
                  {DEFECT_TYPES.map(type => (
                    <SelectItem key={type} value={type} className="font-mono text-sm">{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Sync_Status</Label>
              <Select value={syncStatus} onValueChange={(val) => { setSyncStatus(val); setPage(1); }}>
                <SelectTrigger className="h-10 rounded-none border border-border bg-background font-mono text-sm">
                  <SelectValue placeholder="ANY" />
                </SelectTrigger>
                <SelectContent className="rounded-none border border-border">
                  <SelectItem value="all" className="font-mono text-sm">-- ANY --</SelectItem>
                  {SYNC_STATUSES.map(status => (
                    <SelectItem key={status} value={status} className="font-mono text-sm">{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Date_From</Label>
              <Input
                type="date"
                className="h-10 rounded-none border border-border bg-background font-mono text-sm"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Date_To</Label>
              <Input
                type="date"
                className="h-10 rounded-none border border-border bg-background font-mono text-sm"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </div>

        {/* Data Grid */}
        <div className="border-2 border-border bg-card flex flex-col">
          <div className="border-b border-border bg-muted/30 px-4 py-3 flex items-center justify-between">
            <span className="font-mono text-xs font-bold tracking-widest uppercase flex items-center text-white">
              <span className="w-2 h-2 bg-primary mr-2"></span>
              DATA_GRID
            </span>
            <span className="font-mono text-[10px] text-muted-foreground tracking-widest">
              {reportsData?.total ? `FOUND: ${reportsData.total}` : 'IDLE'}
            </span>
          </div>
          
          <div className="flex-1 p-0">
            {isLoadingReports ? (
              <div className="h-64 flex flex-col items-center justify-center text-primary font-mono opacity-70">
                <RefreshCw className="h-8 w-8 animate-spin mb-4" />
                <span className="tracking-widest text-sm">QUERYING_DATABASE...</span>
              </div>
            ) : reports.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground font-mono opacity-50 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.02)_10px,rgba(255,255,255,0.02)_20px)]">
                <Search className="h-8 w-8 mb-4" />
                <span className="tracking-widest text-sm">NO_MATCHING_RECORDS</span>
              </div>
            ) : isMobile ? (
              <div className="divide-y divide-border">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="p-4 bg-card active:bg-muted/50 cursor-pointer font-mono flex flex-col space-y-3"
                    onClick={() => setSelectedReportId(report.id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="font-bold text-lg text-white leading-none">{report.itemCode}</div>
                      <StatusBadge status={report.syncStatus} />
                    </div>
                    <div className="flex justify-between items-end text-xs text-muted-foreground">
                      <div className="flex flex-col">
                        <span className="uppercase">{report.processName}</span>
                        <span className="text-destructive font-bold">{report.defectType}</span>
                      </div>
                      <span className="opacity-70">{format(new Date(report.reportDate), "yy/MM/dd HH:mm")}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="font-mono border-collapse">
                  <TableHeader className="bg-muted/20 border-b-2 border-border">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[180px] h-12 text-xs font-bold tracking-widest text-muted-foreground">TIMESTAMP</TableHead>
                      <TableHead className="w-[150px] text-xs font-bold tracking-widest text-muted-foreground">ITEM_CODE</TableHead>
                      <TableHead className="text-xs font-bold tracking-widest text-muted-foreground">PROCESS</TableHead>
                      <TableHead className="text-xs font-bold tracking-widest text-muted-foreground">DEFECT</TableHead>
                      <TableHead className="w-[140px] text-xs font-bold tracking-widest text-muted-foreground text-center">STATUS</TableHead>
                      <TableHead className="w-[100px] text-right text-xs font-bold tracking-widest text-muted-foreground pr-4">ACTION</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((report) => (
                      <TableRow 
                        key={report.id} 
                        className="cursor-pointer group border-b border-border/50 hover:bg-primary/5 transition-colors"
                        onClick={() => setSelectedReportId(report.id)}
                      >
                        <TableCell className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                          {format(new Date(report.reportDate), "yy/MM/dd HH:mm:ss")}
                        </TableCell>
                        <TableCell className="font-bold text-white group-hover:text-primary transition-colors">
                          {report.itemCode}
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {report.processName}
                        </TableCell>
                        <TableCell className="text-sm text-destructive">
                          {report.defectType}
                        </TableCell>
                        <TableCell className="text-center">
                          <StatusBadge status={report.syncStatus} />
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <span className="text-[10px] tracking-widest text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                            [VIEW]
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {reportsData && reportsData.total > reportsData.pageSize && (
            <div className="border-t border-border bg-muted/10 p-3 flex justify-between items-center font-mono text-xs">
              <span className="text-muted-foreground uppercase tracking-widest">
                PAGE {page} OF {Math.ceil(reportsData.total / reportsData.pageSize)}
              </span>
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none border-border bg-background hover:bg-muted text-xs h-8 px-4"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  &lt; PREV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none border-border bg-background hover:bg-muted text-xs h-8 px-4"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(reportsData.total / reportsData.pageSize)}
                >
                  NEXT &gt;
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail View Panels */}
      {isMobile ? (
        <Drawer open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <DrawerContent className="bg-background border-t-2 border-border rounded-t-none">
            <div className="mx-auto w-full max-w-sm px-4 pt-2 pb-8 max-h-[85vh] overflow-y-auto">
              <div className="w-12 h-1 bg-border mx-auto mb-4"></div>
              <DrawerHeader className="px-0 text-left border-b border-border pb-2 mb-2">
                <DrawerTitle className="font-mono font-bold tracking-widest uppercase text-primary">RECORD_DETAILS</DrawerTitle>
              </DrawerHeader>
              {selectedReportId && <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <SheetContent className="sm:max-w-md w-full overflow-y-auto bg-background border-l-2 border-border shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
            <SheetHeader className="border-b-2 border-border pb-4 mb-4">
              <SheetTitle className="font-mono font-bold tracking-widest uppercase flex items-center text-primary">
                <SquareTerminal className="w-4 h-4 mr-2" /> RECORD_DETAILS
              </SheetTitle>
            </SheetHeader>
            {selectedReportId && <ReportDetail reportId={selectedReportId} onClose={() => setSelectedReportId(null)} />}
          </SheetContent>
        </Sheet>
      )}

    </Layout>
  );
}
