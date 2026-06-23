import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { seedOfferingsIfEmpty } from "@/lib/seedOfferings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Pause, Play, Activity, Send, Sparkles, Sun, RefreshCw, Eye, MailOpen, Reply, AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TopTriggersWidget } from "@/components/TopTriggersWidget";
import { FetchLeadsProgress } from "@/components/FetchLeadsProgress";
import { JobsSummaryCard } from "@/components/jobs/JobsSummaryCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Run = {
  id: string;
  campaign_id: string;
  state: string;
  target_lead_count: number;
  leads_found: number;
  leads_enriched: number;
  leads_drafted: number;
  leads_sent: number;
  leads_failed: number;
  daily_send_cap: number;
  error: string | null;
  updated_at: string;
};
type Campaign = { id: string; name: string };
type Event = { id: string; kind: string; message: string; level: string; created_at: string };
type Briefing = { id: string; briefing_date: string; body: string; metrics: any; read_at: string | null };
type SyncTick = { id: string; message: string; level: string; created_at: string };
type BriefingAction = {
  id: string;
  action_type: string;
  status: string;
  result: any;
  payload: any;
  finished_at: string | null;
  started_at: string | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  send_followups: "Send queued follow-ups",
  draft_pitch_for_warm_leads: "Draft pitches for warm leads",
  launch_campaign_from_intel: "Launch campaign from intel",
  apply_to_top_jobs: "Apply to top jobs",
};
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  skipped: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  failed: "bg-destructive/15 text-destructive",
};

const stateColors: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  discovering: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  enriching: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  drafting: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  sending: "bg-green-500/15 text-green-700 dark:text-green-400",
  paused: "bg-orange-500/15 text-orange-700 dark:text-orange-500",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

const Dashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [campaigns, setCampaigns] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<Event[]>([]);
  const [sentToday, setSentToday] = useState(0);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [funnel, setFunnel] = useState({ sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });
  const [generating, setGenerating] = useState(false);
  const [replySync, setReplySync] = useState<SyncTick | null>(null);
  const [briefingActions, setBriefingActions] = useState<BriefingAction[]>([]);

  useEffect(() => { document.title = "Studio · Outreach Studio"; }, []);

  const load = async () => {
    if (!user) return;
    await seedOfferingsIfEmpty(user.id);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [runsRes, campsRes, eventsRes, sentRes, briefingRes, eventsFunnelRes, syncRes, actionsRes] = await Promise.all([
      supabase.from("campaign_runs").select("*").order("updated_at", { ascending: false }).limit(20),
      supabase.from("campaigns").select("id,name"),
      supabase.from("run_events").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("pitches").select("id", { count: "exact", head: true }).gte("sent_at", start.toISOString()),
      supabase.from("daily_briefings").select("*").order("briefing_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("pitch_events").select("event_type").gte("occurred_at", since),
      supabase.from("run_events").select("id,message,level,created_at").eq("kind", "gmail-reply-sync").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("briefing_actions").select("id,action_type,status,result,payload,finished_at,started_at,created_at").eq("briefing_date", new Date().toISOString().slice(0, 10)).order("created_at", { ascending: true }),
    ]);

    setRuns((runsRes.data as Run[]) ?? []);
    const map: Record<string, string> = {};
    ((campsRes.data as Campaign[]) ?? []).forEach((c) => (map[c.id] = c.name));
    setCampaigns(map);
    setEvents((eventsRes.data as Event[]) ?? []);
    setSentToday(sentRes.count ?? 0);
    setBriefing((briefingRes.data as Briefing) ?? null);
    setReplySync((syncRes.data as SyncTick) ?? null);

    const f = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    ((eventsFunnelRes.data as { event_type: string }[]) ?? []).forEach((e) => {
      if (e.event_type === "delivered") f.sent++;
      else if (e.event_type === "opened") f.opened++;
      else if (e.event_type === "clicked") f.clicked++;
      else if (e.event_type === "replied") f.replied++;
      else if (e.event_type === "bounced") f.bounced++;
    });
    setFunnel(f);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_runs" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "run_events" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pitch_events" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "daily_briefings" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const togglePause = async (run: Run) => {
    const newState = run.state === "paused" ? "queued" : "paused";
    await supabase.from("campaign_runs").update({ state: newState, error: null }).eq("id", run.id);
    if (newState === "queued") {
      supabase.functions.invoke("campaign-tick", { body: { runId: run.id } }).catch(() => {});
    }
    toast({ title: newState === "paused" ? "Paused" : "Resumed" });
  };

  const endRun = async (run: Run) => {
    const { error } = await supabase
      .from("campaign_runs")
      .update({ state: "done", error: "Ended manually" })
      .eq("id", run.id);
    if (error) {
      toast({ title: "Failed to end", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Run ended", description: `${campaigns[run.campaign_id] ?? "Campaign"} stopped.` });
    load();
  };

  const generateBriefing = async () => {
    setGenerating(true);
    try {
      const { error } = await supabase.functions.invoke("daily-briefing", { body: { force: true } });
      if (error) throw error;
      toast({ title: "Briefing generated" });
      load();
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const markRead = async () => {
    if (!briefing || briefing.read_at) return;
    await supabase.from("daily_briefings").update({ read_at: new Date().toISOString() }).eq("id", briefing.id);
    load();
  };

  const active = runs.filter((r) => !["done", "failed"].includes(r.state));
  const finished = runs.filter((r) => ["done", "failed"].includes(r.state));

  const openRate = funnel.sent > 0 ? Math.round((funnel.opened / funnel.sent) * 100) : 0;
  const replyRate = funnel.sent > 0 ? Math.round((funnel.replied / funnel.sent) * 100) : 0;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Studio</h1>
          <p className="text-sm text-muted-foreground">Live view of your automated outreach.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Card className="px-3 py-2">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{sentToday}</span>
              <span className="text-muted-foreground">sent today</span>
            </div>
          </Card>
          <Button asChild variant="outline" size="sm">
            <Link to="/chat"><Sparkles className="h-4 w-4" /> Studio Agent</Link>
          </Button>
        </div>
      </div>

      <Card className={!briefing?.read_at && briefing ? "border-primary/40" : ""} onClick={markRead}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="h-4 w-4" /> Daily briefing
            {briefing && <Badge variant="outline" className="text-[10px]">{new Date(briefing.briefing_date).toLocaleDateString()}</Badge>}
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); generateBriefing(); }} disabled={generating}>
            <RefreshCw className={generating ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {briefing ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{briefing.body}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">No briefing yet — runs daily at 8am WAT, or click Refresh.</p>
          )}
        </CardContent>
      </Card>

      <TopTriggersWidget />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Reply className="h-4 w-4" /> Reply sync</CardTitle>
          {replySync && (
            <Badge variant="outline" className={cn(
              "text-[10px]",
              replySync.level === "error" && "border-destructive text-destructive",
              replySync.level === "warn" && "border-amber-500 text-amber-600",
            )}>
              {new Date(replySync.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {Math.round((Date.now() - +new Date(replySync.created_at)) / 60000)}m ago
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {replySync ? (
            <p className="text-sm text-muted-foreground">{replySync.message}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No reply-sync ticks yet. Runs every 10 minutes.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">7-day funnel</CardTitle>
          <p className="text-xs text-muted-foreground">Outreach campaigns only — see Job Hunt below for application metrics.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <FunnelStat icon={<Send className="h-4 w-4" />} label="Delivered" value={funnel.sent} />
            <FunnelStat icon={<Eye className="h-4 w-4" />} label="Opened" value={funnel.opened} sub={funnel.sent > 0 ? `${openRate}%` : undefined} />
            <FunnelStat icon={<MailOpen className="h-4 w-4" />} label="Clicked" value={funnel.clicked} />
            <FunnelStat icon={<Reply className="h-4 w-4" />} label="Replied" value={funnel.replied} sub={funnel.sent > 0 ? `${replyRate}%` : undefined} />
            <FunnelStat icon={<AlertTriangle className="h-4 w-4" />} label="Bounced" value={funnel.bounced} tone={funnel.bounced > 0 ? "destructive" : undefined} />
          </div>
        </CardContent>
      </Card>

      <JobsSummaryCard />

      <FetchLeadsProgress variant="card" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing running. Open <Link to="/offerings" className="text-primary hover:underline">Offerings</Link> or <Link to="/campaigns" className="text-primary hover:underline">Campaigns</Link> and click <strong>Start Outreach</strong>.
            </p>
          ) : (
            active.map((r) => {
              const pct = r.target_lead_count > 0
                ? Math.round((r.leads_sent / r.target_lead_count) * 100)
                : 0;
              const name = campaigns[r.campaign_id] ?? "(campaign)";
              const isAutoFromIntel = name.startsWith("Auto:");
              return (
                <div key={r.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      <Badge className={stateColors[r.state] ?? ""}>{r.state}</Badge>
                      {isAutoFromIntel && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Sparkles className="h-3 w-3" /> from intel
                        </Badge>
                      )}
                      {r.error && <span className="text-xs text-destructive">{r.error}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => togglePause(r)}>
                        {r.state === "paused" ? <><Play className="h-3.5 w-3.5" /> Resume</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" title="End run">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>End this run?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will stop <strong>{campaigns[r.campaign_id] ?? "the campaign"}</strong> immediately. No new leads will be discovered, drafted, or sent for this run. Already-sent pitches and follow-ups are unaffected. You can start a new run later from the Campaigns tab.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => endRun(r)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              End run
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
                    <span>Found: <strong className="text-foreground">{r.leads_found}/{r.target_lead_count}</strong></span>
                    <span>Enriched: <strong className="text-foreground">{r.leads_enriched}</strong></span>
                    <span>Drafted: <strong className="text-foreground">{r.leads_drafted}</strong></span>
                    <span>Sent: <strong className="text-foreground">{r.leads_sent}</strong></span>
                    {r.leads_failed > 0 && <span>Failed: <strong className="text-destructive">{r.leads_failed}</strong></span>}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-3">
                  <span className="mt-1 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                  <span className={e.level === "error" ? "text-destructive" : e.level === "warn" ? "text-amber-600 dark:text-amber-500" : ""}>
                    {e.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {finished.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Finished</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {finished.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <span>{campaigns[r.campaign_id] ?? "(campaign)"}</span>
                <span className="text-muted-foreground">{r.leads_sent} sent · <Badge className={stateColors[r.state]}>{r.state}</Badge></span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const FunnelStat = ({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone?: "destructive" }) => (
  <div className="rounded-lg border p-3">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
    <div className={`mt-1 text-xl font-semibold ${tone === "destructive" ? "text-destructive" : ""}`}>{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);

export default Dashboard;
