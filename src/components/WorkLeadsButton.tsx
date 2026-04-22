import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Sparkles, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { LeadDetail } from "@/components/LeadDetailDrawer";

const BATCH_OPTIONS = [25, 50, 100, 200, 500];
const DEAD_STATUSES = new Set(["won", "lost"]);

export function needsEnrichment(l: LeadDetail): boolean {
  if (!l.website) return false;
  if (DEAD_STATUSES.has(l.status as string)) return false;
  return !l.last_enriched_at || !l.contact_email;
}

interface Props {
  leads: LeadDetail[];
  selectedIds: string[];
  onComplete: () => void;
}

interface Stats {
  done: number;
  total: number;
  enriched: number;
  skipped: number;
  failed: number;
}

export const WorkLeadsButton = ({ leads, selectedIds, onComplete }: Props) => {
  const { toast } = useToast();
  const [batchSize, setBatchSize] = useState<number>(50);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const candidates = useMemo(() => {
    if (selectedIds.length > 0) {
      const set = new Set(selectedIds);
      return leads.filter((l) => set.has(l.id) && needsEnrichment(l));
    }
    return leads.filter(needsEnrichment);
  }, [leads, selectedIds]);

  const counterText = selectedIds.length > 0
    ? `Selected & enrichable: ${candidates.length}`
    : `Need enrichment in view: ${candidates.length}`;

  const start = async () => {
    if (running) return;
    const batch = candidates.slice(0, batchSize);
    if (batch.length === 0) return;
    setOpen(false);
    setStopRequested(false);
    setRunning(true);
    const s: Stats = { done: 0, total: batch.length, enriched: 0, skipped: 0, failed: 0 };
    setStats({ ...s });

    const concurrency = batch.length >= 100 ? 2 : 1;
    let cursor = 0;

    const processOne = async (lead: LeadDetail) => {
      if (stopRequested) return;
      if (!lead.website) {
        s.skipped += 1;
      } else {
        try {
          const { data, error } = await supabase.functions.invoke("enrich-lead", {
            body: { leadId: lead.id },
          });
          if (error || (data as any)?.error) {
            s.failed += 1;
          } else {
            s.enriched += 1;
          }
        } catch {
          s.failed += 1;
        }
      }
      s.done += 1;
      setStats({ ...s });
    };

    const worker = async () => {
      while (!stopRequested) {
        const idx = cursor++;
        if (idx >= batch.length) return;
        await processOne(batch[idx]);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    setRunning(false);
    toast({
      title: stopRequested ? "Stopped" : "Work leads complete",
      description: `Enriched ${s.enriched} · ${s.skipped} skipped · ${s.failed} failed`,
    });
    onComplete();
    setTimeout(() => setStats(null), 6000);
  };

  const stop = () => setStopRequested(true);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={running}>
            <Sparkles className="h-4 w-4" />
            {running ? "Working…" : "Work leads"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">Bulk enrich</h4>
            <p className="text-xs text-muted-foreground">
              Enriches leads with Firecrawl: contacts, socials, summary.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Batch size</Label>
            <Select value={String(batchSize)} onValueChange={(v) => setBatchSize(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BATCH_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-xs">
            <div>{counterText}</div>
            <div className="text-muted-foreground">
              Will work: {Math.min(candidates.length, batchSize)}
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={start}
            disabled={candidates.length === 0 || running}
          >
            <Sparkles className="h-4 w-4" /> Start
          </Button>
        </PopoverContent>
      </Popover>

      {stats && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[480px] sm:-translate-x-1/2 sm:rounded-lg sm:border">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">
              {running ? "Enriching leads…" : "Enrichment complete"}
            </span>
            <span className="text-xs text-muted-foreground">
              {stats.done} / {stats.total}
            </span>
          </div>
          <Progress value={(stats.done / Math.max(stats.total, 1)) * 100} className="h-2" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>✓ {stats.enriched} enriched</span>
            <span>⊘ {stats.skipped} skipped</span>
            <span>✗ {stats.failed} failed</span>
            <div className="ml-auto">
              {running ? (
                <Button size="sm" variant="ghost" onClick={stop} className="h-7">
                  <X className="h-3 w-3" /> Stop
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setStats(null)} className="h-7">
                  <X className="h-3 w-3" /> Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
