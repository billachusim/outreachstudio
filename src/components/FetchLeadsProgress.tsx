import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles, Loader2, Square, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type FetchRun = {
  id: string;
  state: "planning" | "searching" | "enriching" | "done" | "failed" | "stopped";
  hard_ceiling: number;
  queries_planned: number;
  queries_run: number;
  candidates_seen: number;
  inserted_count: number;
  high_quality_count: number;
  enriched_count: number;
  current_query: string | null;
  credits_estimate: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE = new Set(["planning", "searching", "enriching"]);

type Props = {
  /** "button" = compact button + popover (Leads page); "card" = full card (Dashboard) */
  variant?: "button" | "card";
  /** Called when a new run finishes — useful to refresh the leads list */
  onChange?: (run: FetchRun | null) => void;
};

export const FetchLeadsProgress = ({ variant = "button", onChange }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [run, setRun] = useState<FetchRun | null>(null);
  const [starting, setStarting] = useState(false);

  const loadLatest = async () => {
    if (!user) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("lead_fetch_runs")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRun((data as FetchRun) ?? null);
    onChange?.((data as FetchRun) ?? null);
  };

  useEffect(() => {
    loadLatest();
    if (!user) return;
    const ch = supabase
      .channel(`fetch-runs-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_fetch_runs", filter: `user_id=eq.${user.id}` }, (payload: any) => {
        const next = (payload.new ?? payload.old) as FetchRun;
        setRun((prev) => {
          // Show the most recent row
          if (!prev || new Date(next.created_at) >= new Date(prev.created_at)) return next;
          return prev;
        });
        onChange?.(next);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const startFetch = async () => {
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-leads", { body: {} });
      if (error) throw error;
      const d = data as { runId?: string; alreadyRunning?: boolean; error?: string };
      if (d?.error) throw new Error(d.error);
      if (d?.alreadyRunning) toast({ title: "A fetch is already running" });
      else toast({ title: "Fetch started", description: "AI is planning search queries…" });
      loadLatest();
    } catch (e: any) {
      toast({ title: "Failed to start", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const stopFetch = async () => {
    if (!run) return;
    await supabase.from("lead_fetch_runs").update({ state: "stopped" }).eq("id", run.id);
    toast({ title: "Stopping…", description: "Finishing current query then exiting." });
  };

  const isActive = run && ACTIVE.has(run.state);
  const isRecent = run && !isActive && new Date(run.updated_at) > new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pct = run && run.queries_planned > 0 ? Math.round((run.queries_run / run.queries_planned) * 100) : 0;

  // BUTTON variant — for Leads page header
  if (variant === "button") {
    if (!isActive) {
      return (
        <Button size="sm" variant="outline" onClick={startFetch} disabled={starting}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Fetch leads
        </Button>
      );
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary" className="gap-1.5">
            <Loader2 className="h-4 w-4 animate-spin" />
            Fetching… {run!.inserted_count} found · {run!.high_quality_count} hot
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <ProgressDetail run={run!} pct={pct} onStop={stopFetch} />
        </PopoverContent>
      </Popover>
    );
  }

  // CARD variant — for Dashboard
  if (!isActive && !isRecent) return null;
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isActive ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : run!.state === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
          <span className="text-sm font-medium">Lead fetch run</span>
          <Badge variant="outline" className="capitalize text-xs">{run!.state}</Badge>
        </div>
        {isActive && <Button size="sm" variant="ghost" onClick={stopFetch}><Square className="h-3.5 w-3.5" /> Stop</Button>}
      </div>
      <ProgressDetail run={run!} pct={pct} onStop={stopFetch} hideStop />
      {!isActive && (
        <a href="/leads?campaign=__raw__" className="text-xs text-primary hover:underline">View raw leads →</a>
      )}
    </div>
  );
};

const ProgressDetail = ({ run, pct, onStop, hideStop }: { run: FetchRun; pct: number; onStop: () => void; hideStop?: boolean }) => {
  const isActive = ACTIVE.has(run.state);
  return (
    <div className="space-y-3">
      {isActive && (
        <>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span className="capitalize">{run.state}</span>
              <span>{run.queries_run} / {run.queries_planned} queries</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
          {run.current_query && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Now:</span> {run.current_query}
            </p>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Candidates seen" value={run.candidates_seen} />
        <Stat label="Inserted" value={run.inserted_count} />
        <Stat label="High quality (≥50)" value={run.high_quality_count} tone="success" />
        <Stat label="Enriched" value={run.enriched_count} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        ~{run.credits_estimate} Firecrawl credits · ceiling {run.hard_ceiling}
      </p>
      {run.error && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{run.error}</span>
        </div>
      )}
      {isActive && !hideStop && (
        <Button size="sm" variant="outline" className="w-full" onClick={onStop}>
          <Square className="h-3.5 w-3.5" /> Stop
        </Button>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone?: "success" }) => (
  <div className="rounded-md border p-2">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`text-base font-semibold ${tone === "success" ? "text-success" : ""}`}>{value}</div>
  </div>
);
