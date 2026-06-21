import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Briefcase, Sparkles, Send, Reply, AlertTriangle, RefreshCw } from "lucide-react";
import { JobMatchesList } from "@/components/jobs/JobMatchesList";
import { JobSourcesPanel } from "@/components/jobs/JobSourcesPanel";
import { CvTailorPanel } from "@/components/jobs/CvTailorPanel";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

type Stats = {
  scanned: number; matched: number; sent: number; bounced: number;
  replied: number; interviews: number; avgMatchScore: number;
  topSources: Array<{ source: string; count: number }>;
};
type Budget = {
  outreach_cap: number; jobhunt_cap: number;
  outreach_sent: number; jobhunt_sent: number;
  notes: string | null;
};
type Lead = { id: string; contact_name: string | null; company: string | null; status: string | null; reply_intent: string | null; updated_at: string };

const Jobs = () => {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const [range, setRange] = useState<7 | 30>(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [pipeline, setPipeline] = useState<Lead[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => { document.title = "Jobs · Outreach Studio"; }, []);

  const load = async () => {
    if (!user) return;
    const since = new Date(Date.now() - range * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const [postsRes, leadsRes, sentRes, eventsRes, budgetRes] = await Promise.all([
      supabase.from("job_posts").select("id, score, source, created_at").eq("user_id", user.id).gte("created_at", since),
      supabase.from("leads")
        .select("id, contact_name, company, status, reply_intent, updated_at, campaign_id, campaigns!inner(mode)")
        .eq("user_id", user.id).eq("campaigns.mode", "job_hunt").order("updated_at", { ascending: false }).limit(100),
      supabase.from("pitches")
        .select("id, sent_at, leads!inner(campaign_id, campaigns!inner(mode))")
        .eq("user_id", user.id).eq("leads.campaigns.mode", "job_hunt").gte("sent_at", since),
      supabase.from("pitch_events")
        .select("event_type, leads!inner(campaign_id, campaigns!inner(mode))")
        .eq("user_id", user.id).eq("leads.campaigns.mode", "job_hunt").gte("occurred_at", since),
      supabase.from("email_budgets")
        .select("outreach_cap, jobhunt_cap, outreach_sent, jobhunt_sent, notes")
        .eq("user_id", user.id).eq("date", today).maybeSingle(),
    ]);

    const allPosts = postsRes.data ?? [];
    const matched = allPosts.filter((p: any) => (p.score ?? 0) >= 60);
    const sent = sentRes.data ?? [];
    const events = (eventsRes.data ?? []) as any[];
    const bounced = events.filter((e) => e.event_type === "bounced").length;
    const replied = events.filter((e) => e.event_type === "replied").length;
    const leads = (leadsRes.data ?? []) as any[];
    const interviews = leads.filter((l) => l.reply_intent === "job_interview").length;

    const sourceCounts = new Map<string, number>();
    for (const p of allPosts as any[]) {
      const s = p.source || "?";
      sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
    }
    const topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count).slice(0, 5);

    const avgMatchScore = matched.length
      ? Math.round(matched.reduce((a: number, p: any) => a + (p.score ?? 0), 0) / matched.length)
      : 0;

    setStats({
      scanned: allPosts.length, matched: matched.length, sent: sent.length,
      bounced, replied, interviews, avgMatchScore, topSources,
    });
    setBudget((budgetRes.data as Budget) ?? null);
    setPipeline(leads as Lead[]);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, range, tick]);

  const reallocate = async () => {
    try {
      await supabase.functions.invoke("allocate-email-budget", { body: { user_id: user?.id } });
      await load();
      toast.success("Budget reallocated for today");
    } catch (e: any) { toast.error(e?.message || "Reallocate failed"); }
  };

  const jobCap = budget?.jobhunt_cap ?? 0;
  const jobSent = budget?.jobhunt_sent ?? 0;
  const outCap = budget?.outreach_cap ?? 0;
  const outSent = budget?.outreach_sent ?? 0;
  const jobPct = jobCap > 0 ? Math.min(100, Math.round((jobSent / jobCap) * 100)) : 0;
  const outPct = outCap > 0 ? Math.min(100, Math.round((outSent / outCap) * 100)) : 0;

  const groups = useMemo(() => {
    const g: Record<string, Lead[]> = { drafted: [], sent: [], replied: [], interview: [] };
    for (const l of pipeline) {
      if (l.reply_intent === "job_interview") g.interview.push(l);
      else if (l.status === "replied") g.replied.push(l);
      else if (l.status === "sent" || l.status === "queued") g.sent.push(l);
      else if (l.status === "drafted") g.drafted.push(l);
    }
    return g;
  }, [pipeline]);

  return (
    <div className="container mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <Briefcase className="h-5 w-5 sm:h-6 sm:w-6" /> Jobs
        </h1>
        <p className="text-sm text-muted-foreground">Scan job boards, tailor your CV, draft applications, and track replies — all in one place.</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="flex w-full overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="cv">CV &amp; Tailor</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="flex items-center gap-1">
            {[7, 30].map((d) => (
              <Button key={d} size="sm" variant={range === d ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs" onClick={() => setRange(d as 7 | 30)}>
                Last {d}d
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-7 ml-auto" onClick={() => setTick((t) => t + 1)}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Today's Resend budget</CardTitle>
                {budget?.notes === "override" && <Badge variant="outline" className="text-[10px]">override</Badge>}
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={reallocate}>
                  <Sparkles className="h-3 w-3" /> Re-allocate
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs"><span>Outreach</span><span className="text-muted-foreground">{outSent}/{outCap}</span></div>
                <Progress value={outPct} className="h-1.5" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs"><span>Job hunt</span><span className="text-muted-foreground">{jobSent}/{jobCap}</span></div>
                <Progress value={jobPct} className="h-1.5" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Funnel ({range}d)</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Scanned" value={stats?.scanned ?? 0} icon={<RefreshCw className="h-3.5 w-3.5" />} />
                <Stat label="Matched (≥60)" value={stats?.matched ?? 0} sub={stats?.avgMatchScore ? `avg ${stats.avgMatchScore}` : undefined} />
                <Stat label="Applied" value={stats?.sent ?? 0} icon={<Send className="h-3.5 w-3.5" />} />
                <Stat label="Replied" value={stats?.replied ?? 0} icon={<Reply className="h-3.5 w-3.5" />} />
                <Stat label="Interviews" value={stats?.interviews ?? 0} tone="positive" />
                <Stat label="Bounced" value={stats?.bounced ?? 0} icon={<AlertTriangle className="h-3.5 w-3.5" />} tone={stats?.bounced ? "destructive" : undefined} />
                <div className="col-span-2 rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Top boards</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(stats?.topSources ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : stats!.topSources.map((s) => (
                      <Badge key={s.source} variant="secondary" className="text-[10px]">{s.source} · {s.count}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matches" className="mt-4">
          <JobMatchesList onChanged={() => setTick((t) => t + 1)} />
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          <JobSourcesPanel />
        </TabsContent>

        <TabsContent value="cv" className="mt-4">
          <CvTailorPanel />
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4 space-y-4">
          {(["drafted", "sent", "replied", "interview"] as const).map((k) => (
            <Card key={k}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base capitalize flex items-center gap-2">
                  {k} <Badge variant="secondary">{groups[k]?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(groups[k]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No leads here yet.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {groups[k].map((l) => (
                      <li key={l.id} className="flex items-center justify-between p-2.5 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{l.contact_name || l.company || "—"}</div>
                          <div className="truncate text-xs text-muted-foreground">{l.company ?? ""}</div>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {new Date(l.updated_at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Stat = ({ label, value, sub, icon, tone }: { label: string; value: number; sub?: string; icon?: React.ReactNode; tone?: "destructive" | "positive" }) => (
  <div className="rounded-lg border p-3">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
    <div className={`mt-1 text-xl font-semibold ${tone === "destructive" ? "text-destructive" : tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);

export default Jobs;
