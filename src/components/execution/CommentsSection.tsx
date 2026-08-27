import { useState, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Pencil, X, Check, Mail } from "lucide-react";
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useCommentMentionEmailStatus,
  type CommentMentionEmailStatus,
  type CommentReference,
  type CommentReferenceInput,
  type CommentReferenceTargetType,
  type ReferenceTargetSearchResult,
} from "@/hooks/useExecutionData";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CommentReferenceChip, DraftReferenceChip } from "./CommentReferenceChip";
import { ReferencePicker } from "./ReferencePicker";

interface Props {
  targetType: string;
  targetId: string;
  organizationId: string;
  workspaceId: string;
  canEdit: boolean;
  membersMap: Record<string, string>;
}

type DraftReference = {
  referenced_type: CommentReferenceTargetType;
  referenced_id: string;
  workspace_id: string;
  project_id: string | null;
  phase_id: string | null;
  display_label: string | null;
  context_label: string | null;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Render comment body with highlighted @mentions */
function renderCommentBody(text: string, membersMap: Record<string, string>) {
  const names = Object.values(membersMap).filter(Boolean);
  if (names.length === 0) return text;

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'gi');

  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    parts.push(
      <span key={m.index} className="font-semibold text-primary">
        @{m[1]}
      </span>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

function MentionEmailIndicator({ status }: { status: CommentMentionEmailStatus }) {
  const { status: s, total_count, sent_count, pending_count, failed_count } = status;
  let colorClass = "text-muted-foreground";
  let label = "";
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  switch (s) {
    case "sent":
      colorClass = "text-emerald-600 dark:text-emerald-500";
      label = `Mention email sent to ${people(sent_count || total_count)}`;
      break;
    case "queued":
      colorClass = "text-muted-foreground";
      label = `Mention email queued for ${people(pending_count || total_count)}`;
      break;
    case "failed":
      colorClass = "text-destructive";
      label = `Mention email failed for ${people(failed_count || total_count)}`;
      break;
    case "partial":
      colorClass = "text-amber-600 dark:text-amber-500";
      label = `Mention email partially sent (${sent_count} of ${total_count})`;
      break;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center ${colorClass}`} aria-label={label}>
            <Mail className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Detect active trigger at the textarea caret. Returns the trigger char ("@" or "#")
 * and the current query string, or null when no trigger is active.
 */
function detectTrigger(text: string, caret: number): { trigger: "@" | "#"; query: string; start: number } | null {
  // Walk backwards from caret to find @ or # without whitespace
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@" || ch === "#") {
      const before = i === 0 ? " " : text[i - 1];
      // Trigger must be at start or after whitespace
      if (i === 0 || /\s/.test(before)) {
        return { trigger: ch as "@" | "#", query: text.slice(i + 1, caret), start: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

export function CommentsSection({ targetType, targetId, organizationId, workspaceId, canEdit, membersMap }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: comments = [], isLoading } = useComments(targetType, targetId);
  const { data: mentionStatusMap = {} } = useCommentMentionEmailStatus(targetType, targetId);
  const createComment = useCreateComment();
  const updateComment = useUpdateComment();

  // Composer state
  const [body, setBody] = useState("");
  const [draftRefs, setDraftRefs] = useState<DraftReference[]>([]);
  const [trigger, setTrigger] = useState<{ trigger: "@" | "#"; query: string; start: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editRefs, setEditRefs] = useState<DraftReference[]>([]);
  const [editTrigger, setEditTrigger] = useState<{ trigger: "@" | "#"; query: string; start: number } | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const membersList = useMemo(() => Object.entries(membersMap), [membersMap]);

  // # reference picker is mounted only when the active trigger is "#" — it owns
  // its own data flow (browse vs grouped search). No top-level fetch needed here.

  // Filter @ mentions by query
  const mentionMatches = useMemo(() => {
    if (!trigger || trigger.trigger !== "@") return [];
    const q = trigger.query.toLowerCase();
    return membersList.filter(([, name]) => name.toLowerCase().includes(q));
  }, [trigger, membersList]);
  const editMentionMatches = useMemo(() => {
    if (!editTrigger || editTrigger.trigger !== "@") return [];
    const q = editTrigger.query.toLowerCase();
    return membersList.filter(([, name]) => name.toLowerCase().includes(q));
  }, [editTrigger, membersList]);

  const onComposerChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setBody(val);
    const caret = e.target.selectionStart ?? val.length;
    setTrigger(detectTrigger(val, caret));
  }, []);

  const onEditChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setEditBody(val);
    const caret = e.target.selectionStart ?? val.length;
    setEditTrigger(detectTrigger(val, caret));
  }, []);

  const insertMentionInto = (
    currentBody: string,
    trig: { trigger: "@" | "#"; query: string; start: number },
    name: string
  ): string => {
    // Replace from start (inclusive) through start+1+query.length with `@Name `
    const before = currentBody.slice(0, trig.start);
    const after = currentBody.slice(trig.start + 1 + trig.query.length);
    return `${before}@${name} ${after}`;
  };

  const stripTriggerFragment = (
    currentBody: string,
    trig: { trigger: "@" | "#"; query: string; start: number }
  ): string => {
    const before = currentBody.slice(0, trig.start);
    const after = currentBody.slice(trig.start + 1 + trig.query.length);
    // Collapse double spaces left behind
    return (before + after).replace(/[ \t]{2,}/g, " ");
  };

  const handleSelectMention = (name: string) => {
    if (!trigger) return;
    setBody(insertMentionInto(body, trigger, name));
    setTrigger(null);
    textareaRef.current?.focus();
  };
  const handleSelectEditMention = (name: string) => {
    if (!editTrigger) return;
    setEditBody(insertMentionInto(editBody, editTrigger, name));
    setEditTrigger(null);
    editTextareaRef.current?.focus();
  };

  const handleSelectReference = (r: ReferenceTargetSearchResult) => {
    if (!trigger) return;
    // Prevent duplicates
    if (!draftRefs.some(d => d.referenced_type === r.target_type && d.referenced_id === r.target_id)) {
      setDraftRefs(prev => [...prev, {
        referenced_type: r.target_type,
        referenced_id: r.target_id,
        workspace_id: r.workspace_id,
        project_id: r.project_id,
        phase_id: r.phase_id,
        display_label: r.display_label,
        context_label: r.context_label,
      }]);
    }
    setBody(stripTriggerFragment(body, trigger));
    setTrigger(null);
    textareaRef.current?.focus();
  };
  const handleSelectEditReference = (r: ReferenceTargetSearchResult) => {
    if (!editTrigger) return;
    if (!editRefs.some(d => d.referenced_type === r.target_type && d.referenced_id === r.target_id)) {
      setEditRefs(prev => [...prev, {
        referenced_type: r.target_type,
        referenced_id: r.target_id,
        workspace_id: r.workspace_id,
        project_id: r.project_id,
        phase_id: r.phase_id,
        display_label: r.display_label,
        context_label: r.context_label,
      }]);
    }
    setEditBody(stripTriggerFragment(editBody, editTrigger));
    setEditTrigger(null);
    editTextareaRef.current?.focus();
  };

  const handleAdd = async () => {
    if (!body.trim() || !user) return;
    try {
      const refsPayload: CommentReferenceInput[] = draftRefs.map((r, i) => ({
        referenced_type: r.referenced_type,
        referenced_id: r.referenced_id,
        sort_order: i,
      }));
      await createComment.mutateAsync({
        body: body.trim(),
        target_type: targetType,
        target_id: targetId,
        organization_id: organizationId,
        workspace_id: workspaceId,
        author_id: user.id,
        references: refsPayload,
      });
      setBody("");
      setDraftRefs([]);
      setTrigger(null);
    } catch (err) {
      console.error("Post comment failed:", err);
      const e = err as { message?: string; error_description?: string; hint?: string; details?: string; code?: string } | null;
      const desc = e?.message || e?.error_description || e?.hint || e?.details || e?.code || "Unexpected error";
      toast({ title: "Could not post comment", description: desc, variant: "destructive" });
    }
  };

  const startEdit = (c: { id: string; body: string; references: CommentReference[] }) => {
    setEditingId(c.id);
    setEditBody(c.body);
    setEditRefs(
      (c.references ?? []).map((r) => ({
        referenced_type: r.referenced_type,
        referenced_id: r.referenced_id,
        workspace_id: r.workspace_id,
        project_id: r.project_id,
        phase_id: r.phase_id,
        display_label: r.display_label,
        context_label: r.context_label,
      }))
    );
    setEditTrigger(null);
  };

  const handleUpdate = async (id: string) => {
    if (!editBody.trim()) return;
    try {
      const refsPayload: CommentReferenceInput[] = editRefs.map((r, i) => ({
        referenced_type: r.referenced_type,
        referenced_id: r.referenced_id,
        sort_order: i,
      }));
      await updateComment.mutateAsync({
        id,
        body: editBody.trim(),
        target_type: targetType,
        target_id: targetId,
        references: refsPayload,
      });
      setEditingId(null);
      setEditRefs([]);
      setEditTrigger(null);
    } catch (err) {
      console.error("Update comment failed:", err);
      toast({
        title: "Could not update comment",
        description: err instanceof Error ? err.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const formatFull = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Discussion
          {comments.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({comments.length})</span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Use <span className="font-mono">@name</span> to mention someone, <span className="font-mono">#</span> to reference a project, phase, or task.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && comments.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No comments yet. Start a discussion by adding the first comment.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="border border-border rounded-md p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                {membersMap[c.author_id] || c.author_id?.slice(0, 8)}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground" title={formatFull(c.created_at)}>
                  {timeAgo(c.created_at)}
                </span>
                {c.is_edited && <span className="text-xs text-muted-foreground italic">(edited)</span>}
                {user?.id === c.author_id && mentionStatusMap[c.id] && (
                  <MentionEmailIndicator status={mentionStatusMap[c.id]} />
                )}
              </div>
            </div>
            {editingId === c.id ? (
              <div className="space-y-2 relative">
                <Textarea
                  ref={editTextareaRef}
                  value={editBody}
                  onChange={onEditChange}
                  rows={2}
                />
                {/* Edit dropdown */}
                {editTrigger?.trigger === "@" && editMentionMatches.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-popover border border-border rounded-md shadow-md max-h-40 overflow-y-auto z-20">
                    {editMentionMatches.map(([id, name]) => (
                      <button
                        key={id}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-foreground"
                        onMouseDown={(e) => { e.preventDefault(); handleSelectEditMention(name); }}
                      >
                        @{name}
                      </button>
                    ))}
                  </div>
                )}
                {editTrigger?.trigger === "#" && (
                  <ReferencePicker
                    workspaceId={workspaceId}
                    query={editTrigger.query}
                    onSelect={handleSelectEditReference}
                    onClose={() => setEditTrigger(null)}
                    placement="below"
                  />
                )}
                {editRefs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {editRefs.map((r, i) => (
                      <DraftReferenceChip
                        key={`${r.referenced_type}:${r.referenced_id}`}
                        data={r}
                        onRemove={() => setEditRefs(prev => prev.filter((_, idx) => idx !== i))}
                      />
                    ))}
                  </div>
                )}
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => handleUpdate(c.id)} disabled={updateComment.isPending}>
                    <Check className="h-3 w-3 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditTrigger(null); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {renderCommentBody(c.body, membersMap)}
                  </p>
                  {canEdit && user?.id === c.author_id && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 ml-2" onClick={() => startEdit(c)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {c.references && c.references.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {c.references.map((r) => (
                      <CommentReferenceChip key={r.id} data={r} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="space-y-2 pt-2 border-t border-border relative">
            <Textarea
              ref={textareaRef}
              placeholder="Add a comment — @name to mention, # to reference an object…"
              value={body}
              onChange={onComposerChange}
              rows={2}
            />
            {/* Mention dropdown */}
            {trigger?.trigger === "@" && mentionMatches.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 right-0 bg-popover border border-border rounded-md shadow-md max-h-40 overflow-y-auto z-10">
                {mentionMatches.map(([id, name]) => (
                  <button
                    key={id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-foreground"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectMention(name); }}
                  >
                    @{name}
                  </button>
                ))}
              </div>
            )}
            {/* Reference picker (browse + grouped search) */}
            {trigger?.trigger === "#" && (
              <ReferencePicker
                workspaceId={workspaceId}
                query={trigger.query}
                onSelect={handleSelectReference}
                onClose={() => setTrigger(null)}
                placement="above"
              />
            )}
            {draftRefs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {draftRefs.map((r, i) => (
                  <DraftReferenceChip
                    key={`${r.referenced_type}:${r.referenced_id}`}
                    data={r}
                    onRemove={() => setDraftRefs(prev => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
            <Button size="sm" onClick={handleAdd} disabled={!body.trim() || createComment.isPending}>
              Post Comment
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
