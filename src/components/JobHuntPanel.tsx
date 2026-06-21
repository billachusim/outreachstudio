import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Briefcase, RefreshCw, Send, Reply, AlertTriangle, Sparkles, ExternalLink,
  FileText, Copy, Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type Stats = {
  scanned: number;
  matched: number;
  sent: number;
  bounced: number;
  replied: number;
  interviews: number;
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

type JobPost = {
  id: string;
  title: string;
  company: string | null;
  score: number | null;
  source: string | null;
  status: string | null;
  apply_email: string | null;
  apply_url: string | null;
  url: string;
  location: string | null;
  salary_text: string | null;
  created_at: string;
};

type Draft = {
  job: JobPost;
  subject: string;
  cover_letter: string;
  tailored_bullets: string[];
  pitch_id: string | null;
  apply_email: string | null;
  apply_url: string | null;
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
  const [posts, setPosts] = useState<JobPost[]>([]);
  const [scanning, setScanning] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = async () => {
    if (!user) return;
    const days = RANGE_OPTIONS.find((r) => r.key === range)!.days;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);

    const [postsRes, leadsRes, sentRes, eventsRes, budgetRes, topPostsRes] = await Promise.all([
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
      supabase.from("job_posts")
        .select("id, title, company, score, source, status, apply_email, apply_url, url, location, salary_text, created_at")
        .eq("user_id", user.id)
        .gte("score", 60)
        .order("score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const allPosts = postsRes.data ?? [];
    const matched = allPosts.filter((p: any) => (p.score ?? 0) >= 60);
    const sent = sentRes.data ?? [];
    const events = (eventsRes.data ?? []) as any[];
    const bounced = events.filter((e) => e.event_type === "bounced").length;
    const replied = events.filter((e) => e.event_type === "replied").length;
    const interviews = (leadsRes.data ?? []).filter((l: any) => l.reply_intent === "job_interview").length;

    const sourceCounts = new Map<string, number>();
    for (const p of allPosts as any[]) {
      const s = p.source || "?";
      sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
    }
    const topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count).slice(0, 3);

    const avgMatchScore = matched.length
      ? Math.round(matched.reduce((a: number, p: any) => a + (p.score ?? 0), 0) / matched.length)
      : 0;

    setStats({
      scanned: allPosts.length, matched: matched.length, sent: sent.length,
      bounced, replied, interviews, avgMatchScore, topSources,
    });
    setBudget((budgetRes.data as Budget) ?? null);
    setPosts((topPostsRes.data as JobPost[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id, range]);

  const scan = async () => {
    setScanning(true);
    try {
      await supabase.functions.invoke("scan-jobs", { body: {} });
      toast.success("Scan started", { description: "New posts will appear in ~30s." });
      setTimeout(load, 25000);
    } catch (e: any) { toast.error(e?.message || "Scan failed"); }
    finally { setScanning(false); }
  };

  const reallocate = async () => {
    try {
      await supabase.functions.invoke("allocate-email-budget", { body: { user_id: user?.id } });
      await load();
      toast.success("Budget reallocated for today");
    } catch (e: any) { toast.error(e?.message || "Reallocate failed"); }
  };

  const generateDraft = async (job: JobPost) => {
    setDraftingId(job.id);
    try {
      const { data, error } = await supabase.functions.invoke("draft-application", {
        body: { job_post_id: job.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Draft failed");
      setDraft({
        job,
        subject: data.subject ?? `Application: ${job.title}`,
        cover_letter: data.cover_letter ?? "",
        tailored_bullets: data.tailored_bullets ?? [],
        pitch_id: data.pitch_id ?? null,
        apply_email: data.apply_email ?? job.apply_email,
        apply_url: data.apply_url ?? job.apply_url,
      });
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Draft failed");
    } finally {
      setDraftingId(null);
    }
  };

  const copy = async (txt: string, label: string) => {
    try { await navigator.clipboard.writeText(txt); toast.success(`${label} copied`); }
    catch { toast.error("Copy failed"); }
  };

  const jobCap = budget?.jobhunt_cap ?? 25;
  const jobSent = budget?.jobhunt_sent ?? 0;
  const outCap = budget?.outreach_cap ?? 60;
  const outSent = budget?.outreach_sent ?? 0;
  const jobPct = jobCap > 0 ? Math.min(100, Math.round((jobSent / jobCap) * 100)) : 0;
  const outPct = outCap > 0 ? Math.min(100, Math.round((outSent / outCap) * 100)) : 0;

  const fullBody = draft
    ? `${draft.cover_letter}\n\n— Highlights —\n${draft.tailored_bullets.map((b) => `• ${b}`).join("\n")}`
    : "";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4" /> Job Hunt
          </CardTitle>
          <div className="flex items-center gap-1">
            {RANGE_OPTIONS.map((r) => (
              <Button key={r.key} size="sm"
                variant={range === r.key ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs" onClick={() => setRange(r.key)}
              >{r.label}</Button>
            ))}
            <Button size="sm" variant="outline" className="h-7" onClick={scan} disabled={scanning}>
              <RefreshCw className={scanning ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Scan
            </Button>
            <Button size="sm" variant="ghost" className="h-7" asChild>
              <Link to="/leads"><ExternalLink className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Budget */}
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
          </div>

          {/* Stats */}
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
                  <Badge key={s.source} variant="secondary" className="text-[10px]">
                    {s.source} · {s.count}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Matched job posts list with draft buttons */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Matched postings ({posts.length})
              </div>
            </div>
            {posts.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                No matched postings yet. Run a scan to populate.
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {posts.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{p.title}</span>
                        <Badge variant="outline" className="text-[10px]">{p.score ?? 0}</Badge>
                        {p.status === "drafted" && (
                          <Badge variant="secondary" className="text-[10px]">drafted</Badge>
                        )}
                        {p.status === "stale" && (
                          <Badge variant="destructive" className="text-[10px]">stale</Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[p.company, p.location, p.salary_text, p.source].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7" asChild>
                      <a href={p.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-7"
                      onClick={() => generateDraft(p)}
                      disabled={draftingId === p.id}
                    >
                      {draftingId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      {p.status === "drafted" ? "Re-draft" : "Generate draft"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Draft preview dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{draft?.job.title}</DialogTitle>
            <DialogDescription className="truncate">
              {[draft?.job.company, draft?.job.location, draft?.job.source].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Subject</span>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => copy(draft.subject, "Subject")}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <Input value={draft.subject} readOnly />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Cover letter + highlights</span>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => copy(fullBody, "Body")}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <Textarea value={fullBody} readOnly rows={14} className="font-mono text-xs" />
              </div>
              {(draft.apply_email || draft.apply_url) && (
                <div className="rounded-md border bg-muted/30 p-2 text-xs">
                  {draft.apply_email && <div>Apply email: <span className="font-mono">{draft.apply_email}</span></div>}
                  {draft.apply_url && <div className="truncate">Apply URL: <a className="underline" href={draft.apply_url} target="_blank" rel="noreferrer">{draft.apply_url}</a></div>}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Close</Button>
            {draft?.apply_url && (
              <Button asChild>
                <a href={draft.apply_url} target="_blank" rel="noreferrer">
                  Open apply page <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
