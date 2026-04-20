import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Sparkles, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Msg = { id: string; role: string; content: string; created_at: string };

const Chat = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = "Studio Agent · Outreach Studio"; }, []);

  // Get/create conversation
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: convos } = await supabase
        .from("chat_conversations").select("id").order("updated_at", { ascending: false }).limit(1);
      if (convos && convos.length > 0) {
        setConversationId(convos[0].id);
      } else {
        const { data: newC } = await supabase
          .from("chat_conversations").insert({ user_id: user.id, title: "New chat" }).select("id").single();
        if (newC) setConversationId(newC.id);
      }
    })();
  }, [user?.id]);

  // Load messages
  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      const { data } = await supabase
        .from("chat_messages").select("id, role, content, created_at")
        .eq("conversation_id", conversationId).order("created_at");
      setMessages((data ?? []).filter((m) => m.role === "user" || m.role === "assistant") as Msg[]);
    })();
  }, [conversationId]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  const newConversation = async () => {
    if (!user) return;
    const { data } = await supabase.from("chat_conversations").insert({ user_id: user.id, title: "New chat" }).select("id").single();
    if (data) { setConversationId(data.id); setMessages([]); }
  };

  const send = async () => {
    if (!input.trim() || !conversationId || sending) return;
    const text = input.trim();
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
    }
  };

  return (
    <div className="container mx-auto flex h-[calc(100vh-3.5rem)] max-w-4xl flex-col p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-lg font-semibold sm:text-xl">Studio Agent</h1>
        </div>
        <Button variant="outline" size="sm" onClick={newConversation}>
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New chat</span>
        </Button>
      </div>

      <Card ref={scrollRef as any} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8" />
            <p className="text-sm">Ask me to start a campaign, check progress, or list recent leads.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
              {["List my campaigns", "What's running right now?", "Show recent activity"].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="rounded-full border px-3 py-1 hover:bg-accent">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                    </div>
                  ) : m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-end gap-2 pt-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Tell the agent what to do…"
          rows={2}
          className="resize-none"
          disabled={sending}
        />
        <Button onClick={send} disabled={sending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default Chat;
