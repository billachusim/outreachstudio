import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CvUploadCard } from "@/components/CvUploadCard";
import { Sparkles, Loader2, Copy, Download, Printer, Save } from "lucide-react";
import { toast } from "sonner";

type Job = { id: string; title: string; company: string | null; score: number | null };

export const CvTailorPanel = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [jdText, setJdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ markdown: string; summary_of_changes: string; keyword_match_score: number | null; matched_keywords: string[] } | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("job_posts")
      .select("id,title,company,score")
      .eq("user_id", user.id).gte("score", 50)
      .order("created_at", { ascending: false }).limit(50);
    setJobs((data as Job[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const tailor = async (save: boolean) => {
    if (!jobId && jdText.trim().length < 40) {
      return toast.error("Pick a job or paste a job description (min 40 chars).");
    }
    setBusy(true);
    setOut(null);
    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: {
          job_post_id: jobId || undefined,
          jd_text: jdText.trim() || undefined,
          save_to_job: save && !!jobId,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Tailor failed");
      setOut({
        markdown: data.markdown,
        summary_of_changes: data.summary_of_changes ?? "",
        keyword_match_score: data.keyword_match_score ?? null,
        matched_keywords: data.matched_keywords ?? [],
      });
      toast.success(save && jobId ? "Tailored CV saved to job post" : "Tailored CV generated");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!out) return;
    try { await navigator.clipboard.writeText(out.markdown); toast.success("Markdown copied"); }
    catch { toast.error("Copy failed"); }
  };

  const downloadMd = () => {
    if (!out) return;
    const blob = new Blob([out.markdown], { type: "text/markdown" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u; a.download = "tailored-cv.md"; a.click();
    URL.revokeObjectURL(u);
  };

  const printPdf = () => {
    if (!out) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tailored CV</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Inter, system-ui, sans-serif; color:#111; max-width: 760px; margin: 40px auto; padding: 0 24px; line-height:1.45; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; border-bottom: 1px solid #999; padding-bottom: 2pt; margin: 16pt 0 6pt; text-transform: uppercase; letter-spacing: .04em; }
  h3 { font-size: 11pt; margin: 10pt 0 2pt; }
  p, li { font-size: 10.5pt; }
  ul { padding-left: 18pt; margin: 4pt 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 12pt 0; }
  a { color: #1a4fa3; text-decoration: none; }
  @media print { body { margin: 0; } }
</style></head><body>${mdToHtml(out.markdown)}<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return toast.error("Pop-up blocked — allow pop-ups to print.");
    w.document.write(html); w.document.close();
  };

  return (
    <div className="space-y-4">
      <CvUploadCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Tailor your CV to a job
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pick a scanned posting or paste a job description. The agent rewrites your CV to surface the most relevant skills and keywords — without inventing experience.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase text-muted-foreground">Pick a scanned posting (optional)</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={jobId} onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">— None (use pasted description) —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  [{j.score ?? 0}] {j.title}{j.company ? ` · ${j.company}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase text-muted-foreground">Or paste a job description</Label>
            <Textarea
              rows={8}
              placeholder="Paste the full JD here — responsibilities, requirements, stack…"
              value={jdText} onChange={(e) => setJdText(e.target.value)}
              className="text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => tailor(false)} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "Tailoring…" : "Generate tailored CV"}
            </Button>
            {jobId && (
              <Button variant="outline" onClick={() => tailor(true)} disabled={busy}>
                <Save className="h-4 w-4" /> Generate &amp; save to job
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {out && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Tailored CV</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {out.keyword_match_score !== null && (
                  <Badge variant="secondary">Match {out.keyword_match_score}/100</Badge>
                )}
                <Button size="sm" variant="ghost" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copy MD</Button>
                <Button size="sm" variant="ghost" onClick={downloadMd}><Download className="h-3.5 w-3.5" /> .md</Button>
                <Button size="sm" variant="ghost" onClick={printPdf}><Printer className="h-3.5 w-3.5" /> Print / PDF</Button>
              </div>
            </div>
            {out.summary_of_changes && (
              <p className="mt-2 text-xs text-muted-foreground"><strong>Changes:</strong> {out.summary_of_changes}</p>
            )}
            {out.matched_keywords?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {out.matched_keywords.slice(0, 20).map((k) => (
                  <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div
              className="max-w-none rounded-md border bg-muted/20 p-4 text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:border-b [&_h2]:pb-1 [&_h3]:font-semibold [&_h3]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-1 [&_a]:text-primary [&_a]:underline [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: mdToHtml(out.markdown) }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// Minimal, safe-enough Markdown → HTML for known agent output.
// Avoids adding a new dep; output is non-user-generated (model-controlled per-user).
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const close = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*$/.test(line)) { close(); out.push(""); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { close(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(esc(h[2]))}</h${lvl}>`); continue; }
    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(esc(li[1]))}</li>`); continue; }
    if (/^---+$/.test(line)) { close(); out.push("<hr>"); continue; }
    close();
    out.push(`<p>${inline(esc(line))}</p>`);
  }
  close();
  return out.join("\n");
  function inline(s: string) {
    return s
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
}
