import { Layout } from "@/components/layout";
import { useGetReportStats, useListReports, getListReportsQueryKey, useGetReport } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { FileText, CheckCircle2, Clock, XCircle } from "lucide-react";

const DEFECT_TYPES = ["치수불량", "외관불량", "기능불량", "재료불량", "포장불량", "기타"];
const SYNC_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"];

function ReportDetail({ reportId }: { reportId: number }) {
  const { data: report, isLoading } = useGetReport(reportId);

  if (isLoading) {
    return <div className="p-4">Loading details...</div>;
  }

  if (!report) {
    return <div className="p-4 text-destructive">Failed to load report.</div>;
  }

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between">
        <StatusBadge status={report.syncStatus} />
        <span className="text-sm text-muted-foreground">{format(new Date(report.reportDate), "yyyy-MM-dd HH:mm")}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <Label className="text-muted-foreground">Item Code</Label>
          <div className="font-mono mt-1 font-medium">{report.itemCode}</div>
        </div>
        <div>
          <Label className="text-muted-foreground">Process</Label>
          <div className="mt-1 font-medium">{report.processName}</div>
        </div>
        <div>
          <Label className="text-muted-foreground">Defect Type</Label>
          <div className="mt-1 font-medium">{report.defectType}</div>
        </div>
        <div>
          <Label className="text-muted-foreground">ID</Label>
          <div className="mt-1 font-mono">{report.id}</div>
        </div>
      </div>

      <div>
        <Label className="text-muted-foreground">Description</Label>
        <p className="mt-2 text-sm leading-relaxed border p-3 rounded-md bg-muted/50">
          {report.description || "No description provided."}
        </p>
      </div>

      {report.imageUrl && (
        <div>
          <Label className="text-muted-foreground mb-2 block">Attached Evidence</Label>
          <div className="rounded-md overflow-hidden border">
            <img src={report.imageUrl.startsWith('/api') ? report.imageUrl : `/api/storage${report.imageUrl}`} alt="Defect Evidence" className="w-full h-auto object-contain max-h-64 bg-black/5" />
          </div>
        </div>
      )}
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
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        </div>

        {/* Stats Row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.recentCount ?? 0} in last 7 days
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Sync</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats?.bySyncStatus.find(s => s.label === 'PENDING')?.count ?? 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Failed Sync</CardTitle>
              <XCircle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats?.bySyncStatus.find(s => s.label === 'FAILED')?.count ?? 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats?.bySyncStatus.find(s => s.label === 'COMPLETED')?.count ?? 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label>Defect Type</Label>
              <Select value={defectType} onValueChange={(val) => { setDefectType(val); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {DEFECT_TYPES.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sync Status</Label>
              <Select value={syncStatus} onValueChange={(val) => { setSyncStatus(val); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {SYNC_STATUSES.map(status => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-2">
              <Label>Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-2 flex items-end">
              <Button variant="outline" onClick={handleReset} className="w-full">
                Reset Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Data Grid */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Non-Conformity Reports</CardTitle>
            <CardDescription>
              Recent reports from the production floor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingReports ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground">Loading reports...</div>
            ) : reports.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-muted-foreground border border-dashed rounded-md">No reports found matching filters.</div>
            ) : isMobile ? (
              <div className="space-y-4">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="border rounded-lg p-4 space-y-3 bg-card shadow-sm cursor-pointer active:bg-muted/50 transition-colors"
                    onClick={() => setSelectedReportId(report.id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="font-medium">{report.itemCode}</div>
                      <StatusBadge status={report.syncStatus} />
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{report.defectType}</span>
                      <span>{format(new Date(report.reportDate), "MMM d, HH:mm")}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Process</TableHead>
                      <TableHead>Defect Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((report) => (
                      <TableRow key={report.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedReportId(report.id)}>
                        <TableCell className="font-mono text-xs">{format(new Date(report.reportDate), "yyyy-MM-dd HH:mm")}</TableCell>
                        <TableCell className="font-medium">{report.itemCode}</TableCell>
                        <TableCell>{report.processName}</TableCell>
                        <TableCell>{report.defectType}</TableCell>
                        <TableCell>
                          <StatusBadge status={report.syncStatus} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm">View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination Controls */}
            {reportsData && reportsData.total > reportsData.pageSize && (
              <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {Math.ceil(reportsData.total / reportsData.pageSize)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(reportsData.total / reportsData.pageSize)}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isMobile ? (
        <Drawer open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <DrawerContent>
            <div className="mx-auto w-full max-w-sm px-4 pt-4 pb-8 max-h-[85vh] overflow-y-auto">
              <DrawerHeader className="px-0 text-left">
                <DrawerTitle>Report Details</DrawerTitle>
                <DrawerDescription>Full information for this non-conformity report.</DrawerDescription>
              </DrawerHeader>
              {selectedReportId && <ReportDetail reportId={selectedReportId} />}
              <Button className="w-full mt-6" variant="outline" onClick={() => setSelectedReportId(null)}>Close</Button>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={selectedReportId !== null} onOpenChange={(open) => !open && setSelectedReportId(null)}>
          <SheetContent className="sm:max-w-md w-full overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Report Details</SheetTitle>
              <SheetDescription>Full information for this non-conformity report.</SheetDescription>
            </SheetHeader>
            {selectedReportId && <ReportDetail reportId={selectedReportId} />}
          </SheetContent>
        </Sheet>
      )}

    </Layout>
  );
}
