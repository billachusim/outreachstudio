import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Briefcase, RefreshCw, FileText, ExternalLink, Copy, Loader2, Search, Filter, Wand2,
  ChevronDown, ChevronRight, Mail,
} from "lucide-react";
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
  draft?: Draft | null;
  draft_updated_at?: string | null;
  application_kit?: ApplicationKit | null;
  application_kit_updated_at?: string | null;
};
type Draft = {
  subject: string;
  cover_letter: string;
  tailored_bullets: string[];
  apply_email?: string | null;
  apply_url?: string | null;
  pitch_id?: string | null;
};

export const JobMatchesList = ({ onChanged }: { onChanged?: () => void }) => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<JobPost[]>([]);
  const [scanning, setScanning] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [kitJob, setKitJob] = useState<JobPost | null>(null);
  const [kit, setKit] = useState<ApplicationKit | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(60);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("job_posts")
      .select("id, title, company, score, source, status, apply_email, apply_url, url, location, salary_text, created_at, draft, draft_updated_at, application_kit, application_kit_updated_at")
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
      await load();
      setExpandedId(job.id);
      onChanged?.();
      toast.success("Draft ready");
    } catch (e: any) { toast.error(e?.message || "Draft failed"); }
    finally { setDraftingId(null); }
  };

  const runApplyAssistant = async (job: JobPost) => {
    setApplyingId(job.id);
    try {
      const { data, error } = await supabase.functions.invoke("apply-assistant", { body: { job_post_id: job.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Apply Assistant failed");
      setKitJob(job);
      setKit(data.kit as ApplicationKit);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || "Apply Assistant failed");
    } finally { setApplyingId(null); }
  };

  const openKit = (job: JobPost) => {
    if (job.application_kit) {
      setKitJob(job);
      setKit(job.application_kit);
    } else {
      runApplyAssistant(job);
    }
  };

  const copy = async (txt: string, label: string) => {
    try { await navigator.clipboard.writeText(txt); toast.success(`${label} copied`); }
    catch { toast.error("Copy failed"); }
  };

  const sourceOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of posts) if (p.source) s.add(p.source);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [posts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if ((p.score ?? 0) < minScore) return false;
      if (statusFilter !== "all" && (p.status ?? "new") !== statusFilter) return false;
      if (sourceFilter !== "all" && (p.source ?? "") !== sourceFilter) return false;
      if (!q) return true;
      return (p.title + " " + (p.company ?? "") + " " + (p.location ?? "") + " " + (p.source ?? "")).toLowerCase().includes(q);
    });
  }, [posts, search, minScore, statusFilter, sourceFilter]);

  const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleString() : "";

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
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_160px_180px]">
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
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
              title="Filter by job source"
            >
              <option value="all">All sources</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No postings match. Try lowering the score filter or scanning.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {filtered.map((p) => {
                const isOpen = expandedId === p.id;
                const hasDraft = !!p.draft;
                const hasKit = !!p.application_kit;
                return (
                  <div key={p.id} className="bg-background">
                    {/* Row header — click to expand */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedId(isOpen ? null : p.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(isOpen ? null : p.id); } }}
                      className="flex flex-wrap items-center gap-2 p-2.5 hover:bg-muted/40 cursor-pointer"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{p.title}</span>
                          <Badge variant="outline" className="text-[10px]">{p.score ?? 0}</Badge>
                          {p.status === "drafted" && <Badge variant="secondary" className="text-[10px]">drafted</Badge>}
                          {p.status === "stale" && <Badge variant="destructive" className="text-[10px]">stale</Badge>}
                          {p.status === "sent" && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px]">sent</Badge>}
                          {hasDraft && <Badge variant="outline" className="text-[10px]"><FileText className="h-2.5 w-2.5" /> draft</Badge>}
                          {hasKit && <Badge variant="outline" className="text-[10px]"><Wand2 className="h-2.5 w-2.5" /> kit</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.company, p.location, p.salary_text, p.source].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7" asChild onClick={(e) => e.stopPropagation()}>
                        <a href={p.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                      </Button>
                      <Button size="sm" variant="outline" className="h-7"
                              onClick={(e) => { e.stopPropagation(); hasDraft ? setExpandedId(p.id) : generateDraft(p); }}
                              disabled={draftingId === p.id}>
                        {draftingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        {hasDraft ? "View draft" : "Draft"}
                      </Button>
                      <Button size="sm" variant="default" className="h-7"
                              onClick={(e) => { e.stopPropagation(); openKit(p); }}
                              disabled={applyingId === p.id}
                              title={hasKit ? "Open saved application kit" : "Scrape the listing and prep every form answer"}>
                        {applyingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                        {hasKit ? "View kit" : "Apply"}
                      </Button>
                    </div>

                    {/* Expanded panel */}
                    {isOpen && (
                      <div className="space-y-4 border-t bg-muted/20 p-3">
                        {!hasDraft && !hasKit && (
                          <div className="rounded-md border border-dashed bg-background p-4 text-center text-xs text-muted-foreground">
                            Nothing saved yet. Click <span className="font-medium">Draft</span> for a tailored cover letter, or <span className="font-medium">Apply</span> to scrape the listing and prep every form answer.
                          </div>
                        )}

                        {hasDraft && p.draft && (
                          <div className="space-y-2 rounded-md border bg-background p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5" />
                                <span className="text-sm font-semibold">Saved draft</span>
                                <span className="text-[10px] text-muted-foreground">{fmtDate(p.draft_updated_at)}</span>
                              </div>
                              <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                                      onClick={() => generateDraft(p)} disabled={draftingId === p.id}>
                                {draftingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                Re-draft
                              </Button>
                            </div>

                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-muted-foreground">Subject</span>
                                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => copy(p.draft!.subject, "Subject")}>
                                  <Copy className="h-3 w-3" /> Copy
                                </Button>
                              </div>
                              <Input value={p.draft.subject} readOnly className="h-8 text-xs" />
                            </div>

                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-muted-foreground">Cover letter + highlights</span>
                                <Button size="sm" variant="ghost" className="h-6 text-[11px]"
                                        onClick={() => copy(
                                          `${p.draft!.cover_letter}\n\n— Highlights —\n${(p.draft!.tailored_bullets ?? []).map(b => `• ${b}`).join("\n")}`,
                                          "Body")}>
                                  <Copy className="h-3 w-3" /> Copy
                                </Button>
                              </div>
                              <Textarea
                                value={`${p.draft.cover_letter}\n\n— Highlights —\n${(p.draft.tailored_bullets ?? []).map(b => `• ${b}`).join("\n")}`}
                                readOnly rows={12} className="font-mono text-xs"
                              />
                            </div>

                            <div className="flex flex-wrap gap-2 pt-1">
                              {(p.draft.apply_email || p.apply_email) && (
                                <Button size="sm" variant="outline" asChild>
                                  <a href={`mailto:${p.draft.apply_email || p.apply_email}`}><Mail className="h-3.5 w-3.5" /> Email</a>
                                </Button>
                              )}
                              {(p.draft.apply_url || p.apply_url) && (
                                <Button size="sm" asChild>
                                  <a href={p.draft.apply_url || p.apply_url || "#"} target="_blank" rel="noreferrer">
                                    Open apply page <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {hasKit && p.application_kit && (
                          <div className="space-y-2 rounded-md border bg-background p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Wand2 className="h-3.5 w-3.5" />
                                <span className="text-sm font-semibold">Application kit</span>
                                <span className="text-[10px] text-muted-foreground">{fmtDate(p.application_kit_updated_at)}</span>
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openKit(p)}>
                                  Open
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                                        onClick={() => runApplyAssistant(p)} disabled={applyingId === p.id}>
                                  {applyingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                  Re-run
                                </Button>
                              </div>
                            </div>
                            <div className="grid gap-1 text-xs sm:grid-cols-3">
                              <div><span className="text-muted-foreground">Method:</span> {p.application_kit.apply_method ?? "—"}</div>
                              <div><span className="text-muted-foreground">Questions:</span> {p.application_kit.detected_questions?.length ?? 0}</div>
                              <div><span className="text-muted-foreground">Missing:</span> {p.application_kit.missing_info?.length ?? 0}</div>
                            </div>
                            {p.application_kit.summary && (
                              <p className="text-xs text-muted-foreground">{p.application_kit.summary}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ApplyKitDialog
        open={!!kitJob}
        onOpenChange={(o) => { if (!o) { setKitJob(null); setKit(null); } }}
        job={kitJob}
        kit={kit}
      />
    </>
  );
};
