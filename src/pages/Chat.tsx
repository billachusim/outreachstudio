import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowUp, Plus, Sparkles, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Msg = { id: string; role: string; content: string; created_at: string };

const SUGGESTIONS = [
  "What's running right now?",
  "Summarize today's pipeline",
  "Draft a pitch for my warmest lead",
  "Suggest one tweak to improve replies",
];

const Chat = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { document.title = "Agent · Outreach Studio"; }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: convos } = await supabase
        .from("chat_conversations").select("id").order("updated_at", { ascending: false }).limit(1);
      if (convos && convos.length > 0) setConversationId(convos[0].id);
      else {
        const { data: newC } = await supabase
          .from("chat_conversations").insert({ user_id: user.id, title: "New chat" }).select("id").single();
        if (newC) setConversationId(newC.id);
      }
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      const { data } = await supabase
        .from("chat_messages").select("id, role, content, created_at")
        .eq("conversation_id", conversationId).order("created_at");
      setMessages((data ?? []).filter((m) => m.role === "user" || m.role === "assistant") as Msg[]);
    })();
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const newConversation = async () => {
    if (!user) return;
    const { data } = await supabase.from("chat_conversations").insert({ user_id: user.id, title: "New chat" }).select("id").single();
    if (data) { setConversationId(data.id); setMessages([]); setInput(""); taRef.current?.focus(); }
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || !conversationId || sending) return;
    setInput("");
    setSending(true);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: text, created_at: new Date().toISOString() }]);
    try {
      const { data, error } = await supabase.functions.invoke("studio-agent", {
        body: { conversationId, userMessage: text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const reply = (data as any)?.content ?? "";
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: reply, created_at: new Date().toISOString() }]);
    } catch (e: any) {
      toast({ title: "Agent error", description: e?.message ?? "Try again", variant: "destructive" });
    } finally {
      setSending(false);
      setTimeout(() => taRef.current?.focus(), 0);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem-4rem)] flex-col md:h-[calc(100dvh-3.5rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="truncate text-sm font-semibold">Studio Agent</span>
        </div>
        <Button variant="ghost" size="sm" onClick={newConversation} className="gap-1.5">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New chat</span>
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
          {empty ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold sm:text-2xl">How can I help today?</h2>
                <p className="text-sm text-muted-foreground">
                  Ask me about campaigns, leads, intel, social, channels, offerings, templates, or memory.
                </p>
              </div>
              <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  {m.role === "user" ? (
                    <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground sm:max-w-[75%]">
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  ) : (
                    <div className="flex w-full gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
                        <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:my-2 prose-headings:mt-3 prose-headings:mb-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex w-full gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div
        className="border-t border-border/60 bg-background px-3 pb-3 pt-2 sm:px-4 sm:pb-4"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="relative flex items-end rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Message Studio Agent…"
              rows={1}
              disabled={sending}
              className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-4 py-3 pr-12 text-sm leading-snug outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => send()}
              disabled={sending ? false : !input.trim()}
              className="absolute bottom-1.5 right-1.5 h-9 w-9 rounded-xl"
              aria-label="Send"
            >
              {sending ? <Square className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
            Agent can manage campaigns, leads, offerings, intel, channels, social, templates & memory.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Chat;
