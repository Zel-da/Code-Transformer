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

const BTN_BASE = "rounded-xl font-semibold text-[14px] px-4 py-2.5 transition-all disabled:opacity-50";
const BTN_DARK = `${BTN_BASE} bg-[#1A1A1A] text-white`;
const BTN_GHOST = `${BTN_BASE} bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]`;
const BTN_DANGER = `${BTN_BASE} bg-red-500 text-white hover:bg-red-600`;

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
    if (isDirty) setConfirmCancel(true);
    else closeEditDialog();
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
        title: "RPA 실행 완료",
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
      <div className="max-w-[1400px] mx-auto px-5 py-5 space-y-5 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <h1 className="text-[20px] font-bold text-[#191F28]">관리자 패널</h1>
            <p className="text-[13px] text-[#8B95A1] mt-0.5">보고서 수정·삭제 및 RPA 동기화 실행</p>
          </div>
        </div>

        {/* RPA Section */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F2F4F6] flex items-center gap-3">
            <div className="p-2 bg-[#F2F4F6] rounded-xl">
              <Bot className="h-5 w-5 text-[#4E5968]" />
            </div>
            <div>
              <h2 className="font-semibold text-[14px] text-[#191F28]">RPA 동기화 실행</h2>
              <p className="text-[12px] text-[#8B95A1]">대기(PENDING) 상태 보고서를 일괄 처리합니다</p>
            </div>
            <div className="ml-auto">
              <button
                onClick={handleRpaRun}
                disabled={rpaRunning}
                className={`${BTN_DARK} flex items-center gap-2`}
              >
                {rpaRunning ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> 실행 중...</>
                ) : (
                  <><Play className="h-4 w-4" /> RPA 실행</>
                )}
              </button>
            </div>
          </div>

          {rpaResult ? (
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-[#4E5968]" />
                <span className="font-semibold text-[13px] text-[#191F28]">실행 결과</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[#F8F9FA] rounded-xl p-3 text-center">
                  <p className="text-[22px] font-bold text-[#191F28]">{rpaResult.processed}</p>
                  <p className="text-[11px] text-[#8B95A1] mt-0.5">처리 건수</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-[22px] font-bold text-emerald-600">{rpaResult.completed}</p>
                  <p className="text-[11px] text-[#8B95A1] mt-0.5">완료</p>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-[22px] font-bold text-red-500">{rpaResult.failed}</p>
                  <p className="text-[11px] text-[#8B95A1] mt-0.5">실패</p>
                </div>
              </div>
              {rpaResult.reports.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">처리된 보고서</p>
                  <div className="divide-y divide-[#F2F4F6] border border-[#F2F4F6] rounded-xl overflow-hidden">
                    {rpaResult.reports.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-white">
                        <div className="flex items-center gap-3">
                          {r.syncStatus === "COMPLETED" ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                          )}
                          <div>
                            <span className="font-medium text-[13px] text-[#191F28]">{r.itemCode}</span>
                            <span className="text-[11px] text-[#8B95A1] ml-2">{r.defectType}</span>
                          </div>
                        </div>
                        <StatusBadge status={r.syncStatus} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rpaResult.processed === 0 && (
                <p className="text-[13px] text-[#8B95A1] text-center py-4">처리할 대기 보고서가 없습니다.</p>
              )}
            </div>
          ) : (
            <div className="px-5 py-4 text-[13px] text-[#8B95A1]">
              RPA 실행 버튼을 누르면 <span className="font-semibold text-amber-600">대기(PENDING)</span> 상태의 모든 보고서를 자동으로 ERP에 동기화합니다.
            </div>
          )}
        </div>

        {/* Reports Management Table */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#F2F4F6] flex items-center justify-between">
            <h2 className="font-semibold text-[13px] text-[#191F28]">보고서 관리</h2>
            {reportsData?.total !== undefined && (
              <span className="text-[12px] text-[#8B95A1]">총 {reportsData.total}건</span>
            )}
          </div>

          {isLoading ? (
            <div className="h-48 flex items-center justify-center gap-3 text-[#8B95A1]">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="text-[13px]">불러오는 중...</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-[13px] text-[#8B95A1]">
              보고서가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F8F9FA] hover:bg-[#F8F9FA]">
                    <TableHead className="h-10 text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[140px]">접수 일시</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[100px]">품목코드</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[120px]">공정명</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">불량 유형</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide w-[150px]">동기화 상태</TableHead>
                    <TableHead className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide text-right w-[100px]">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id} className="hover:bg-[#F8F9FA] border-[#F2F4F6] transition-colors">
                      <TableCell className="text-[12px] text-[#8B95A1]">
                        {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                      </TableCell>
                      <TableCell className="font-semibold text-[13px] text-[#191F28]">{report.itemCode}</TableCell>
                      <TableCell className="text-[13px] text-[#8B95A1]">{report.processName}</TableCell>
                      <TableCell className="text-[13px] font-medium text-[#191F28]">{report.defectType}</TableCell>
                      <TableCell>
                        <Select
                          value={report.syncStatus}
                          onValueChange={(val) => handleStatusChange(report.id, val)}
                        >
                          <SelectTrigger className="h-8 text-[12px] rounded-lg bg-[#F8F9FA] border-0 w-[120px] focus:ring-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {SYNC_STATUSES.map((s) => (
                              <SelectItem key={s} value={s} className="text-[12px]">
                                {SYNC_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="h-8 w-8 rounded-lg bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center hover:bg-[#E5E8EB] transition-colors"
                            onClick={() => openEdit(report)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="h-8 w-8 rounded-lg bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center hover:bg-red-50 hover:text-red-400 transition-colors"
                            onClick={() => setDeletingId(report.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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

      {/* Edit Dialog */}
      <Dialog open={editingReport !== null} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
        <DialogContent
          className="sm:max-w-lg rounded-2xl bg-white border border-[#F2F4F6]"
          onEscapeKeyDown={(e) => { e.preventDefault(); handleCloseDialog(); }}
          onPointerDownOutside={(e) => { e.preventDefault(); handleCloseDialog(); }}
        >
          <DialogHeader>
            <DialogTitle className="font-bold text-[16px] text-[#191F28] flex items-center gap-2">
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
                <Label className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">품목코드</Label>
                <Select value={editForm.itemCode} onValueChange={(v) => setEditForm((f) => ({ ...f, itemCode: v }))}>
                  <SelectTrigger className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus:ring-0 focus:outline-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {items?.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        <span className="font-semibold text-[#191F28]">{item.code}</span>
                        <span className="text-[#8B95A1] ml-1.5 text-[11px]">{item.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">공정명</Label>
                <Input
                  className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus-visible:ring-0 focus-visible:outline-none placeholder:text-[#BEC5CC]"
                  value={editForm.processName}
                  onChange={(e) => setEditForm((f) => ({ ...f, processName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">불량 유형</Label>
              <Input
                className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus-visible:ring-0 focus-visible:outline-none placeholder:text-[#BEC5CC]"
                value={editForm.defectType}
                onChange={(e) => setEditForm((f) => ({ ...f, defectType: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">상세 내용</Label>
              <Textarea
                className="rounded-xl resize-none text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus-visible:ring-0 focus-visible:outline-none placeholder:text-[#BEC5CC]"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-[#8B95A1] uppercase tracking-wide">동기화 상태</Label>
              <Select value={editForm.syncStatus} onValueChange={(v) => setEditForm((f) => ({ ...f, syncStatus: v }))}>
                <SelectTrigger className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus:ring-0 focus:outline-none">
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
            <button
              className={`${BTN_GHOST} mr-auto text-[13px]`}
              onClick={() => setEditForm(originalEditForm)}
              disabled={!isDirty || updateReport.isPending}
            >
              원래대로
            </button>
            <button className={`${BTN_GHOST} text-[13px]`} onClick={handleCloseDialog} disabled={updateReport.isPending}>
              취소
            </button>
            <button
              className={`${BTN_DARK} text-[13px] flex items-center gap-2`}
              onClick={handleSave}
              disabled={updateReport.isPending || !isDirty}
            >
              {updateReport.isPending ? <><RefreshCw className="h-4 w-4 animate-spin" />저장 중...</> : "저장"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation */}
      <AlertDialog open={confirmCancel} onOpenChange={(open) => !open && setConfirmCancel(false)}>
        <AlertDialogContent className="rounded-2xl bg-white border border-[#F2F4F6]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[16px] font-bold text-[#191F28]">변경 사항을 저장하지 않겠습니까?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-[#8B95A1]">
              수정한 내용이 저장되지 않고 닫힙니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl bg-[#F2F4F6] border-0 text-[#4E5968] hover:bg-[#E5E8EB]" onClick={() => setConfirmCancel(false)}>
              계속 수정
            </AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-[#1A1A1A] text-white hover:bg-black" onClick={closeEditDialog}>
              저장하지 않고 닫기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent className="rounded-2xl bg-white border border-[#F2F4F6]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[16px] font-bold text-[#191F28]">보고서를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-[#8B95A1]">
              이 작업은 되돌릴 수 없습니다. 보고서와 관련된 모든 데이터가 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl bg-[#F2F4F6] border-0 text-[#4E5968] hover:bg-[#E5E8EB]">취소</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-red-500 text-white hover:bg-red-600" onClick={handleDelete}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
