import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Briefcase, ArrowRight, FileText } from "lucide-react";
import { toast } from "sonner";

type Top = { id: string; title: string; company: string | null; score: number | null; source: string | null; status: string | null };

export const JobsSummaryCard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({ scanned: 0, matched: 0, drafted: 0, sent: 0, cap: 0 });
  const [top, setTop] = useState<Top[]>([]);
  const [drafting, setDrafting] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const [postsRes, topRes, budgetRes] = await Promise.all([
      supabase.from("job_posts").select("score, status").eq("user_id", user.id).gte("created_at", since),
      supabase.from("job_posts")
        .select("id,title,company,score,source,status")
        .eq("user_id", user.id).gte("score", 60)
        .order("created_at", { ascending: false }).limit(3),
      supabase.from("email_budgets")
        .select("jobhunt_cap, jobhunt_sent")
        .eq("user_id", user.id).eq("date", today).maybeSingle(),
    ]);
    const all = postsRes.data ?? [];
    setStats({
      scanned: all.length,
      matched: all.filter((p: any) => (p.score ?? 0) >= 60).length,
      drafted: all.filter((p: any) => p.status === "drafted").length,
      sent: (budgetRes.data as any)?.jobhunt_sent ?? 0,
      cap: (budgetRes.data as any)?.jobhunt_cap ?? 0,
    });
    setTop((topRes.data as Top[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const draft = async (id: string) => {
    setDrafting(id);
    try {
      const { error } = await supabase.functions.invoke("draft-application", { body: { job_post_id: id } });
      if (error) throw error;
      toast.success("Draft generated — open Jobs to view");
      load();
    } catch (e: any) { toast.error(e?.message ?? "Draft failed"); }
    finally { setDrafting(null); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4" /> Job Hunt
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link to="/jobs">Open hub <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Scanned <strong className="text-foreground">{stats.scanned}</strong></span>
          <span>Matched <strong className="text-foreground">{stats.matched}</strong></span>
          <span>Drafts <strong className="text-foreground">{stats.drafted}</strong></span>
          <span>Sent today <strong className="text-foreground">{stats.sent}/{stats.cap || "—"}</strong></span>
        </div>
        {top.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            No matches yet. <Link to="/jobs" className="text-primary hover:underline">Open Jobs</Link> to scan.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {top.map((p) => (
              <div key={p.id} className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.title}</span>
                    <Badge variant="outline" className="text-[10px]">{p.score ?? 0}</Badge>
                    {p.status === "drafted" && <Badge variant="secondary" className="text-[10px]">drafted</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.company, p.source].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7" disabled={drafting === p.id} onClick={() => draft(p.id)}>
                  <FileText className="h-3.5 w-3.5" /> {p.status === "drafted" ? "Re-draft" : "Draft"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
