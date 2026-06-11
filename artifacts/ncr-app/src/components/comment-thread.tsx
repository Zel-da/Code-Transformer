import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  useListReportComments,
  useCreateReportComment,
  useUpdateReportComment,
  useDeleteReportComment,
  useListUsers,
  getListReportCommentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth";
import { MessageSquare, Send, Pencil, Trash2, X, AtSign, RefreshCw, Check } from "lucide-react";

interface Props {
  reportId: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}일 전`;
  return format(new Date(dateStr), "MM.dd HH:mm", { locale: ko });
}

function highlightMentions(body: string, taggedUserIds: number[], allUserMap: Map<number, string>): React.ReactNode {
  if (taggedUserIds.length === 0) return body;
  const names = taggedUserIds.map((id) => allUserMap.get(id)).filter(Boolean) as string[];
  if (names.length === 0) return body;

  const parts: React.ReactNode[] = [];
  let last = 0;
  const regex = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  let match;
  while ((match = regex.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    parts.push(
      <span key={match.index} className="text-purple-700 font-semibold bg-purple-50 rounded px-0.5">
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.length > 0 ? parts : body;
}

export function CommentThread({ reportId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: comments = [], isLoading } = useListReportComments(reportId);
  const { data: allUsers = [] } = useListUsers();
  const createComment = useCreateReportComment();
  const updateComment = useUpdateReportComment();
  const deleteComment = useDeleteReportComment();

  const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));

  // new comment state
  const [body, setBody] = useState("");
  const [taggedIds, setTaggedIds] = useState<number[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");

  // delete confirm
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filteredMentionUsers = mentionQuery !== null
    ? allUsers.filter(
        (u) =>
          u.isActive &&
          (u.displayName.includes(mentionQuery) || u.username.includes(mentionQuery)) &&
          !taggedIds.includes(u.id)
      ).slice(0, 6)
    : [];

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setBody(val);

    const cursor = e.target.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);
    const atIdx = beforeCursor.lastIndexOf("@");
    if (atIdx !== -1 && (atIdx === 0 || /\s/.test(beforeCursor[atIdx - 1]))) {
      const query = beforeCursor.slice(atIdx + 1);
      if (!query.includes(" ")) {
        setMentionQuery(query);
        setMentionAnchor(atIdx);
        return;
      }
    }
    setMentionQuery(null);
  };

  const selectMention = (uid: number, displayName: string) => {
    const before = body.slice(0, mentionAnchor);
    const after = body.slice(mentionAnchor + 1 + (mentionQuery?.length ?? 0));
    const newBody = `${before}@${displayName} ${after}`;
    setBody(newBody);
    setTaggedIds((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  const removeTag = (uid: number) => {
    setTaggedIds((prev) => prev.filter((id) => id !== uid));
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListReportCommentsQueryKey(reportId) });

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await createComment.mutateAsync({ id: reportId, data: { body: trimmed, taggedUserIds: taggedIds } });
      setBody("");
      setTaggedIds([]);
      setMentionQuery(null);
      await invalidate();
    } catch {
      toast({ title: "오류", description: "의견 등록에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleEditSave = async (cid: number) => {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    try {
      await updateComment.mutateAsync({ id: reportId, cid, data: { body: trimmed } });
      setEditingId(null);
      setEditBody("");
      await invalidate();
    } catch {
      toast({ title: "오류", description: "수정에 실패했습니다.", variant: "destructive" });
    }
  };

  const handleDelete = async (cid: number) => {
    try {
      await deleteComment.mutateAsync({ id: reportId, cid });
      setDeletingId(null);
      await invalidate();
    } catch {
      toast({ title: "오류", description: "삭제에 실패했습니다.", variant: "destructive" });
    }
  };

  if (isLoading) return (
    <div className="py-3 flex items-center justify-center gap-2 text-[#8B95A1]">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      <span className="text-[12px]">의견 불러오는 중...</span>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-[#F2F4F6] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#F2F4F6] flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#8B95A1]" />
        <span className="text-[13px] font-bold text-[#191F28]">협업 댓글</span>
        {comments.length > 0 && (
          <span className="ml-1 text-[11px] font-semibold bg-[#E5E8EB] text-[#4E5968] rounded-full px-2 py-0.5">
            {comments.length}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[#BEC5CC]">@이름 으로 담당자 태그 가능</span>
      </div>

      {/* Comment list */}
      {comments.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <MessageSquare className="h-8 w-8 text-[#E5E8EB] mx-auto mb-2" />
          <p className="text-[13px] text-[#BEC5CC]">아직 등록된 댓글이 없습니다</p>
          <p className="text-[11px] text-[#BEC5CC] mt-0.5">첫 번째 의견을 남겨보세요</p>
        </div>
      ) : (
        <div className="divide-y divide-[#F2F4F6]">
          {comments.map((c) => {
            const isOwn = user?.id === c.authorId;
            const isAdmin = user?.role === "admin";
            const canEdit = isOwn || isAdmin;

            return (
              <div key={c.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-[#E5E8EB] flex items-center justify-center shrink-0">
                      <span className="text-[12px] font-bold text-[#4E5968]">
                        {c.authorName.slice(0, 1)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold text-[#191F28]">{c.authorName}</span>
                        <span className="text-[11px] text-[#BEC5CC]">{timeAgo(c.createdAt)}</span>
                        {c.isEdited && (
                          <span className="text-[11px] text-[#BEC5CC]">(수정됨)</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {canEdit && editingId !== c.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setEditingId(c.id); setEditBody(c.body); }}
                        className="h-7 w-7 rounded-lg flex items-center justify-center text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F2F4F6] transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {deletingId === c.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={deleteComment.isPending}
                            className="h-7 px-2.5 rounded-lg text-[11px] font-semibold bg-red-500 text-white disabled:opacity-50"
                          >
                            삭제
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-[#8B95A1] hover:bg-[#F2F4F6]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(c.id)}
                          className="h-7 w-7 rounded-lg flex items-center justify-center text-[#8B95A1] hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Edit mode */}
                {editingId === c.id ? (
                  <div className="mt-3 ml-10 space-y-2">
                    <textarea
                      className="w-full rounded-xl bg-[#F8F9FA] px-3.5 py-3 text-[13px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 resize-none"
                      rows={3}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      autoFocus
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => { setEditingId(null); setEditBody(""); }}
                        className="h-8 px-3 rounded-lg text-[12px] text-[#8B95A1] hover:text-[#191F28] hover:bg-[#F2F4F6] transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => handleEditSave(c.id)}
                        disabled={updateComment.isPending || !editBody.trim()}
                        className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-[#1A1A1A] text-white disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {updateComment.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 ml-10">
                    <p className="text-[13px] text-[#191F28] leading-relaxed whitespace-pre-wrap">
                      {highlightMentions(c.body, c.taggedUserIds, userMap)}
                    </p>
                    {c.taggedUserIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.taggedUserIds.map((uid) => {
                          const name = userMap.get(uid);
                          if (!name) return null;
                          return (
                            <span key={uid} className="text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                              @{name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New comment input */}
      {user && (
        <div className="border-t border-[#F2F4F6] bg-[#FAFAFA] px-5 py-4">
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-[#E5E8EB] flex items-center justify-center shrink-0 mt-1">
              <span className="text-[12px] font-bold text-[#4E5968]">{user.displayName?.slice(0, 1) ?? "?"}</span>
            </div>
            <div className="flex-1 min-w-0">
              {/* Tagged users chips */}
              {taggedIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {taggedIds.map((uid) => {
                    const name = userMap.get(uid);
                    if (!name) return null;
                    return (
                      <span
                        key={uid}
                        className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-full pl-2 pr-1 py-0.5"
                      >
                        @{name}
                        <button
                          type="button"
                          onClick={() => removeTag(uid)}
                          className="h-3.5 w-3.5 flex items-center justify-center rounded-full hover:bg-purple-200 transition-colors"
                        >
                          <X className="h-2 w-2" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  className="w-full rounded-xl bg-white border border-[#E5E8EB] px-3.5 py-3 text-[13px] text-[#191F28] outline-none focus:ring-2 focus:ring-[#1A1A1A]/10 focus:border-transparent resize-none pr-12"
                  rows={3}
                  placeholder="의견을 작성하세요. @이름으로 담당자를 태그할 수 있습니다."
                  value={body}
                  onChange={handleTextareaChange}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMentionQuery(null);
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!body.trim() || createComment.isPending}
                  className="absolute right-2.5 bottom-2.5 h-8 w-8 rounded-lg bg-[#1A1A1A] text-white flex items-center justify-center disabled:opacity-30 transition-opacity hover:bg-[#333] disabled:hover:bg-[#1A1A1A]"
                >
                  {createComment.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>

                {/* @mention dropdown */}
                {mentionQuery !== null && filteredMentionUsers.length > 0 && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 z-20 bg-white border border-[#E5E8EB] rounded-xl shadow-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-[#F2F4F6] flex items-center gap-1.5">
                      <AtSign className="h-3 w-3 text-[#8B95A1]" />
                      <span className="text-[11px] text-[#8B95A1]">담당자 태그</span>
                    </div>
                    {filteredMentionUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectMention(u.id, u.displayName); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-[#F8F9FA] border-b border-[#F2F4F6] last:border-0 flex items-center gap-2"
                      >
                        <div className="h-6 w-6 rounded-full bg-[#E5E8EB] flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-[#4E5968]">{u.displayName.slice(0, 1)}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="text-[12px] font-semibold text-[#191F28]">{u.displayName}</span>
                          <span className="text-[10px] text-[#8B95A1] ml-1.5">{u.username}</span>
                        </div>
                        <span className="ml-auto text-[10px] text-[#BEC5CC] shrink-0">{u.role}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-[#BEC5CC]">Ctrl+Enter로 빠르게 등록</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
