import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Inbox as InboxIcon, Mail, Loader2, MessageCircle, Sparkles, Send, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Lead = { id: string; business_name: string; contact_email: string | null; phone: string | null; status: string; reply_intent: string | null; score: number | null; last_activity_at: string | null };
type Pitch = { id: string; subject: string | null; body: string | null; sent_at: string | null; lead_id: string };
type PitchEvent = { id: string; event_type: string; occurred_at: string; channel: string; lead_id: string | null; pitch_id: string | null; payload: any };
type ChannelMsg = { id: string; channel: string; direction: string; subject: string | null; body: string | null; created_at: string; lead_id: string | null; from_address: string | null; to_address: string | null };

type ThreadItem =
  | { kind: "pitch"; at: string; data: Pitch }
  | { kind: "event"; at: string; data: PitchEvent }
  | { kind: "msg"; at: string; data: ChannelMsg };

type Thread = {
  leadId: string;
  lead: Lead | null;
  items: ThreadItem[];
  lastAt: string;
  hasReply: boolean;
  unreadCount: number;
};

const intentColors: Record<string, string> = {
  interested: "bg-success/15 text-success",
  question: "bg-primary/15 text-primary",
  "not-interested": "bg-muted text-muted-foreground",
  unsubscribe: "bg-destructive/15 text-destructive",
  "out-of-office": "bg-amber-500/15 text-amber-600",
};

type NextAction = {
  label: string;
  tone: "urgent" | "warm" | "neutral" | "cold" | "stop";
  hint: string;
};

const actionStyles: Record<NextAction["tone"], string> = {
  urgent: "bg-destructive/15 text-destructive border-destructive/30",
  warm: "bg-success/15 text-success border-success/30",
  neutral: "bg-primary/10 text-primary border-primary/30",
  cold: "bg-muted text-muted-foreground border-border",
  stop: "bg-destructive/10 text-destructive border-destructive/30",
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - +new Date(iso)) / 86_400_000);
}

function computeNextAction(t: Thread): NextAction {
  const intent = t.lead?.reply_intent ?? null;
  const status = t.lead?.status ?? null;
  const lastInbound = [...t.items].reverse().find(
    (i) => (i.kind === "event" && i.data.event_type === "replied") || (i.kind === "msg" && i.data.direction === "inbound"),
  );
  const lastOutbound = [...t.items].reverse().find(
    (i) => i.kind === "pitch" || (i.kind === "msg" && i.data.direction === "outbound"),
  );
  const inboundAge = daysSince(lastInbound?.at ?? null);
  const outboundAge = daysSince(lastOutbound?.at ?? null);
  const awaitingOurReply = lastInbound && (!lastOutbound || +new Date(lastInbound.at) > +new Date(lastOutbound.at));

  if (intent === "unsubscribe" || status === "unsubscribed") {
    return { label: "Do not contact", tone: "stop", hint: "Lead asked to unsubscribe." };
  }
  if (intent === "not_interested" || status === "lost") {
    return { label: "Mark lost", tone: "stop", hint: "Lead is not interested." };
  }
  if (awaitingOurReply && (intent === "interested" || intent === "question")) {
    return {
      label: inboundAge >= 1 ? "Reply now — overdue" : "Reply now",
      tone: "urgent",
      hint: `Lead replied ${inboundAge === 0 ? "today" : `${inboundAge}d ago`} (${intent}).`,
    };
  }
  if (awaitingOurReply && intent === "out_of_office") {
    return { label: "Snooze 7d", tone: "neutral", hint: "Out of office — follow up next week." };
  }
  if (awaitingOurReply && intent === "auto_reply") {
    return { label: "Wait", tone: "cold", hint: "Auto-reply received, no action needed." };
  }
  if (awaitingOurReply) {
    return { label: "Reply now", tone: "warm", hint: "Lead replied — draft a response." };
  }
  if (!t.hasReply && outboundAge >= 14) {
    return { label: "Close out", tone: "cold", hint: "No reply after 14 days." };
  }
  if (!t.hasReply && outboundAge >= 3) {
    return { label: "Follow-up due", tone: "neutral", hint: `Last touch ${outboundAge}d ago.` };
  }
  if (!t.hasReply) {
    return { label: "Wait", tone: "cold", hint: "Sequence still running." };
  }
  return { label: "Nurture", tone: "neutral", hint: "Keep the conversation warm." };
}

const eventLabel: Record<string, string> = {
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  complained: "Complained",
  replied: "Replied",
  failed: "Failed",
};

