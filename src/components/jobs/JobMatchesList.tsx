import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Briefcase, RefreshCw, FileText, ExternalLink, Copy, Loader2, Search, Filter, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { ApplyKitDialog, type ApplicationKit } from "./ApplyKitDialog";

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
  apply_email: string | null;
  apply_url: string | null;
};

export const JobMatchesList = ({ onChanged }: { onChanged?: () => void }) => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<JobPost[]>([]);
  const [scanning, setScanning] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [kitJob, setKitJob] = useState<JobPost | null>(null);
  const [kit, setKit] = useState<ApplicationKit | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(60);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("job_posts")
      .select("id, title, company, score, source, status, apply_email, apply_url, url, location, salary_text, created_at")
      .eq("user_id", user.id)
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    setPosts((data as JobPost[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const scan = async () => {
    setScanning(true);
    try {
      await supabase.functions.invoke("scan-jobs", { body: {} });
      toast.success("Scan started", { description: "New posts will appear in ~30s." });
      setTimeout(() => { load(); onChanged?.(); }, 25000);
    } catch (e: any) { toast.error(e?.message || "Scan failed"); }
    finally { setScanning(false); }
  };

  const generateDraft = async (job: JobPost) => {
    setDraftingId(job.id);
    try {
      const { data, error } = await supabase.functions.invoke("draft-application", { body: { job_post_id: job.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Draft failed");
      setDraft({
        job,
        subject: data.subject ?? `Application: ${job.title}`,
        cover_letter: data.cover_letter ?? "",
        tailored_bullets: data.tailored_bullets ?? [],
        apply_email: data.apply_email ?? job.apply_email,
        apply_url: data.apply_url ?? job.apply_url,
      });
      await load();
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Draft failed"); }
    finally { setDraftingId(null); }
  };

  const runApplyAssistant = async (job: JobPost) => {
    setApplyingId(job.id);
    setKitJob(job);
    setKit(null);
    try {
      const { data, error } = await supabase.functions.invoke("apply-assistant", { body: { job_post_id: job.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Apply Assistant failed");
      setKit(data.kit as ApplicationKit);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || "Apply Assistant failed");
      setKitJob(null);
    } finally { setApplyingId(null); }
  };

  const openExistingKit = async (job: JobPost) => {
    const { data } = await supabase.from("job_posts")
      .select("application_kit").eq("id", job.id).maybeSingle();
    if (data?.application_kit) {
      setKitJob(job);
      setKit(data.application_kit as ApplicationKit);
    } else {
      runApplyAssistant(job);
    }
  };

  const copy = async (txt: string, label: string) => {
    try { await navigator.clipboard.writeText(txt); toast.success(`${label} copied`); }
    catch { toast.error("Copy failed"); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if ((p.score ?? 0) < minScore) return false;
      if (statusFilter !== "all" && (p.status ?? "new") !== statusFilter) return false;
      if (!q) return true;
      return (p.title + " " + (p.company ?? "") + " " + (p.location ?? "") + " " + (p.source ?? "")).toLowerCase().includes(q);
    });
  }, [posts, search, minScore, statusFilter]);

  const fullBody = draft ? `${draft.cover_letter}\n\n— Highlights —\n${draft.tailored_bullets.map((b) => `• ${b}`).join("\n")}` : "";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4" /> Matched postings ({filtered.length})
          </CardTitle>
          <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
            <RefreshCw className={scanning ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_160px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, company, source…" className="pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}
              >
                <option value={0}>Any score</option>
                <option value={40}>≥ 40</option>
                <option value={60}>≥ 60</option>
                <option value={75}>≥ 75</option>
                <option value={85}>≥ 85</option>
              </select>
            </div>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="new">New</option>
              <option value="drafted">Drafted</option>
              <option value="sent">Sent</option>
              <option value="stale">Stale</option>
              <option value="dedup_existing">Dedup</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No postings match. Try lowering the score filter or scanning.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {filtered.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.title}</span>
                      <Badge variant="outline" className="text-[10px]">{p.score ?? 0}</Badge>
                      {p.status === "drafted" && <Badge variant="secondary" className="text-[10px]">drafted</Badge>}
                      {p.status === "stale" && <Badge variant="destructive" className="text-[10px]">stale</Badge>}
                      {p.status === "sent" && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px]">sent</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[p.company, p.location, p.salary_text, p.source].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7" asChild>
                    <a href={p.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                  </Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => generateDraft(p)} disabled={draftingId === p.id}>
                    {draftingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    {p.status === "drafted" ? "Re-draft" : "Draft"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                <a href={draft.apply_url} target="_blank" rel="noreferrer">Open apply page <ExternalLink className="h-3.5 w-3.5" /></a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
