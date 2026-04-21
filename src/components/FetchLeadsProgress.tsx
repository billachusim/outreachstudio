import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Loader2, Square, AlertCircle, CheckCircle2, Settings2, Repeat, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type FetchRun = {
  id: string;
  state: "planning" | "searching" | "enriching" | "done" | "failed" | "stopped";
  hard_ceiling: number;
  max_leads: number;
  max_retries: number;
  queries_planned: number;
  queries_run: number;
  query_attempts: number;
  retries_used: number;
  candidates_seen: number;
  inserted_count: number;
  high_quality_count: number;
  enriched_count: number;
  current_query: string | null;
  credits_estimate: number;
  aggregators_exploded: number;
  extracted_businesses: number;
  error: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE = new Set(["planning", "searching", "enriching"]);

type Props = {
  variant?: "button" | "card";
  onChange?: (run: FetchRun | null) => void;
};

const DEFAULT_MAX_LEADS = 200;
const DEFAULT_MAX_RETRIES = 4;

export const FetchLeadsProgress = ({ variant = "button", onChange }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [run, setRun] = useState<FetchRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [maxLeads, setMaxLeads] = useState<number>(DEFAULT_MAX_LEADS);
  const [maxRetries, setMaxRetries] = useState<number>(DEFAULT_MAX_RETRIES);
  const [controlsOpen, setControlsOpen] = useState(false);

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
    setControlsOpen(false);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-leads", {
        body: { maxLeads, maxRetries },
      });
      if (error) throw error;
      const d = data as { runId?: string; alreadyRunning?: boolean; error?: string };
      if (d?.error) throw new Error(d.error);
      if (d?.alreadyRunning) toast({ title: "A fetch is already running" });
      else toast({ title: "Fetch started", description: `Cap ${maxLeads} leads · up to ${maxRetries} attempts/query` });
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
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={startFetch} disabled={starting} className="gap-1.5">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Fetch leads
          </Button>
          <Popover open={controlsOpen} onOpenChange={setControlsOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="px-2" title="Fetch limits">
                <Settings2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <FetchControls
                maxLeads={maxLeads}
                maxRetries={maxRetries}
                onChangeLeads={setMaxLeads}
                onChangeRetries={setMaxRetries}
              />
            </PopoverContent>
          </Popover>
        </div>
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
        <PopoverContent className="w-96" align="end">
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

const FetchControls = ({
  maxLeads,
  maxRetries,
  onChangeLeads,
  onChangeRetries,
}: {
  maxLeads: number;
  maxRetries: number;
  onChangeLeads: (n: number) => void;
  onChangeRetries: (n: number) => void;
}) => {
  // Rough cost estimate: 8 queries × maxRetries (worst-case attempts) + 25 scrapes
  const estCredits = Math.round(8 * Math.min(maxRetries, 4) * 0.6 + 25);
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Fetch limits</h4>
        <p className="text-xs text-muted-foreground">Tune cost vs coverage before starting.</p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs">Max leads (hard cap)</Label>
          <span className="text-xs font-medium tabular-nums">{maxLeads}</span>
        </div>
        <Slider
          value={[maxLeads]}
          min={20}
          max={500}
          step={10}
          onValueChange={(v) => onChangeLeads(v[0])}
        />
        <p className="text-[10px] text-muted-foreground">Stops inserting once this many raw leads land.</p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between">
          <Label className="text-xs">Max retry budget per query</Label>
          <span className="text-xs font-medium tabular-nums">{maxRetries}</span>
        </div>
        <Slider
          value={[maxRetries]}
          min={1}
          max={4}
          step={1}
          onValueChange={(v) => onChangeRetries(v[0])}
        />
        <p className="text-[10px] text-muted-foreground">
          1 = primary only · 4 = full fallback chain (region → no-loc → bare query).
        </p>
      </div>

      <Separator />
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Est. credits / run</span>
        <span className="flex items-center gap-1 font-medium">
          <Coins className="h-3 w-3" /> ~{estCredits}
        </span>
      </div>
    </div>
  );
};

const ProgressDetail = ({ run, pct, onStop, hideStop }: { run: FetchRun; pct: number; onStop: () => void; hideStop?: boolean }) => {
  const isActive = ACTIVE.has(run.state);
  const cap = run.max_leads || run.hard_ceiling || 200;
  const remaining = Math.max(0, cap - run.inserted_count);
  // remaining credits ≈ (queries left × avg attempts) + (scrape budget left)
  const queriesLeft = Math.max(0, run.queries_planned - run.queries_run);
  const avgAttempts = run.queries_run > 0 ? run.query_attempts / run.queries_run : 1;
  const remainingCredits = Math.max(0, Math.round(queriesLeft * avgAttempts + Math.min(25 - run.enriched_count, 25)));

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
        <Stat label="Inserted" value={`${run.inserted_count}/${cap}`} />
        <Stat label="High quality (≥50)" value={run.high_quality_count} tone="success" />
        <Stat label="Enriched" value={run.enriched_count} />
        <Stat label="Query attempts" value={run.query_attempts} icon={<Repeat className="h-3 w-3" />} />
        <Stat label="Retries used" value={`${run.retries_used}/${run.max_retries * Math.max(run.queries_planned, 1)}`} />
      </div>
      <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-[11px]">
        <span className="text-muted-foreground">~{run.credits_estimate} credits used</span>
        {isActive && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Coins className="h-3 w-3" /> ~{remainingCredits} remaining · {remaining} leads to cap
          </span>
        )}
      </div>

      {/* Post-run summary */}
      {!isActive && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Run summary</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <SummaryRow label="State" value={<span className="capitalize">{run.state}</span>} />
            <SummaryRow label="Queries planned" value={run.queries_planned} />
            <SummaryRow label="Queries run" value={run.queries_run} />
            <SummaryRow label="Search attempts" value={run.query_attempts} />
            <SummaryRow label="Total candidates" value={run.candidates_seen} />
            <SummaryRow label="Inserted leads" value={run.inserted_count} />
            <SummaryRow label="High-quality" value={run.high_quality_count} />
            <SummaryRow label="Credits used" value={`~${run.credits_estimate}`} />
          </div>
          {run.inserted_count === 0 && run.failure_reason && (
            <div className="flex items-start gap-1.5 rounded border border-warning/40 bg-warning/5 p-2 text-[11px] text-warning-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <div>
                <div className="font-medium text-warning">Why zero leads?</div>
                <div className="text-muted-foreground">{run.failure_reason}</div>
              </div>
            </div>
          )}
        </div>
      )}

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

const Stat = ({ label, value, tone, icon }: { label: string; value: number | string; tone?: "success"; icon?: React.ReactNode }) => (
  <div className="rounded-md border p-2">
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {icon} {label}
    </div>
    <div className={`text-base font-semibold tabular-nums ${tone === "success" ? "text-success" : ""}`}>{value}</div>
  </div>
);

const SummaryRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <>
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium tabular-nums">{value}</span>
  </>
);
