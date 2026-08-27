// AI-GUIDE.V2-UX.SIDECAR.1
// Non-modal responsive sidecar (Step 0.8). Replaces the prior modal
// Radix Sheet implementation with a fixed <aside> panel so the main
// BTPM app remains fully interactive while Guide is open. No backdrop,
// no overlay, no focus trap, no outside-click close. All chat behavior
// (V1/V2), history, suggestions, sources, markdown, input, and pending
// states are preserved verbatim.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Send, History, MessagesSquare, BookOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAiHelpConversations,
  useAiHelpMessages,
  useSendAiHelpMessage,
  type AiHelpSource,
} from "@/hooks/useAiHelp";
import { useGuideV2Chat } from "@/hooks/useGuideV2Chat";
import { useAiHelpMessageFeedback } from "@/hooks/useAiHelpFeedback";
import GuideMessageFeedback from "@/components/ai/GuideMessageFeedback";
import { GUIDE_MODEL } from "@/config/guideModel";
import { getRouteSuggestion } from "./routeSuggestions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AGENT_ENABLED = true;
const AGENT_DISABLED_MESSAGE =
  "BTPM Guide is temporarily unavailable. Please contact your administrator.";

export default function BtpmGuideDrawer({ open, onOpenChange }: Props) {
  const { pathname } = useLocation();
  const suggestion = useMemo(() => getRouteSuggestion(pathname), [pathname]);
  const isV2 = GUIDE_MODEL === "v2";
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  const sub: SubProps = {
    open,
    onOpenChange,
    pathname,
    suggestionLabel: suggestion.label,
    suggestedQuestions: suggestion.questions,
    input,
    setInput,
    scrollRef,
  };

  return isV2 ? <V2Panel {...sub} /> : <V1Panel {...sub} />;
}

interface SubProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
  suggestionLabel: string;
  suggestedQuestions: string[];
  input: string;
  setInput: (v: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

/**
 * Shared non-modal sidecar shell. Renders as a fixed right-aligned
 * <aside> with independent vertical scroll. No overlay; main app stays
 * interactive. Width comes from the --btpm-guide-sidecar-width CSS
 * variable defined on AppLayout root.
 */
function SidecarShell({
  onClose,
  suggestionLabel,
  onHistory,
  onNew,
  children,
}: {
  onClose: () => void;
  suggestionLabel: string;
  onHistory: () => void;
  onNew: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="complementary"
      aria-label="BTPM Guide"
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex flex-col",
        "w-full sm:w-[var(--btpm-guide-sidecar-width)]",
        "bg-background border-l shadow-lg",
        "h-[100dvh]",
      )}
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <MessagesSquare className="h-4 w-4" /> BTPM Guide
            </div>
            <div className="text-xs text-muted-foreground">
              Ask questions about how to use BTPM. Answers are based only on the Knowledge Center.
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon" title="History" onClick={onHistory}>
              <History className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="New chat" onClick={onNew}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Context: <span className="font-medium text-foreground">{suggestionLabel}</span>
        </div>
      </div>
      {children}
    </aside>
  );
}

function V2Panel({
  open, onOpenChange, pathname, suggestionLabel, suggestedQuestions,
  input, setInput, scrollRef,
}: SubProps) {
  const chat = useGuideV2Chat();
  const conversations = useAiHelpConversations(open);
  const feedback = useAiHelpMessageFeedback(chat.conversationId);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages, chat.isPending, scrollRef]);

  function submit(text: string) {
    const message = text.trim();
    if (!message || chat.isPending || !AGENT_ENABLED) return;
    setInput("");
    chat.send({
      message,
      context_route: pathname,
      context_label: suggestionLabel,
    });
  }

  function startNew() {
    chat.reset();
    setShowHistory(false);
  }

  return (
    <SidecarShell
      onClose={() => onOpenChange(false)}
      suggestionLabel={suggestionLabel}
      onHistory={() => setShowHistory((v) => !v)}
      onNew={startNew}
    >
      {showHistory ? (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            {conversations.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
            {conversations.data?.length === 0 && (
              <div className="text-xs text-muted-foreground">No previous conversations.</div>
            )}
            {conversations.data?.map((c) => (
              <button
                key={c.id}
                className={cn(
                  "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                  c.id === chat.conversationId && "bg-accent",
                )}
                onClick={() => {
                  chat.setConversationId(c.id);
                  setShowHistory(false);
                }}
              >
                <div className="line-clamp-1 font-medium">{c.title || "(Untitled)"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(c.updated_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {!AGENT_ENABLED && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {AGENT_DISABLED_MESSAGE}
            </div>
          )}
          {AGENT_ENABLED && !chat.conversationId && chat.messages.length === 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Suggested questions</div>
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  className="block w-full rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {chat.messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm break-words",
                  m.role === "user" ? "bg-primary text-primary-foreground whitespace-pre-wrap" : "bg-muted",
                )}
              >
                {m.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-code:text-foreground">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  m.content
                )}
                {m.role === "assistant" &&
                  (m.source_article_ids?.length > 0 || chat.latestSources[m.id]) && (
                    <SourcesList
                      sources={chat.latestSources[m.id]}
                      sourceIds={m.source_article_ids}
                    />
                  )}
                {m.role === "assistant" && (
                  <GuideMessageFeedback
                    assistantMessageId={m.id}
                    conversationId={chat.conversationId}
                    current={feedback.data?.[m.id]}
                  />
                )}
              </div>
            </div>
          ))}

          {chat.isPending && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Thinking…
              </div>
            </div>
          )}

          {chat.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {chat.error}
            </div>
          )}
        </div>
      )}

      <form
        className="border-t p-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={AGENT_ENABLED ? "Ask about BTPM…" : "BTPM Guide is temporarily unavailable"}
          disabled={!AGENT_ENABLED || chat.isPending}
          maxLength={4000}
        />
        <Button type="submit" size="icon" disabled={!AGENT_ENABLED || chat.isPending || !input.trim()}>
          {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </SidecarShell>
  );
}

