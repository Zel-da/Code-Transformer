import { useState, useRef, useCallback } from "react";
import { Layout } from "@/components/layout";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  MessageCircle,
  Paperclip,
  X,
  Pencil,
  Trash2,
  ImageIcon,
  FileText,
  Send,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

// ─── types ────────────────────────────────────────────────────────

interface Attachment {
  url: string;
  name: string;
  mimeType: string;
}

interface FeedbackItem {
  id: number;
  title: string;
  authorId: number;
  authorName: string | null;
  status: string;
  attachmentCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FeedbackComment {
  id: number;
  feedbackId: number;
  authorId: number;
  authorName: string | null;
  content: string;
  isAdminReply: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FeedbackDetail extends Omit<FeedbackItem, "attachmentCount"> {
  content: string;
  attachments: Attachment[];
  comments: FeedbackComment[];
}

// ─── constants ────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "", label: "전체" },
  { value: "OPEN", label: "대기" },
  { value: "IN_PROGRESS", label: "작업중" },
  { value: "RESOLVED", label: "완료" },
  { value: "CLOSED", label: "종료" },
] as const;

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  OPEN:        { label: "대기",    color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  IN_PROGRESS: { label: "작업중", color: "bg-blue-100 text-blue-800 border-blue-200" },
  RESOLVED:    { label: "완료",    color: "bg-green-100 text-green-800 border-green-200" },
  CLOSED:      { label: "종료",    color: "bg-gray-100 text-gray-600 border-gray-200" },
};

// ─── api helpers ─────────────────────────────────────────────────

async function apiJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem("ncr_auth_token");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
  if (res.status === 204) return undefined as unknown as T;
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "요청 실패");
  return json as T;
}

async function uploadFile(file: File): Promise<Attachment> {
  // 1. request presigned URL
  const { uploadURL, objectPath } = await apiJson<{
    uploadURL: string;
    objectPath: string;
  }>(`${API}/storage/uploads/request-url`, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });

  // 2. PUT file directly
  await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  return {
    url: objectPath,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
  };
}

function fileServingUrl(objectPath: string): string {
  // objectPath = /objects/uploads/uuid  →  /api/storage/objects/uploads/uuid
  const stripped = objectPath.startsWith("/objects/")
    ? objectPath.slice("/objects/".length)
    : objectPath;
  return `${API}/storage/objects/${stripped}`;
}

// ─── sub-components ───────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {attachments.map((a, i) => {
        const isImage = a.mimeType.startsWith("image/");
        const url = fileServingUrl(a.url);
        if (isImage) {
          return (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={a.name}
                className="h-20 w-20 object-cover rounded-lg border border-[#E5E8EB] hover:opacity-90 transition-opacity"
              />
            </a>
          );
        }
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E8EB] text-sm text-[#191F28] hover:bg-[#F2F4F6] transition-colors"
          >
            <FileText className="h-4 w-4 text-[#8B95A1]" />
            <span className="max-w-[160px] truncate">{a.name}</span>
          </a>
        );
      })}
    </div>
  );
}

