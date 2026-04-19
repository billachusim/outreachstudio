import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { seedOfferingsIfEmpty } from "@/lib/seedOfferings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Pause, Play, Activity, Send, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

  useEffect(() => { document.title = "Studio · Outreach Studio"; }, []);

  const load = async () => {
    if (!user) return;
    await seedOfferingsIfEmpty(user.id);
    const [{ data: rs }, { data: cs }, { data: es }] = await Promise.all([
      supabase.from("campaign_runs").select("*").order("updated_at", { ascending: false }).limit(20),
      supabase.from("campaigns").select("id,name"),
      supabase.from("run_events").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    setRuns((rs as Run[]) ?? []);
    const map: Record<string, string> = {};
    (cs as Campaign[] ?? []).forEach((c) => (map[c.id] = c.name));
    setCampaigns(map);
    setEvents((es as Event[]) ?? []);

    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("pitches").select("id", { count: "exact", head: true })
      .gte("sent_at", start.toISOString());
    setSentToday(count ?? 0);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_runs" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "run_events" }, load)
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

  const active = runs.filter((r) => !["done", "failed"].includes(r.state));
  const finished = runs.filter((r) => ["done", "failed"].includes(r.state));

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Studio</h1>
          <p className="text-sm text-muted-foreground">Live view of your automated outreach.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Card className="px-4 py-2">
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
              return (
                <div key={r.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{campaigns[r.campaign_id] ?? "(campaign)"}</span>
                      <Badge className={stateColors[r.state] ?? ""}>{r.state}</Badge>
                      {r.error && <span className="text-xs text-destructive">{r.error}</span>}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => togglePause(r)}>
                      {r.state === "paused" ? <><Play className="h-3.5 w-3.5" /> Resume</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
                    </Button>
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

export default Dashboard;