function V1Panel({
  open, onOpenChange, pathname, suggestionLabel, suggestedQuestions,
  input, setInput, scrollRef,
}: SubProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [latestSources, setLatestSources] = useState<Record<string, AiHelpSource[]>>({});

  const conversations = useAiHelpConversations(open);
  const messages = useAiHelpMessages(conversationId);
  const feedback = useAiHelpMessageFeedback(conversationId);
  const send = useSendAiHelpMessage();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.data, send.isPending, scrollRef]);

  function submit(text: string) {
    const message = text.trim();
    if (!message || send.isPending) return;
    if (!AGENT_ENABLED) return;
    setInput("");
    send.mutate(
      {
        conversation_id: conversationId,
        message,
        context_route: pathname,
        context_label: suggestionLabel,
      },
      {
        onSuccess: (res) => {
          if (res.conversation_id) setConversationId(res.conversation_id);
          if (res.assistant_message && res.sources) {
            setLatestSources((m) => ({ ...m, [res.assistant_message!.id]: res.sources! }));
          }
        },
      },
    );
  }

  function startNew() {
    setConversationId(null);
    setShowHistory(false);
  }

  return (
    <SidecarShell
      onClose={() => onOpenChange(false)}
      suggestionLabel={suggestionLabel}
      onHistory={() => setShowHistory((v) => !v)}
      onNew={startNew}
    >
      {showHistory ? (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            {conversations.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
            {conversations.data?.length === 0 && (
              <div className="text-xs text-muted-foreground">No previous conversations.</div>
            )}
            {conversations.data?.map((c) => (
              <button
                key={c.id}
                className={cn(
                  "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                  c.id === conversationId && "bg-accent",
                )}
                onClick={() => {
                  setConversationId(c.id);
                  setShowHistory(false);
                }}
              >
                <div className="line-clamp-1 font-medium">{c.title || "(Untitled)"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(c.updated_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {!AGENT_ENABLED && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {AGENT_DISABLED_MESSAGE}
            </div>
          )}
          {AGENT_ENABLED && !conversationId && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Suggested questions</div>
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  className="block w-full rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.data?.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm break-words",
                  m.role === "user" ? "bg-primary text-primary-foreground whitespace-pre-wrap" : "bg-muted",
                )}
              >
                {m.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-code:text-foreground">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  m.content
                )}
                {m.role === "assistant" && (m.source_article_ids?.length > 0 || latestSources[m.id]) && (
                  <SourcesList sources={latestSources[m.id]} sourceIds={m.source_article_ids} />
                )}
                {m.role === "assistant" && (
                  <GuideMessageFeedback
                    assistantMessageId={m.id}
                    conversationId={conversationId}
                    current={feedback.data?.[m.id]}
                  />
                )}
              </div>
            </div>
          ))}

          {send.isPending && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Thinking…
              </div>
            </div>
          )}

          {send.data?.ok === false && send.data.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {send.data.error}
            </div>
          )}
        </div>
      )}

      <form
        className="border-t p-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={AGENT_ENABLED ? "Ask about BTPM…" : "BTPM Guide is temporarily unavailable"}
          disabled={!AGENT_ENABLED || send.isPending}
          maxLength={4000}
        />
        <Button type="submit" size="icon" disabled={!AGENT_ENABLED || send.isPending || !input.trim()}>
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </SidecarShell>
  );
}

function SourcesList({ sources, sourceIds }: { sources?: AiHelpSource[]; sourceIds: string[] }) {
  if (!sources || sources.length === 0) {
    if (!sourceIds || sourceIds.length === 0) return null;
    return (
      <div className="mt-2 text-[10px] text-muted-foreground">
        {sourceIds.length} source article(s) — open Knowledge Center to read more.
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">Sources</div>
      {sources.map((s) => (
        <Link
          key={s.id}
          to={s.slug ? `/knowledge/${s.slug}` : "/knowledge"}
          className="flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline"
        >
          <BookOpen className="h-3 w-3" /> {s.title}
        </Link>
      ))}
    </div>
  );
}