const Inbox = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<"all" | "warm" | "unread">("all");

  useEffect(() => { document.title = "Inbox · Outreach Studio"; }, []);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [pitchesRes, eventsRes, msgsRes, leadsRes] = await Promise.all([
      supabase.from("pitches").select("id,subject,body,sent_at,lead_id").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(500),
      supabase.from("pitch_events").select("*").order("occurred_at", { ascending: false }).limit(500),
      supabase.from("channel_messages").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("leads").select("id,business_name,contact_email,phone,status,reply_intent,score,last_activity_at"),
    ]);
    const leadsMap = new Map<string, Lead>();
    ((leadsRes.data as Lead[]) ?? []).forEach((l) => leadsMap.set(l.id, l));

    const byLead = new Map<string, ThreadItem[]>();
    const push = (id: string, item: ThreadItem) => {
      const arr = byLead.get(id) ?? [];
      arr.push(item);
      byLead.set(id, arr);
    };
    ((pitchesRes.data as Pitch[]) ?? []).forEach((p) => push(p.lead_id, { kind: "pitch", at: p.sent_at!, data: p }));
    ((eventsRes.data as PitchEvent[]) ?? []).forEach((e) => { if (e.lead_id) push(e.lead_id, { kind: "event", at: e.occurred_at, data: e }); });
    ((msgsRes.data as ChannelMsg[]) ?? []).forEach((m) => { if (m.lead_id) push(m.lead_id, { kind: "msg", at: m.created_at, data: m }); });

    const out: Thread[] = [];
    byLead.forEach((items, leadId) => {
      items.sort((a, b) => +new Date(a.at) - +new Date(b.at));
      const lastAt = items[items.length - 1]?.at ?? "";
      const hasReply =
        items.some((i) => i.kind === "event" && i.data.event_type === "replied") ||
        items.some((i) => i.kind === "msg" && i.data.direction === "inbound");
      const unreadCount = items.filter(
        (i) => (i.kind === "event" && i.data.event_type === "replied") || (i.kind === "msg" && i.data.direction === "inbound"),
      ).length;
      out.push({ leadId, lead: leadsMap.get(leadId) ?? null, items, lastAt, hasReply, unreadCount });
    });
    out.sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
    setThreads(out);
    if (!activeId && out.length) setActiveId(out[0].leadId);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "pitch_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "channel_messages" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "pitches" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filtered = useMemo(() => {
    if (filter === "warm") return threads.filter((t) => ["interested", "question"].includes(t.lead?.reply_intent ?? "") || t.hasReply);
    if (filter === "unread") return threads.filter((t) => t.unreadCount > 0);
    return threads;
  }, [threads, filter]);

  const active = threads.find((t) => t.leadId === activeId) ?? null;

  const draftReply = async () => {
    if (!active?.lead) return;
    setDrafting(true);
    const lastInbound = [...active.items].reverse().find((i) => (i.kind === "event" && i.data.event_type === "replied") || (i.kind === "msg" && i.data.direction === "inbound"));
    const lastPitch = [...active.items].reverse().find((i) => i.kind === "pitch") as Extract<ThreadItem, { kind: "pitch" }> | undefined;
    try {
      const { data, error } = await supabase.functions.invoke("studio-agent", {
        body: {
          messages: [
            { role: "user", content: `Draft a short, warm reply to ${active.lead.business_name}.
Their reply intent: ${active.lead.reply_intent ?? "unknown"}.
Latest inbound: ${lastInbound ? JSON.stringify((lastInbound.data as any).body ?? (lastInbound.data as any).payload ?? "(open/click event)") : "(none)"}.
Our last pitch subject: ${lastPitch?.data.subject ?? "(none)"}.
Return only the reply body — no preamble.` },
          ],
          oneShot: true,
        },
      });
      if (error) throw error;
      const text = data?.reply ?? data?.content ?? data?.message ?? "";
      setReply(typeof text === "string" ? text : JSON.stringify(text));
    } catch (e: any) {
      toast({ title: "Draft failed", description: e?.message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const sendReply = async () => {
    if (!active?.lead || !reply.trim() || !user) return;
    setSending(true);
    try {
      // record outbound channel_message; actual send via existing pipelines (email reply via send-pitch fallback or whatsapp)
      if (active.lead.phone) {
        const { error } = await supabase.functions.invoke("send-whatsapp", { body: { leadId: active.lead.id, body: reply } });
        if (error) throw error;
      } else if (active.lead.contact_email) {
        // Save as pitch + send
        const { data: pitch, error: pe } = await supabase.from("pitches").insert({
          user_id: user.id, lead_id: active.lead.id, subject: "Re: follow-up", body: reply,
        } as never).select().single();
        if (pe) throw pe;
        const { error: se } = await supabase.functions.invoke("send-pitch", { body: { pitchId: (pitch as any).id } });
        if (se) throw se;
      } else {
        throw new Error("No email or phone on lead");
      }
      toast({ title: "Reply sent" });
      setReply("");
      load();
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Inbox</h1>
          <p className="text-sm text-muted-foreground">Threaded view of every conversation.</p>
        </div>
        <div className="flex gap-1 rounded-md border p-1 text-sm">
          {(["all", "warm", "unread"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("rounded px-3 py-1 capitalize transition-colors", filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>
      ) : threads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <InboxIcon className="h-8 w-8" />
            <p>No conversations yet.</p>
            <p className="text-xs">Send a pitch or wait for replies to land here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="max-h-[75vh] overflow-y-auto">
            <ul className="divide-y">
              {filtered.map((t) => {
                const action = computeNextAction(t);
                return (
                <li key={t.leadId}>
                  <button
                    onClick={() => setActiveId(t.leadId)}
                    className={cn(
                      "block w-full px-3 py-3 text-left transition-colors hover:bg-muted/50",
                      activeId === t.leadId && "bg-muted",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.lead?.business_name ?? "(deleted lead)"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {t.lead?.contact_email ?? t.lead?.phone ?? "—"}
                        </div>
                      </div>
                      {t.unreadCount > 0 && (
                        <Badge className="bg-primary text-primary-foreground">{t.unreadCount}</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={cn("text-[10px]", actionStyles[action.tone])}>
                        {action.label}
                      </Badge>
                      {t.lead?.reply_intent && (
                        <Badge className={cn("text-[10px]", intentColors[t.lead.reply_intent] ?? "bg-muted")}>
                          {t.lead.reply_intent}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(t.lastAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                </li>
                );
              })}
                        </div>
                      </div>
                      {t.unreadCount > 0 && (
                        <Badge className="bg-primary text-primary-foreground">{t.unreadCount}</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {t.lead?.reply_intent && (
                        <Badge className={cn("text-[10px]", intentColors[t.lead.reply_intent] ?? "bg-muted")}>
                          {t.lead.reply_intent}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(t.lastAt).toLocaleDateString()} · {new Date(t.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex max-h-[75vh] flex-col">
            {!active ? (
              <CardContent className="flex flex-1 items-center justify-center text-muted-foreground">Select a thread</CardContent>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
                  <div>
                    <div className="font-semibold">
                      {active.lead?.business_name ?? "(deleted)"}{" "}
                      {active.lead && (
                        <Link to="/leads" className="ml-2 inline-flex items-center text-xs text-muted-foreground hover:text-primary">
                          open <ExternalLink className="ml-1 h-3 w-3" />
                        </Link>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {active.lead?.contact_email ?? active.lead?.phone ?? "—"}
                      {typeof active.lead?.score === "number" && <> · score {active.lead.score}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {active.lead?.status && <Badge variant="secondary" className="capitalize">{active.lead.status}</Badge>}
                    {active.lead?.reply_intent && (
                      <Badge className={cn(intentColors[active.lead.reply_intent] ?? "bg-muted", "capitalize")}>{active.lead.reply_intent}</Badge>
                    )}
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {active.items.map((it, idx) => {
                    if (it.kind === "pitch") {
                      return (
                        <div key={idx} className="rounded-lg border bg-background p-3">
                          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" /> Sent · {new Date(it.at).toLocaleString()}
                          </div>
                          {it.data.subject && <div className="font-medium">{it.data.subject}</div>}
                          {it.data.body && <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{it.data.body}</pre>}
                        </div>
                      );
                    }
                    if (it.kind === "event") {
                      return (
                        <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="h-px flex-1 bg-border" />
                          <Badge variant="outline" className="text-[10px]">{eventLabel[it.data.event_type] ?? it.data.event_type}</Badge>
                          <span>{new Date(it.at).toLocaleTimeString()}</span>
                          <span className="h-px flex-1 bg-border" />
                        </div>
                      );
                    }
                    const isInbound = it.data.direction === "inbound";
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "max-w-[85%] rounded-lg border p-3",
                          isInbound ? "bg-muted" : "ml-auto bg-primary/5",
                        )}
                      >
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {it.data.channel === "whatsapp" ? <MessageCircle className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                          {isInbound ? "From" : "To"} · {new Date(it.at).toLocaleString()}
                        </div>
                        {it.data.subject && <div className="font-medium">{it.data.subject}</div>}
                        {it.data.body && <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{it.data.body}</pre>}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2 border-t p-3">
                  <Textarea
                    rows={3}
                    placeholder="Type a reply, or click Draft to use the agent…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={draftReply} disabled={drafting}>
                      {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft with AI
                    </Button>
                    <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim()}>
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default Inbox;
