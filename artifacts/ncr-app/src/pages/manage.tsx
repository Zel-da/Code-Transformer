import { Layout } from "@/components/layout";
import {
  useListReports,
  useUpdateReport,
  useDeleteReport,
  useTriggerRpa,
  useListItems,
  getListReportsQueryKey,
  getGetReportStatsQueryKey,
} from "@workspace/api-client-react";
import type { Report, RpaRunResult } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Settings2,
  Trash2,
  Pencil,
  Play,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Bot,
  Zap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const DEFECT_TYPES = ["치수불량", "외관불량", "기능불량", "재료불량", "포장불량", "기타"];
const SYNC_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
const SYNC_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

interface EditForm {
  itemCode: string;
  processName: string;
  defectType: string;
  description: string;
  syncStatus: string;
}

const EMPTY_EDIT_FORM: EditForm = {
  itemCode: "",
  processName: "",
  defectType: "",
  description: "",
  syncStatus: "",
};

export default function ManagePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [originalEditForm, setOriginalEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rpaResult, setRpaResult] = useState<RpaRunResult | null>(null);
  const [rpaRunning, setRpaRunning] = useState(false);

  const { data: items } = useListItems();
  const { data: reportsData, isLoading } = useListReports({ page, pageSize: 15 }, {
    query: { queryKey: getListReportsQueryKey({ page, pageSize: 15 }) },
  });
  const reports = reportsData?.data ?? [];

  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();
  const triggerRpa = useTriggerRpa();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });
  };

  const isDirty = JSON.stringify(editForm) !== JSON.stringify(originalEditForm);

  const openEdit = (report: Report) => {
    const initial: EditForm = {
      itemCode: report.itemCode,
      processName: report.processName,
      defectType: report.defectType,
      description: report.description,
      syncStatus: report.syncStatus,
    };
    setEditingReport(report);
    setOriginalEditForm(initial);
    setEditForm(initial);
    setConfirmCancel(false);
  };

  const closeEditDialog = () => {
    setEditingReport(null);
    setEditForm(EMPTY_EDIT_FORM);
    setOriginalEditForm(EMPTY_EDIT_FORM);
    setConfirmCancel(false);
  };

  const handleCloseDialog = () => {
    if (isDirty) {
      setConfirmCancel(true);
    } else {
      closeEditDialog();
    }
  };

  const handleReset = () => {
    setEditForm(originalEditForm);
  };

  const handleSave = async () => {
    if (!editingReport) return;
    try {
      await updateReport.mutateAsync({ id: editingReport.id, data: editForm });
      invalidateAll();
      closeEditDialog();
      toast({ title: "수정 완료", description: "보고서가 업데이트되었습니다." });
    } catch {
      toast({ title: "수정 실패", description: "다시 시도해주세요.", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (deletingId === null) return;
    try {
      await deleteReport.mutateAsync({ id: deletingId });
      invalidateAll();
      setDeletingId(null);
      toast({ title: "삭제 완료", description: "보고서가 삭제되었습니다." });
    } catch {
      toast({ title: "삭제 실패", description: "다시 시도해주세요.", variant: "destructive" });
    }
  };

  const handleRpaRun = async () => {
    setRpaRunning(true);
    setRpaResult(null);
    try {
      const result = await triggerRpa.mutateAsync();
      setRpaResult(result);
      invalidateAll();
      toast({
        title: `RPA 실행 완료`,
        description: `${result.processed}건 처리 · 완료 ${result.completed}건 · 실패 ${result.failed}건`,
      });
    } catch {
      toast({ title: "RPA 실행 실패", description: "다시 시도해주세요.", variant: "destructive" });
    } finally {
      setRpaRunning(false);
    }
  };

  const handleStatusChange = async (id: number, syncStatus: string) => {
    try {
      await updateReport.mutateAsync({ id, data: { syncStatus: syncStatus as any } });
      invalidateAll();
      toast({ title: "상태 변경 완료" });
    } catch {
      toast({ title: "상태 변경 실패", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-6 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings2 className="h-6 w-6 text-primary" />
              관리자 패널
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">보고서 수정·삭제 및 RPA 동기화 실행</p>
          </div>
        </div>

        {/* RPA Section */}
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-3">
            <div className="p-2 bg-violet-100 rounded-xl">
              <Bot className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">RPA 동기화 실행</h2>
              <p className="text-xs text-muted-foreground">대기(PENDING) 상태 보고서를 일괄 처리합니다</p>
            </div>
            <div className="ml-auto">
              <Button
                onClick={handleRpaRun}
                disabled={rpaRunning}
                className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl gap-2"
              >
                {rpaRunning ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> 실행 중...</>
                ) : (
                  <><Play className="h-4 w-4" /> RPA 실행</>
                )}
              </Button>
            </div>
          </div>

          {rpaResult && (
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-violet-500" />
                <span className="font-medium text-sm">실행 결과</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold">{rpaResult.processed}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">처리 건수</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{rpaResult.completed}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">완료</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-red-500">{rpaResult.failed}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">실패</p>
                </div>
              </div>
              {rpaResult.reports.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">처리된 보고서</p>
                  <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                    {rpaResult.reports.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-white">
                        <div className="flex items-center gap-3">
                          {r.syncStatus === "COMPLETED" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                          )}
                          <div>
                            <span className="font-medium text-sm">{r.itemCode}</span>
                            <span className="text-xs text-muted-foreground ml-2">{r.defectType}</span>
                          </div>
                        </div>
                        <StatusBadge status={r.syncStatus} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rpaResult.processed === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  처리할 대기 보고서가 없습니다.
                </p>
              )}
            </div>
          )}

          {!rpaResult && (
            <div className="px-5 py-4 text-sm text-muted-foreground">
              RPA 실행 버튼을 누르면 <span className="font-medium text-amber-600">대기(PENDING)</span> 상태의 모든 보고서를 자동으로 ERP에 동기화합니다.
            </div>
          )}
        </div>

        {/* Reports Management Table */}
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground">보고서 관리</h2>
            {reportsData?.total !== undefined && (
              <span className="text-xs text-muted-foreground">총 {reportsData.total}건</span>
            )}
          </div>

          {isLoading ? (
            <div className="h-48 flex items-center justify-center gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">불러오는 중...</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              보고서가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="h-10 text-xs font-semibold text-muted-foreground w-[140px]">접수 일시</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground w-[100px]">품목코드</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground w-[120px]">공정명</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">불량 유형</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground w-[160px]">동기화 상태</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground text-right w-[120px]">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id} className="hover:bg-muted/10">
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                      </TableCell>
                      <TableCell className="font-semibold text-sm">{report.itemCode}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{report.processName}</TableCell>
                      <TableCell className="text-sm font-medium text-destructive">{report.defectType}</TableCell>
                      <TableCell>
                        <Select
                          value={report.syncStatus}
                          onValueChange={(val) => handleStatusChange(report.id, val)}
                        >
                          <SelectTrigger className="h-8 text-xs rounded-lg bg-background border-border w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {SYNC_STATUSES.map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {SYNC_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-primary rounded-lg"
                            onClick={() => openEdit(report)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive rounded-lg"
                            onClick={() => setDeletingId(report.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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

      {/* Edit Dialog */}
      <Dialog open={editingReport !== null} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent className="sm:max-w-lg rounded-2xl" onEscapeKeyDown={(e) => { e.preventDefault(); handleCloseDialog(); }} onPointerDownOutside={(e) => { e.preventDefault(); handleCloseDialog(); }}>
          <DialogHeader>
            <DialogTitle className="font-bold flex items-center gap-2">
              보고서 수정
              {isDirty && (
                <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  미저장 변경 사항
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">품목코드</Label>
                <Select value={editForm.itemCode} onValueChange={(v) => setEditForm((f) => ({ ...f, itemCode: v }))}>
                  <SelectTrigger className="h-9 rounded-xl text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {items?.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        <span className="font-medium text-primary">{item.code}</span>
                        <span className="text-muted-foreground ml-1.5 text-xs">{item.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">공정명</Label>
                <Input
                  className="h-9 rounded-xl text-sm"
                  value={editForm.processName}
                  onChange={(e) => setEditForm((f) => ({ ...f, processName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">불량 유형</Label>
              <div className="grid grid-cols-3 gap-2">
                {DEFECT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, defectType: type }))}
                    className={`py-2 text-sm font-medium rounded-xl border-2 transition-all ${
                      editForm.defectType === type
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">상세 내용</Label>
              <Textarea
                className="rounded-xl resize-none text-sm"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">동기화 상태</Label>
              <Select value={editForm.syncStatus} onValueChange={(v) => setEditForm((f) => ({ ...f, syncStatus: v }))}>
                <SelectTrigger className="h-9 rounded-xl text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {SYNC_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{SYNC_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-row items-center">
            <Button
              variant="ghost"
              className="rounded-xl text-muted-foreground mr-auto"
              onClick={handleReset}
              disabled={!isDirty || updateReport.isPending}
            >
              원래대로
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={handleCloseDialog} disabled={updateReport.isPending}>
              취소
            </Button>
            <Button
              className="rounded-xl"
              onClick={handleSave}
              disabled={updateReport.isPending || !isDirty}
            >
              {updateReport.isPending ? <><RefreshCw className="h-4 w-4 animate-spin mr-2" />저장 중...</> : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation */}
      <AlertDialog open={confirmCancel} onOpenChange={(open) => !open && setConfirmCancel(false)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>변경 사항을 저장하지 않겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              수정한 내용이 저장되지 않고 닫힙니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" onClick={() => setConfirmCancel(false)}>
              계속 수정
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl"
              onClick={closeEditDialog}
            >
              저장하지 않고 닫기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>보고서를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 보고서와 관련된 모든 데이터가 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 rounded-xl"
              onClick={handleDelete}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
