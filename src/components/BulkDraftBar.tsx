import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Loader2, X, Globe, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Template = { id: string; name: string };
type Mode = "draft" | "enrich" | "send";

const TONES = ["warm & concise", "punchy & direct", "consultative", "playful", "formal"];

interface Props {
  selectedIds: string[];
  onClear: () => void;
  onComplete: () => void;
}

type JobState = {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  running: boolean;
  current: string | null;
};

const initialJob: JobState = { total: 0, done: 0, failed: 0, skipped: 0, running: false, current: null };

export const BulkDraftBar = ({ selectedIds, onClear, onComplete }: Props) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("draft");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [tone, setTone] = useState("warm & concise");
  const [job, setJob] = useState<JobState>(initialJob);
  const cancelRef = useRef(false);

  useEffect(() => {
    supabase
      .from("templates")
      .select("id,name")
      .order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data as Template[]) ?? []));
  }, []);

  const runJob = async () => {
    if (selectedIds.length === 0) return;
    cancelRef.current = false;
    setJob({ ...initialJob, total: selectedIds.length, running: true });

    let done = 0;
    let failed = 0;
    let skipped = 0;

    for (const leadId of selectedIds) {
      if (cancelRef.current) break;
      setJob((j) => ({ ...j, current: leadId }));
      try {
        if (mode === "draft") {
          const { data, error } = await supabase.functions.invoke("draft-pitch", {
            body: { leadId, templateId, tone, save: true },
          });
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
          done += 1;
        } else if (mode === "enrich") {
          const { data, error } = await supabase.functions.invoke("enrich-lead", {
            body: { leadId },
          });
          if (error) throw error;
          if ((data as any)?.error) throw new Error((data as any).error);
          done += 1;
        } else if (mode === "send") {
          // Pick the most recent unsent pitch for this lead
          const { data: pitch } = await supabase
            .from("pitches")
            .select("id, sent_at")
            .eq("lead_id", leadId)
            .is("sent_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!pitch) {
            skipped += 1;
          } else {
            const { data, error } = await supabase.functions.invoke("send-pitch", {
              body: { pitchId: pitch.id },
            });
            if (error) throw error;
            if ((data as any)?.error) throw new Error((data as any).error);
            done += 1;
          }
        }
      } catch (e: any) {
        console.error(`Bulk ${mode} failed for`, leadId, e);
        failed += 1;
      }
      setJob((j) => ({ ...j, done, failed, skipped }));
    }

    setJob((j) => ({ ...j, running: false, current: null }));
    const verb = mode === "draft" ? "drafted" : mode === "enrich" ? "enriched" : "sent";
    toast({
      title: cancelRef.current ? `Bulk ${mode} canceled` : `Bulk ${mode} complete`,
      description:
        `${done} ${verb}` +
        (skipped ? `, ${skipped} skipped (no draft / no email)` : "") +
        (failed ? `, ${failed} failed` : "."),
      variant: failed > 0 ? "destructive" : "default",
    });
    onComplete();
  };

  const cancel = () => {
    cancelRef.current = true;
  };

  if (selectedIds.length === 0 && !job.running) return null;

  const pct = job.total > 0 ? Math.round(((job.done + job.failed + job.skipped) / job.total) * 100) : 0;

  const modeLabel = mode === "draft" ? "Draft" : mode === "enrich" ? "Enrich" : "Send";
  const ModeIcon = mode === "draft" ? Sparkles : mode === "enrich" ? Globe : Send;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 shadow-sm">
      <span className="text-sm font-medium">{selectedIds.length} selected</span>

      {!job.running && (
        <>
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft pitch</SelectItem>
              <SelectItem value="enrich">Enrich website</SelectItem>
              <SelectItem value="send">Send pitch</SelectItem>
            </SelectContent>
          </Select>

          {mode === "draft" && (
            <>
              <Select value={templateId ?? "none"} onValueChange={(v) => setTemplateId(v === "none" ? null : v)}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          <Button onClick={runJob} size="sm">
            <ModeIcon className="h-4 w-4" /> {modeLabel} {selectedIds.length}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-4 w-4" /> Clear
          </Button>
        </>
      )}

      {job.running && (
        <>
          <div className="flex min-w-[200px] flex-1 items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <div className="flex-1">
              <Progress value={pct} className="h-2" />
            </div>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {job.done + job.failed + job.skipped} / {job.total}
              {job.skipped > 0 && <span className="ml-1">({job.skipped} skipped)</span>}
              {job.failed > 0 && <span className="ml-1 text-destructive">({job.failed} failed)</span>}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={cancel}>
            Stop
          </Button>
        </>
      )}
    </div>
  );
};