function FileUploadArea({
  attachments,
  onAdd,
  onRemove,
  uploading,
}: {
  attachments: Attachment[];
  onAdd: (files: FileList) => void;
  onRemove: (i: number) => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-sm text-[#6B7684] hover:text-[#191F28] transition-colors disabled:opacity-50"
        >
          <Paperclip className="h-4 w-4" />
          {uploading ? "업로드 중…" : "파일/사진 첨부"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
          className="hidden"
          onChange={(e) => e.target.files && onAdd(e.target.files)}
        />
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {attachments.map((a, i) => {
            const isImage = a.mimeType.startsWith("image/");
            const url = a.url.startsWith("/objects/")
              ? fileServingUrl(a.url)
              : "";
            return (
              <div key={i} className="relative group">
                {isImage && url ? (
                  <img
                    src={url}
                    alt={a.name}
                    className="h-16 w-16 object-cover rounded-lg border border-[#E5E8EB]"
                  />
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E8EB] text-sm text-[#191F28] bg-[#F8F9FA]">
                    <FileText className="h-4 w-4 text-[#8B95A1]" />
                    <span className="max-w-[120px] truncate">{a.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center h-4 w-4 rounded-full bg-[#FF4444] text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── create/edit modal ────────────────────────────────────────────

function FeedbackFormModal({
  open,
  onClose,
  existing,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  existing?: FeedbackDetail | null;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(
    existing?.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFiles = useCallback(async (files: FileList) => {
    setUploading(true);
    try {
      const results = await Promise.all(Array.from(files).map(uploadFile));
      setAttachments((prev) => [...prev, ...results]);
    } catch {
      toast({ title: "업로드 실패", description: "파일 업로드에 실패했습니다.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const handleSubmit = async () => {
    if (!title.trim()) { toast({ title: "제목을 입력해주세요", variant: "destructive" }); return; }
    if (!content.trim()) { toast({ title: "내용을 입력해주세요", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (existing) {
        await apiJson(`${API}/feedback/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify({ title: title.trim(), content: content.trim(), attachments }),
        });
        toast({ title: "수정 완료" });
      } else {
        await apiJson(`${API}/feedback`, {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), content: content.trim(), attachments }),
        });
        toast({ title: "피드백이 등록됐습니다" });
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: "오류", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg w-full rounded-2xl bg-white text-[#191F28] border border-[#F2F4F6]">
        <DialogHeader>
          <DialogTitle>{existing ? "피드백 수정" : "피드백 / 건의사항 작성"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-sm font-medium text-[#191F28] mb-1 block">제목</label>
            <Input
              placeholder="제목을 입력하세요"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-[#191F28] mb-1 block">내용</label>
            <Textarea
              placeholder="건의하실 내용을 상세히 입력해주세요"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              maxLength={5000}
              className="resize-none"
            />
            <p className="text-xs text-[#8B95A1] mt-1 text-right">{content.length}/5000</p>
          </div>
          <FileUploadArea
            attachments={attachments}
            onAdd={handleFiles}
            onRemove={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
            uploading={uploading}
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
            <Button onClick={handleSubmit} disabled={saving || uploading}>
              {saving ? "저장 중…" : existing ? "수정하기" : "등록하기"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── detail dialog ────────────────────────────────────────────────

function FeedbackDetailDialog({
  feedbackId,
  open,
  onClose,
  onRefreshList,
}: {
  feedbackId: number | null;
  open: boolean;
  onClose: () => void;
  onRefreshList: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  const detailKey = ["feedback-detail", feedbackId];

  const { data: detail, isLoading } = useQuery<FeedbackDetail>({
    queryKey: detailKey,
    queryFn: () => apiJson(`${API}/feedback/${feedbackId}`),
    enabled: !!feedbackId && open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    onRefreshList();
  };

  // Comment submit
  const submitComment = async () => {
    if (!commentText.trim()) return;
    try {
      await apiJson(`${API}/feedback/${feedbackId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setCommentText("");
      invalidate();
    } catch (e: any) {
      toast({ title: "오류", description: e.message, variant: "destructive" });
    }
  };

  // Comment edit
  const saveCommentEdit = async (cid: number) => {
    if (!editCommentText.trim()) return;
    try {
      await apiJson(`${API}/feedback/${feedbackId}/comments/${cid}`, {
        method: "PUT",
        body: JSON.stringify({ content: editCommentText.trim() }),
      });
      setEditingCommentId(null);
      invalidate();
    } catch (e: any) {
      toast({ title: "오류", description: e.message, variant: "destructive" });
    }
  };

  // Comment delete
  const deleteComment = async (cid: number) => {
    try {
      await apiJson(`${API}/feedback/${feedbackId}/comments/${cid}`, { method: "DELETE" });
      invalidate();
    } catch (e: any) {
      toast({ title: "오류", description: e.message, variant: "destructive" });
    }
  };

  // Status change
  const changeStatus = async (status: string) => {
    setStatusSaving(true);
    try {
      await apiJson(`${API}/feedback/${feedbackId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      invalidate();
      toast({ title: `상태 변경: ${STATUS_CONFIG[status]?.label ?? status}` });
    } catch (e: any) {
      toast({ title: "오류", description: e.message, variant: "destructive" });
    } finally {
      setStatusSaving(false);
    }
  };

  // Delete feedback
  const deleteFeedback = async () => {
    try {
      await apiJson(`${API}/feedback/${feedbackId}`, { method: "DELETE" });
      onRefreshList();
      onClose();
      toast({ title: "피드백이 삭제됐습니다" });
    } catch (e: any) {
      toast({ title: "오류", description: e.message, variant: "destructive" });
    }
  };

  const canEdit = detail && (isAdmin || detail.authorId === user?.id);
  const fmt = (d: string) =>
    new Date(d).toLocaleString("ko-KR", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 rounded-2xl bg-white text-[#191F28] border border-[#F2F4F6]">
          {isLoading || !detail ? (
            <div className="flex items-center justify-center h-64">
              <RefreshCw className="h-5 w-5 animate-spin text-[#8B95A1]" />
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-6 pt-6 pb-4 border-b border-[#F2F4F6]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={detail.status} />
                      <span className="text-xs text-[#8B95A1]">
                        {detail.authorName} · {fmt(detail.createdAt)}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold text-[#191F28] leading-snug">
                      {detail.title}
                    </h2>
                  </div>
                  {/* Admin: status select */}
                  {isAdmin && (
                    <Select
                      value={detail.status}
                      onValueChange={changeStatus}
                      disabled={statusSaving}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OPEN">대기</SelectItem>
                        <SelectItem value="IN_PROGRESS">작업중</SelectItem>
                        <SelectItem value="RESOLVED">완료</SelectItem>
                        <SelectItem value="CLOSED">종료</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Body (scrollable) */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                {/* Content */}
                <div className="text-sm text-[#333D4B] whitespace-pre-wrap leading-relaxed">
                  {detail.content}
                </div>

                {/* Attachments */}
                <AttachmentList attachments={detail.attachments ?? []} />

                {/* Actions (edit / delete) */}
                {canEdit && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setShowEditForm(true)}
                    >
                      <Pencil className="h-3 w-3" /> 수정
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-3 w-3" /> 삭제
                    </Button>
                  </div>
                )}

                {/* Divider */}
                <div className="border-t border-[#F2F4F6]" />

                {/* Comments */}
                <div>
                  <h3 className="text-sm font-semibold text-[#191F28] mb-3">
                    댓글 {detail.comments.length > 0 && `(${detail.comments.length})`}
                  </h3>
                  <div className="space-y-3">
                    {detail.comments.map((c) => {
                      const mine = c.authorId === user?.id;
                      const canMod = isAdmin || mine;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-xl p-3 text-sm ${
                            c.isAdminReply
                              ? "bg-blue-50 border border-blue-100"
                              : "bg-[#F8F9FA] border border-[#F2F4F6]"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-[#191F28] text-xs">
                              {c.authorName ?? "알 수 없음"}
                            </span>
                            {c.isAdminReply && (
                              <Badge className="text-[10px] px-1.5 py-0 bg-blue-600 text-white border-0">
                                관리자 답변
                              </Badge>
                            )}
                            <span className="text-[11px] text-[#8B95A1] ml-auto">
                              {fmt(c.createdAt)}
                            </span>
                          </div>
                          {editingCommentId === c.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={editCommentText}
                                onChange={(e) => setEditCommentText(e.target.value)}
                                rows={2}
                                className="text-sm resize-none"
                              />
                              <div className="flex gap-1.5">
                                <Button size="sm" className="h-6 text-xs" onClick={() => saveCommentEdit(c.id)}>저장</Button>
                                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setEditingCommentId(null)}>취소</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-[#333D4B] whitespace-pre-wrap leading-relaxed">
                                {c.content}
                              </p>
                              {canMod && (
                                <div className="flex gap-2 mt-1.5">
                                  <button
                                    className="text-[11px] text-[#8B95A1] hover:text-[#191F28]"
                                    onClick={() => { setEditingCommentId(c.id); setEditCommentText(c.content); }}
                                  >
                                    수정
                                  </button>
                                  <button
                                    className="text-[11px] text-red-400 hover:text-red-600"
                                    onClick={() => deleteComment(c.id)}
                                  >
                                    삭제
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                    {detail.comments.length === 0 && (
                      <p className="text-sm text-[#8B95A1]">아직 댓글이 없습니다.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Comment input */}
              <div className="px-6 py-4 border-t border-[#F2F4F6] bg-white">
                <div className="flex gap-2">
                  <Textarea
                    placeholder={isAdmin ? "답변을 입력하세요…" : "댓글을 입력하세요…"}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={2}
                    className="resize-none text-sm flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitComment();
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-auto px-3"
                    onClick={submitComment}
                    disabled={!commentText.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[11px] text-[#8B95A1] mt-1">Ctrl+Enter로 빠르게 전송</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="rounded-2xl bg-white text-[#191F28] border border-[#F2F4F6]">
          <AlertDialogHeader>
            <AlertDialogTitle>피드백 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 피드백과 모든 댓글이 삭제됩니다. 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteFeedback}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit form */}
      {showEditForm && detail && (
        <FeedbackFormModal
          open={showEditForm}
          onClose={() => setShowEditForm(false)}
          existing={detail}
          onSuccess={() => { invalidate(); setShowEditForm(false); }}
        />
      )}
    </>
  );
}

// ─── main page ────────────────────────────────────────────────────

export default function FeedbackPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const qc = useQueryClient();

  const listKey = ["feedback-list", statusFilter];

  const { data: items = [], isLoading, refetch } = useQuery<FeedbackItem[]>({
    queryKey: listKey,
    queryFn: () =>
      apiJson(`${API}/feedback${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  const refreshList = () => qc.invalidateQueries({ queryKey: ["feedback-list"] });

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
    });

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-[#191F28]">피드백 / 건의사항</h1>
            <p className="text-sm text-[#8B95A1] mt-0.5">
              {user?.role === "admin"
                ? "전체 피드백 목록을 관리합니다"
                : "건의사항이나 개선 의견을 남겨주세요"}
            </p>
          </div>
          <Button
            onClick={() => setShowCreate(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> 작성하기
          </Button>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                statusFilter === tab.value
                  ? "bg-[#1A1A1A] text-white"
                  : "text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F2F4F6]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-5 w-5 animate-spin text-[#8B95A1]" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#8B95A1]">
            <MessageCircle className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">피드백이 없습니다</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                className="w-full text-left bg-white rounded-xl border border-[#E5E8EB] px-5 py-4 hover:border-[#C9CDD2] hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <StatusBadge status={item.status} />
                      {user?.role === "admin" && (
                        <span className="text-xs text-[#8B95A1]">
                          {item.authorName}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-[#191F28] truncate">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-[#8B95A1]">
                      <span>{fmt(item.createdAt)}</span>
                      {item.commentCount > 0 && (
                        <span className="flex items-center gap-0.5">
                          <MessageCircle className="h-3 w-3" />
                          {item.commentCount}
                        </span>
                      )}
                      {item.attachmentCount > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Paperclip className="h-3 w-3" />
                          {item.attachmentCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#C9CDD2] group-hover:text-[#8B95A1] flex-shrink-0 mt-0.5" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      <FeedbackFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={refreshList}
      />

      {/* Detail dialog */}
      <FeedbackDetailDialog
        feedbackId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        onRefreshList={refreshList}
      />
    </Layout>
  );
}
