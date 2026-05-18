import { Layout } from "@/components/layout";
import {
  useListReports,
  useUpdateReport,
  useDeleteReport,
  useTriggerRpa,
  useListItems,
  useSubmitQcAction,
  getListReportsQueryKey,
  getGetReportStatsQueryKey,
  getGetReportQueryKey,
} from "@workspace/api-client-react";
import type { Report, RpaRunResult, UpdateReportBodySyncStatus } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { format } from "date-fns";
import { useState, useEffect, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth, type UserProfile } from "@/contexts/auth";
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
  UserPlus,
  Users,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  KeyRound,
  Power,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

let _onUnauthorized: (() => void) | null = null;

function authHeader(): HeadersInit {
  const token = localStorage.getItem("ncr_auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...authHeader() },
    ...init,
  });
  if (!res.ok) {
    if (res.status === 401 && _onUnauthorized) {
      _onUnauthorized();
    }
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

const FACTORY_OPTIONS_USER = [
  { label: "아산공장", value: "아산", plantCd: "SA00" },
  { label: "화성공장", value: "화성", plantCd: "SH00" },
];

const SYNC_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
const SYNC_STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

const NCR_TYPES = ["공정", "출하", "AS"] as const;
const FACTORY_OPTIONS = ["아산", "화성"] as const;

interface EditForm {
  itemCode: string;
  processName: string;
  defectType: string;
  description: string;
  syncStatus: string;
  registrantName: string;
  ncrType: string;
  factory: string;
  issuingTeam: string;
  defectQty: string;
  lostManHours: string;
  occurrenceDate: string;
  shipmentUnit: string;
}

const EMPTY_EDIT_FORM: EditForm = {
  itemCode: "",
  processName: "",
  defectType: "",
  description: "",
  syncStatus: "",
  registrantName: "",
  ncrType: "",
  factory: "",
  issuingTeam: "",
  defectQty: "",
  lostManHours: "",
  occurrenceDate: "",
  shipmentUnit: "",
};

const BTN_BASE = "rounded-xl font-semibold text-[14px] px-4 py-2.5 transition-all disabled:opacity-50";
const BTN_DARK = `${BTN_BASE} bg-[#1A1A1A] text-white`;
const BTN_GHOST = `${BTN_BASE} bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]`;
const BTN_DANGER = `${BTN_BASE} bg-red-500 text-white hover:bg-red-600`;
const INP = "h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus-visible:ring-0 focus-visible:outline-none placeholder:text-[#BEC5CC]";

interface NewUserForm {
  username: string;
  password: string;
  displayName: string;
  role: "admin" | "worker";
  factory: string;
  deptCd: string;
  processName: string;
}

const EMPTY_USER_FORM: NewUserForm = {
  username: "", password: "", displayName: "", role: "worker",
  factory: "", deptCd: "", processName: "",
};

export default function ManagePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser, logout } = useAuth();

  useEffect(() => {
    _onUnauthorized = logout;
    return () => { _onUnauthorized = null; };
  }, [logout]);

  const [page, setPage] = useState(1);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [originalEditForm, setOriginalEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rpaResult, setRpaResult] = useState<RpaRunResult | null>(null);
  const [rpaRunning, setRpaRunning] = useState(false);

  const [qcActionType, setQcActionType] = useState<"반출" | "수정" | "기타">("반출");
  const [qcActionNote, setQcActionNote] = useState("");

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(EMPTY_USER_FORM);
  const [userSaving, setUserSaving] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [resetPwUser, setResetPwUser] = useState<UserProfile | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetPwSaving, setResetPwSaving] = useState(false);
  const [togglingActiveId, setTogglingActiveId] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await apiJson<UserProfile[]>(`${API}/users`);
      setUsers(data);
    } catch {
      toast({ title: "사용자 목록 불러오기 실패", variant: "destructive" });
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreateUser = async () => {
    const pwRequired = !editingUser;
    if (!newUserForm.username || (pwRequired && !newUserForm.password) || !newUserForm.displayName) {
      toast({ title: "아이디, 이름은 필수입니다" + (pwRequired ? " (신규 계정은 비밀번호도 필수)" : ""), variant: "destructive" });
      return;
    }
    setUserSaving(true);
    try {
      const plantCd = FACTORY_OPTIONS_USER.find(f => f.value === newUserForm.factory)?.plantCd ?? undefined;
      if (editingUser) {
        await apiJson(`${API}/users/${editingUser.id}`, {
          method: "PUT",
          body: JSON.stringify({
            displayName: newUserForm.displayName,
            role: newUserForm.role,
            factory: newUserForm.factory || null,
            plantCd: plantCd ?? null,
            deptCd: newUserForm.deptCd || null,
            processName: newUserForm.processName || null,
            ...(newUserForm.password ? { password: newUserForm.password } : {}),
          }),
        });
        toast({ title: "사용자 정보가 수정되었습니다" });
      } else {
        await apiJson(`${API}/users`, {
          method: "POST",
          body: JSON.stringify({ ...newUserForm, plantCd }),
        });
        toast({ title: "계정이 생성되었습니다" });
      }
      setShowUserDialog(false);
      setNewUserForm(EMPTY_USER_FORM);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "저장 실패", variant: "destructive" });
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUserId) return;
    try {
      await apiJson(`${API}/users/${deletingUserId}`, { method: "DELETE" });
      toast({ title: "계정이 삭제되었습니다" });
      setDeletingUserId(null);
      fetchUsers();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "삭제 실패", variant: "destructive" });
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwUser || !resetPwValue) return;
    if (resetPwValue.length < 4) {
      toast({ title: "비밀번호는 4자 이상이어야 합니다", variant: "destructive" });
      return;
    }
    setResetPwSaving(true);
    try {
      await apiJson(`${API}/users/${resetPwUser.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPwValue }),
      });
      toast({ title: `${resetPwUser.displayName} 계정의 비밀번호가 초기화되었습니다` });
      setResetPwUser(null);
      setResetPwValue("");
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "비밀번호 초기화 실패", variant: "destructive" });
    } finally {
      setResetPwSaving(false);
    }
  };

  const handleToggleActive = async (u: UserProfile) => {
    setTogglingActiveId(u.id);
    try {
      await apiJson(`${API}/users/${u.id}/active`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      toast({ title: u.isActive ? `${u.displayName} 계정이 비활성화되었습니다` : `${u.displayName} 계정이 활성화되었습니다` });
      fetchUsers();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "상태 변경 실패", variant: "destructive" });
    } finally {
      setTogglingActiveId(null);
    }
  };

  const openEditUser = (u: UserProfile) => {
    setEditingUser(u);
    setNewUserForm({
      username: u.username,
      password: "",
      displayName: u.displayName,
      role: u.role,
      factory: u.factory ?? "",
      deptCd: u.deptCd ?? "",
      processName: u.processName ?? "",
    });
    setShowPw(false);
    setShowUserDialog(true);
  };

  const isMobile = useIsMobile();
  const { data: items } = useListItems();
  const { data: reportsData, isLoading } = useListReports({ page, pageSize: 15 }, {
    query: { queryKey: getListReportsQueryKey({ page, pageSize: 15 }) },
  });
  const reports = reportsData?.data ?? [];

  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();
  const triggerRpa = useTriggerRpa();
  const submitQcAction = useSubmitQcAction();

  const invalidateAll = (reportId?: number) => {
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReportStatsQueryKey() });
    if (reportId != null) {
      queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(reportId) });
    }
  };

  const handleQcAction = async () => {
    if (!editingReport) return;
    const actionText = qcActionNote.trim()
      ? `${qcActionType} — ${qcActionNote.trim()}`
      : qcActionType;
    try {
      await submitQcAction.mutateAsync({
        id: editingReport.id,
        data: { qcAction: actionText },
      });
      invalidateAll(editingReport.id);
      closeEditDialog();
      toast({ title: "QC 조치 확정 완료", description: `${actionText}` });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "QC 조치 실패",
        description: "다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  const isDirty = JSON.stringify(editForm) !== JSON.stringify(originalEditForm);

  const openEdit = (report: Report) => {
    const initial: EditForm = {
      itemCode: report.itemCode,
      processName: report.processName,
      defectType: report.defectType,
      description: report.description,
      syncStatus: report.syncStatus,
      registrantName: report.registrantName ?? "",
      ncrType: report.ncrType ?? "",
      factory: report.factory ?? "",
      issuingTeam: report.issuingTeam ?? "",
      defectQty: report.defectQty != null ? String(report.defectQty) : "",
      lostManHours: report.lostManHours != null ? String(report.lostManHours) : "",
      occurrenceDate: report.occurrenceDate ? report.occurrenceDate.slice(0, 10) : "",
      shipmentUnit: report.shipmentUnit ?? "",
    };
    setEditingReport(report);
    setOriginalEditForm(initial);
    setEditForm(initial);
    setConfirmCancel(false);
    setQcActionType("반출");
    setQcActionNote("");
  };

  const closeEditDialog = () => {
    setEditingReport(null);
    setEditForm(EMPTY_EDIT_FORM);
    setOriginalEditForm(EMPTY_EDIT_FORM);
    setConfirmCancel(false);
    setQcActionType("반출");
    setQcActionNote("");
  };

  const handleCloseDialog = () => {
    if (isDirty) setConfirmCancel(true);
    else closeEditDialog();
  };

  const handleSave = async () => {
    if (!editingReport) return;
    try {
      await updateReport.mutateAsync({
        id: editingReport.id,
        data: {
          ...editForm,
          syncStatus: editForm.syncStatus as UpdateReportBodySyncStatus,
          defectQty: editForm.defectQty !== "" ? Number(editForm.defectQty) : null,
          lostManHours: editForm.lostManHours !== "" ? Number(editForm.lostManHours) : null,
          occurrenceDate: editForm.occurrenceDate ? new Date(editForm.occurrenceDate).toISOString() : null,
          registrantName: editForm.registrantName || null,
          ncrType: editForm.ncrType || null,
          factory: editForm.factory || null,
          issuingTeam: editForm.issuingTeam || null,
          shipmentUnit: editForm.shipmentUnit || null,
        },
      });
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

        {/* User Management Section */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="p-1.5 bg-[#F2F4F6] rounded-lg">
              <Users className="h-4 w-4 text-[#4E5968]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-[14px] text-[#191F28]">사용자 계정 관리</h2>
              {!isMobile && <p className="text-[12px] text-[#8B95A1]">직원 계정을 생성하고 프로필을 설정합니다</p>}
            </div>
            <button
              onClick={() => { setEditingUser(null); setNewUserForm(EMPTY_USER_FORM); setShowPw(false); setShowUserDialog(true); }}
              className={`${BTN_DARK} flex items-center gap-1.5 text-[13px] px-3 py-2`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              {isMobile ? "추가" : "계정 추가"}
            </button>
          </div>

          <div className="border-t border-[#F2F4F6]">
            {usersLoading ? (
              <div className="px-5 py-6 text-center text-[13px] text-[#8B95A1]">불러오는 중...</div>
            ) : users.length === 0 ? (
              <div className="px-5 py-6 text-center text-[13px] text-[#8B95A1]">등록된 계정이 없습니다</div>
            ) : (
              <div className="divide-y divide-[#F2F4F6]">
                {users.map((u) => (
                  <div key={u.id} className={`flex items-center gap-3 px-5 py-3 ${!u.isActive ? "opacity-50" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${u.isActive ? "bg-[#F2F4F6] text-[#4E5968]" : "bg-gray-100 text-gray-400"}`}>
                      {u.displayName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[14px] font-semibold ${u.isActive ? "text-[#191F28]" : "text-[#8B95A1]"}`}>{u.displayName}</span>
                        <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${u.role === "admin" ? "bg-[#1A1A1A] text-white" : "bg-[#F2F4F6] text-[#4E5968]"}`}>
                          {u.role === "admin" ? "관리자" : "작업자"}
                        </span>
                        {!u.isActive && (
                          <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-red-100 text-red-500">
                            비활성
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-[#8B95A1] mt-0.5">
                        @{u.username}
                        {u.factory && <span className="ml-2">{u.factory}</span>}
                        {u.processName && <span className="ml-1">· {u.processName}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEditUser(u)}
                        title="계정 수정"
                        className="p-1.5 rounded-lg hover:bg-[#F2F4F6] text-[#8B95A1] hover:text-[#191F28] transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => { setResetPwUser(u); setResetPwValue(""); setShowResetPw(false); }}
                        title="비밀번호 초기화"
                        className="p-1.5 rounded-lg hover:bg-amber-50 text-[#8B95A1] hover:text-amber-600 transition-colors"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      {currentUser?.id !== u.id && (
                        <>
                          <button
                            onClick={() => handleToggleActive(u)}
                            disabled={togglingActiveId === u.id}
                            title={u.isActive ? "계정 비활성화" : "계정 활성화"}
                            className={`p-1.5 rounded-lg transition-colors ${u.isActive ? "hover:bg-orange-50 text-[#8B95A1] hover:text-orange-500" : "hover:bg-emerald-50 text-[#8B95A1] hover:text-emerald-600"}`}
                          >
                            {togglingActiveId === u.id
                              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              : <Power className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => setDeletingUserId(u.id)}
                            title="계정 삭제"
                            className="p-1.5 rounded-lg hover:bg-red-50 text-[#8B95A1] hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RPA Section */}
        <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
          {/* Header — always compact on mobile */}
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="p-1.5 bg-[#F2F4F6] rounded-lg">
              <Bot className="h-4 w-4 text-[#4E5968]" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-[14px] text-[#191F28]">RPA 동기화</h2>
              {!isMobile && (
                <p className="text-[12px] text-[#8B95A1]">대기(PENDING) 상태 보고서를 일괄 처리합니다</p>
              )}
            </div>
            <button
              onClick={handleRpaRun}
              disabled={rpaRunning}
              className={`${BTN_DARK} flex items-center gap-1.5 text-[13px] px-3 py-2`}
            >
              {rpaRunning ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />{!isMobile && " 실행 중..."}</>
              ) : (
                <><Play className="h-3.5 w-3.5" />{isMobile ? "실행" : " RPA 실행"}</>
              )}
            </button>
          </div>

          {rpaResult ? (
            <div className="px-5 pb-5 border-t border-[#F2F4F6] pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-3.5 w-3.5 text-[#4E5968]" />
                <span className="font-semibold text-[12px] text-[#191F28]">실행 결과</span>
              </div>
              <div className="flex gap-2 mb-4">
                <div className="flex-1 bg-[#F8F9FA] rounded-xl p-2.5 text-center">
                  <p className="text-[18px] font-bold text-[#191F28]">{rpaResult.processed}</p>
                  <p className="text-[10px] text-[#8B95A1]">처리</p>
                </div>
                <div className="flex-1 bg-emerald-50 rounded-xl p-2.5 text-center">
                  <p className="text-[18px] font-bold text-emerald-600">{rpaResult.completed}</p>
                  <p className="text-[10px] text-[#8B95A1]">완료</p>
                </div>
                <div className="flex-1 bg-red-50 rounded-xl p-2.5 text-center">
                  <p className="text-[18px] font-bold text-red-500">{rpaResult.failed}</p>
                  <p className="text-[10px] text-[#8B95A1]">실패</p>
                </div>
              </div>
              {rpaResult.reports.length > 0 && (
                <div className="divide-y divide-[#F2F4F6] border border-[#F2F4F6] rounded-xl overflow-hidden">
                  {rpaResult.reports.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 bg-white">
                      <div className="flex items-center gap-2">
                        {r.syncStatus === "COMPLETED" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="font-medium text-[12px] text-[#191F28]">{r.itemCode}</span>
                        <span className="text-[11px] text-[#8B95A1]">{r.defectType}</span>
                      </div>
                      <StatusBadge status={r.syncStatus} />
                    </div>
                  ))}
                </div>
              )}
              {rpaResult.processed === 0 && (
                <p className="text-[12px] text-[#8B95A1] text-center py-2">처리할 대기 보고서가 없습니다.</p>
              )}
            </div>
          ) : !isMobile ? (
            <div className="px-5 py-3 border-t border-[#F2F4F6] text-[13px] text-[#8B95A1]">
              RPA 실행 버튼을 누르면 <span className="font-semibold text-amber-600">대기(PENDING)</span> 상태의 모든 보고서를 자동으로 ERP에 동기화합니다.
            </div>
          ) : null}
        </div>

        {/* Reports Management */}
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
          ) : isMobile ? (
            /* Mobile: compact list rows */
            <div className="divide-y divide-[#F2F4F6]">
              {reports.map((report) => (
                <div key={report.id} className="px-5 py-3.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-[14px] text-[#191F28] truncate">{report.itemCode}</span>
                      <StatusBadge status={report.syncStatus} />
                    </div>
                    <p className="text-[12px] text-[#8B95A1] truncate">
                      {report.processName} · {report.defectType}
                    </p>
                    <p className="text-[11px] text-[#BEC5CC] mt-0.5">
                      {format(new Date(report.reportDate), "yyyy.MM.dd HH:mm")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      className="h-8 w-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center active:bg-[#E5E8EB]"
                      onClick={() => openEdit(report)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="h-8 w-8 rounded-xl bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center active:bg-red-50 active:text-red-400"
                      onClick={() => setDeletingId(report.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop: full table */
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
                          disabled={!!report.isLocked}
                        >
                          <SelectTrigger className="h-8 text-[12px] rounded-lg bg-[#F8F9FA] border-0 w-[120px] focus:ring-0 disabled:opacity-50">
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
          className="sm:max-w-lg rounded-2xl bg-white border border-[#F2F4F6] max-h-[90vh] flex flex-col"
          onEscapeKeyDown={(e) => { e.preventDefault(); handleCloseDialog(); }}
          onPointerDownOutside={(e) => { e.preventDefault(); handleCloseDialog(); }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-bold text-[16px] text-[#191F28] flex items-center gap-2">
              보고서 수정
              {editingReport?.isLocked && (
                <span className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                  <Lock className="h-3 w-3" /> SLA 잠금
                </span>
              )}
              {!editingReport?.isLocked && isDirty && (
                <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  미저장
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            {/* Lock notice */}
            {editingReport?.isLocked && (
              <div className="mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <span className="text-[12px] text-red-600">SLA 초과로 일반 필드 수정이 잠겼습니다. QC 조치만 입력 가능합니다.</span>
              </div>
            )}

            {/* Section: 등록 정보 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest mb-2 mt-1">등록 정보</p>
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">등록자</Label>
                  <Input className={INP} value={editForm.registrantName} placeholder="성명" disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, registrantName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">발행팀</Label>
                  <Input className={INP} value={editForm.issuingTeam} placeholder="팀명" disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, issuingTeam: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-[#8B95A1]">공장</Label>
                <div className="flex gap-2">
                  {FACTORY_OPTIONS.map((f) => (
                    <button key={f} type="button"
                      disabled={!!editingReport?.isLocked}
                      onClick={() => setEditForm((ef) => ({ ...ef, factory: f }))}
                      className={`flex-1 py-2 text-[13px] font-medium rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${editForm.factory === f ? "border-[#1A1A1A] bg-[#1A1A1A] text-white" : "border-[#E5E8EB] text-[#4E5968] bg-[#F8F9FA]"}`}
                    >{f}공장</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Section: 부적합 기본 정보 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest mb-2">부적합 기본 정보</p>
            <div className="space-y-3 mb-4">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-[#8B95A1]">부적합 구분</Label>
                <div className="flex gap-2">
                  {NCR_TYPES.map((t) => (
                    <button key={t} type="button"
                      disabled={!!editingReport?.isLocked}
                      onClick={() => setEditForm((ef) => ({ ...ef, ncrType: t }))}
                      className={`flex-1 py-2 text-[13px] font-medium rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${editForm.ncrType === t ? "border-[#1A1A1A] bg-[#1A1A1A] text-white" : "border-[#E5E8EB] text-[#4E5968] bg-[#F8F9FA]"}`}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">품목코드</Label>
                  <Select value={editForm.itemCode} disabled={!!editingReport?.isLocked} onValueChange={(v) => setEditForm((f) => ({ ...f, itemCode: v }))}>
                    <SelectTrigger className={`h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus:ring-0 focus:outline-none disabled:opacity-50`}>
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
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">공정명</Label>
                  <Input className={INP} value={editForm.processName} disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, processName: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-[#8B95A1]">불량 유형</Label>
                <Input className={INP} value={editForm.defectType} disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, defectType: e.target.value }))} />
              </div>
            </div>

            {/* Section: 수량 / 일정 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest mb-2">수량 및 일정</p>
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">불량 수량</Label>
                  <Input className={INP} type="number" min="0" value={editForm.defectQty} placeholder="0" disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, defectQty: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">Loss 공수 (H)</Label>
                  <Input className={INP} type="number" min="0" step="0.5" value={editForm.lostManHours} placeholder="0" disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, lostManHours: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-[#8B95A1]">출하 단위</Label>
                  <Input className={INP} value={editForm.shipmentUnit} placeholder="예: LOT" disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, shipmentUnit: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-[#8B95A1]">발생일</Label>
                <input type="date" className={`w-full h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] px-3 outline-none disabled:opacity-50`} value={editForm.occurrenceDate} disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, occurrenceDate: e.target.value }))} />
              </div>
            </div>

            {/* Section: 상세 내용 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest mb-2">상세 내용</p>
            <div className="space-y-3 mb-4">
              <Textarea className={`${INP} resize-none`} rows={3} value={editForm.description} disabled={!!editingReport?.isLocked} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
            </div>

            {/* Section: 시스템 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest mb-2">시스템</p>
            <div className="space-y-1 mb-4">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">동기화 상태</Label>
              <Select value={editForm.syncStatus} disabled={!!editingReport?.isLocked} onValueChange={(v) => setEditForm((f) => ({ ...f, syncStatus: v }))}>
                <SelectTrigger className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus:ring-0 focus:outline-none disabled:opacity-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {SYNC_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{SYNC_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Section: QC 조치 확정 (admin only) */}
            {currentUser?.role === "admin" && (
              <>
                <div className="border-t border-[#F2F4F6] pt-4 mb-2">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldCheck className="h-4 w-4 text-[#4E5968]" />
                    <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest">QC 조치 확정</p>
                  </div>

                  {editingReport?.qcAction ? (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-3 mb-2">
                      <p className="text-[11px] font-semibold text-emerald-700 mb-0.5">조치 완료</p>
                      <p className="text-[13px] text-emerald-800 font-medium">{editingReport.qcAction}</p>
                      {editingReport.qcActionAt && (
                        <p className="text-[11px] text-emerald-600 mt-1">
                          {format(new Date(editingReport.qcActionAt), "yyyy.MM.dd HH:mm")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 mb-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-[#8B95A1]">조치 유형</Label>
                        <div className="flex gap-2">
                          {(["반출", "수정", "기타"] as const).map((t) => (
                            <button key={t} type="button"
                              onClick={() => setQcActionType(t)}
                              className={`flex-1 py-2 text-[13px] font-medium rounded-xl border-2 transition-all ${qcActionType === t ? "border-[#1A1A1A] bg-[#1A1A1A] text-white" : "border-[#E5E8EB] text-[#4E5968] bg-[#F8F9FA]"}`}
                            >{t}</button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-[#8B95A1]">상세 내용 (선택)</Label>
                        <Textarea
                          className={`${INP} resize-none`}
                          rows={2}
                          placeholder="조치 상세 내용을 입력하세요"
                          value={qcActionNote}
                          onChange={(e) => setQcActionNote(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleQcAction}
                        disabled={submitQcAction.isPending}
                        className={`w-full ${BTN_DARK} text-[13px] flex items-center justify-center gap-2`}
                      >
                        {submitQcAction.isPending ? (
                          <><RefreshCw className="h-4 w-4 animate-spin" />처리 중...</>
                        ) : (
                          <><ShieldCheck className="h-4 w-4" />QC 조치 확정</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row items-center shrink-0 pt-3 border-t border-[#F2F4F6]">
            <button
              className={`${BTN_GHOST} mr-auto text-[13px]`}
              onClick={() => setEditForm(originalEditForm)}
              disabled={!isDirty || updateReport.isPending || !!editingReport?.isLocked}
            >
              원래대로
            </button>
            <button className={`${BTN_GHOST} text-[13px]`} onClick={handleCloseDialog} disabled={updateReport.isPending}>
              취소
            </button>
            <button
              className={`${BTN_DARK} text-[13px] flex items-center gap-2`}
              onClick={handleSave}
              disabled={updateReport.isPending || !isDirty || !!editingReport?.isLocked}
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

      {/* Delete Report Confirmation */}
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

      {/* User Create / Edit Dialog */}
      <Dialog open={showUserDialog} onOpenChange={(open) => { if (!open) { setShowUserDialog(false); setEditingUser(null); setNewUserForm(EMPTY_USER_FORM); } }}>
        <DialogContent className="rounded-2xl bg-white border border-[#F2F4F6] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-bold text-[#191F28]">
              {editingUser ? "계정 수정" : "계정 추가"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* 기본 정보 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest">기본 정보</p>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">아이디 *</Label>
              <Input
                className={INP}
                value={newUserForm.username}
                onChange={(e) => setNewUserForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="영문+숫자 조합"
                disabled={!!editingUser}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">
                비밀번호 {editingUser ? "(변경 시에만 입력)" : "*"}
              </Label>
              <div className="relative">
                <Input
                  className={`${INP} pr-9`}
                  type={showPw ? "text" : "password"}
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editingUser ? "비워두면 기존 유지" : "비밀번호 입력"}
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8B95A1] hover:text-[#4E5968]"
                  onClick={() => setShowPw((v) => !v)}
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">이름 *</Label>
              <Input
                className={INP}
                value={newUserForm.displayName}
                onChange={(e) => setNewUserForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="실명 입력"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">권한</Label>
              <Select value={newUserForm.role} onValueChange={(v) => setNewUserForm((f) => ({ ...f, role: v as "admin" | "worker" }))}>
                <SelectTrigger className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="worker">작업자</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 프로필 정보 */}
            <p className="text-[10px] font-bold text-[#8B95A1] uppercase tracking-widest pt-1">프로필 (선택)</p>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">공장</Label>
              <Select value={newUserForm.factory} onValueChange={(v) => setNewUserForm((f) => ({ ...f, factory: v }))}>
                <SelectTrigger className="h-9 rounded-xl text-[13px] text-[#191F28] bg-[#F8F9FA] border border-[#E5E8EB] focus:ring-0">
                  <SelectValue placeholder="공장 선택" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {FACTORY_OPTIONS_USER.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-[#8B95A1]">부서코드</Label>
                <Input
                  className={INP}
                  value={newUserForm.deptCd}
                  onChange={(e) => setNewUserForm((f) => ({ ...f, deptCd: e.target.value }))}
                  placeholder="예: D001"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-[#8B95A1]">공정명</Label>
                <Input
                  className={INP}
                  value={newUserForm.processName}
                  onChange={(e) => setNewUserForm((f) => ({ ...f, processName: e.target.value }))}
                  placeholder="예: 도장라인"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-row pt-2 border-t border-[#F2F4F6]">
            <button
              className={`${BTN_GHOST} text-[13px]`}
              onClick={() => { setShowUserDialog(false); setEditingUser(null); setNewUserForm(EMPTY_USER_FORM); }}
              disabled={userSaving}
            >
              취소
            </button>
            <button
              className={`${BTN_DARK} text-[13px] flex items-center gap-2`}
              onClick={handleCreateUser}
              disabled={userSaving}
            >
              {userSaving ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />저장 중...</> : (editingUser ? "수정 완료" : "계정 생성")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={resetPwUser !== null} onOpenChange={(open) => { if (!open) { setResetPwUser(null); setResetPwValue(""); } }}>
        <DialogContent className="rounded-2xl bg-white border border-[#F2F4F6] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-bold text-[#191F28]">비밀번호 초기화</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[#8B95A1]">
              <span className="font-semibold text-[#191F28]">{resetPwUser?.displayName}</span> 계정의 새 비밀번호를 입력하세요.
            </p>
            <div className="space-y-1">
              <Label className="text-[11px] font-semibold text-[#8B95A1]">새 비밀번호 *</Label>
              <div className="relative">
                <Input
                  className={`${INP} pr-9`}
                  type={showResetPw ? "text" : "password"}
                  value={resetPwValue}
                  onChange={(e) => setResetPwValue(e.target.value)}
                  placeholder="4자 이상 입력"
                  onKeyDown={(e) => { if (e.key === "Enter") handleResetPassword(); }}
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8B95A1] hover:text-[#4E5968]"
                  onClick={() => setShowResetPw((v) => !v)}
                >
                  {showResetPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-row pt-2 border-t border-[#F2F4F6]">
            <button
              className={`${BTN_GHOST} text-[13px]`}
              onClick={() => { setResetPwUser(null); setResetPwValue(""); }}
              disabled={resetPwSaving}
            >
              취소
            </button>
            <button
              className={`${BTN_DARK} text-[13px] flex items-center gap-2`}
              onClick={handleResetPassword}
              disabled={resetPwSaving || !resetPwValue}
            >
              {resetPwSaving ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />초기화 중...</> : <><KeyRound className="h-3.5 w-3.5" />비밀번호 초기화</>}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={deletingUserId !== null} onOpenChange={(open) => !open && setDeletingUserId(null)}>
        <AlertDialogContent className="rounded-2xl bg-white border border-[#F2F4F6]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[16px] font-bold text-[#191F28]">계정을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-[#8B95A1]">
              이 작업은 되돌릴 수 없습니다. 해당 계정으로 제출된 보고서는 유지됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl bg-[#F2F4F6] border-0 text-[#4E5968] hover:bg-[#E5E8EB]">취소</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl bg-red-500 text-white hover:bg-red-600" onClick={handleDeleteUser}>
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
