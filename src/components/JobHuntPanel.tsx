import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Briefcase, RefreshCw, Send, Reply, AlertTriangle, Sparkles, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type Stats = {
  scanned: number;       // job_posts created in window
  matched: number;       // score >= 60 in window
  sent: number;          // pitches sent on job_hunt leads in window
  bounced: number;
  replied: number;
  interviews: number;    // leads with reply_intent = 'job_interview' in window
  avgMatchScore: number;
  topSources: Array<{ source: string; count: number }>;
};

type Budget = {
  date: string;
  outreach_cap: number;
  jobhunt_cap: number;
  outreach_sent: number;
  jobhunt_sent: number;
  notes: string | null;
};

const RANGE_OPTIONS: Array<{ key: "7d" | "30d"; label: string; days: number }> = [
  { key: "7d", label: "Last 7d", days: 7 },
  { key: "30d", label: "Last 30d", days: 30 },
];

export const JobHuntPanel = () => {
  const { user } = useAuth();
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    if (!user) return;
    const days = RANGE_OPTIONS.find((r) => r.key === range)!.days;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const [postsRes, leadsRes, sentRes, eventsRes, budgetRes] = await Promise.all([
      supabase.from("job_posts")
        .select("id, score, source, created_at")
        .eq("user_id", user.id).gte("created_at", since),
      supabase.from("leads")
        .select("id, reply_intent, campaign_id, campaigns!inner(mode)")
        .eq("user_id", user.id).eq("campaigns.mode", "job_hunt"),
      supabase.from("pitches")
        .select("id, sent_at, leads!inner(campaign_id, campaigns!inner(mode))")
        .eq("user_id", user.id).eq("leads.campaigns.mode", "job_hunt")
        .gte("sent_at", since),
      supabase.from("pitch_events")
        .select("event_type, leads!inner(campaign_id, campaigns!inner(mode))")
        .eq("user_id", user.id).eq("leads.campaigns.mode", "job_hunt")
        .gte("occurred_at", since),
      supabase.from("email_budgets")
        .select("date, outreach_cap, jobhunt_cap, outreach_sent, jobhunt_sent, notes")
        .eq("user_id", user.id).eq("date", today).maybeSingle(),
    ]);

    const posts = postsRes.data ?? [];
    const matched = posts.filter((p: any) => (p.score ?? 0) >= 60);
    const sent = sentRes.data ?? [];
    const events = (eventsRes.data ?? []) as any[];
    const bounced = events.filter((e) => e.event_type === "bounced").length;
    const replied = events.filter((e) => e.event_type === "replied").length;
    const interviews = (leadsRes.data ?? []).filter((l: any) => l.reply_intent === "job_interview").length;

    const sourceCounts = new Map<string, number>();
    for (const p of posts as any[]) {
      const s = p.source || "?";
      sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
    }
    const topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const scoresSent: number[] = [];
    for (const p of sent as any[]) {
      // pitches don't carry score directly; approximate via matched posts mean
    }
    const avgMatchScore = matched.length
      ? Math.round(matched.reduce((a: number, p: any) => a + (p.score ?? 0), 0) / matched.length)
      : 0;

    setStats({
      scanned: posts.length,
      matched: matched.length,
      sent: sent.length,
      bounced,
      replied,
      interviews,
      avgMatchScore,
      topSources,
    });
    setBudget((budgetRes.data as Budget) ?? null);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, range]);

  const scan = async () => {
    setScanning(true);
    try {
      await supabase.functions.invoke("scan-jobs", { body: {} });
      toast.success("Scan started", { description: "New posts will appear in ~30s." });
      setTimeout(load, 25000);
    } catch (e: any) {
      toast.error(e?.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const reallocate = async () => {
    try {
      await supabase.functions.invoke("allocate-email-budget", { body: { user_id: user?.id } });
      await load();
      toast.success("Budget reallocated for today");
    } catch (e: any) {
      toast.error(e?.message || "Reallocate failed");
    }
  };

  const jobCap = budget?.jobhunt_cap ?? 25;
  const jobSent = budget?.jobhunt_sent ?? 0;
  const outCap = budget?.outreach_cap ?? 60;
  const outSent = budget?.outreach_sent ?? 0;
  const jobPct = jobCap > 0 ? Math.min(100, Math.round((jobSent / jobCap) * 100)) : 0;
  const outPct = outCap > 0 ? Math.min(100, Math.round((outSent / outCap) * 100)) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4" /> Job Hunt
        </CardTitle>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={range === r.key ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => setRange(r.key)}
            >{r.label}</Button>
          ))}
          <Button size="sm" variant="outline" className="h-7" onClick={scan} disabled={scanning}>
            <RefreshCw className={scanning ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Scan
          </Button>
          <Button size="sm" variant="ghost" className="h-7" asChild>
            <Link to="/leads?campaign_mode=job_hunt"><ExternalLink className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Today's budget bars */}
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Today's Resend budget</span>
            {budget?.notes === "override" && (
              <Badge variant="outline" className="text-[10px]">override</Badge>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={reallocate}>
              <Sparkles className="h-3 w-3" /> Re-allocate
            </Button>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span>Outreach</span>
              <span className="text-muted-foreground">{outSent}/{outCap}</span>
            </div>
            <Progress value={outPct} className="h-1.5" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span>Job hunt</span>
              <span className="text-muted-foreground">{jobSent}/{jobCap}</span>
            </div>
            <Progress value={jobPct} className="h-1.5" />
          </div>
          {budget?.notes && budget.notes !== "override" && (
            <p className="text-[11px] text-muted-foreground">{budget.notes}</p>
          )}
        </div>

        {/* Stats grid */}
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
              ) : (
                stats!.topSources.map((s) => (
                  <Badge key={s.source} variant="secondary" className="text-[10px]">
                    {s.source} · {s.count}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const Stat = ({
  label, value, sub, icon, tone,
}: { label: string; value: number; sub?: string; icon?: React.ReactNode; tone?: "destructive" | "positive" }) => (
  <div className="rounded-lg border p-3">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
    <div className={`mt-1 text-xl font-semibold ${
      tone === "destructive" ? "text-destructive" : tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : ""
    }`}>{value}</div>
    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
  </div>
);
