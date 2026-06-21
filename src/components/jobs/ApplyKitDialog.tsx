import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Copy, ExternalLink, Wand2, AlertCircle, Plus, Mail, Check, X } from "lucide-react";
import { toast } from "sonner";

const JOB_PROFILE_SLUG = "job-application-profile";
const JOB_PROFILE_TITLE = "Job application profile";


export type ApplicationKit = {
  apply_method?: "form" | "email" | "external_ats";
  summary?: string;
  detected_questions?: Array<{
    label: string; value: string;
    source?: "profile" | "cv" | "generated" | "missing";
    needs_user?: boolean; hint?: string;
  }>;
  attachments_needed?: string[];
  cover_letter?: string;
  missing_info?: Array<{ field: string; why?: string; profile_question?: string }>;
  notes?: string;
  apply_url?: string;
  apply_email?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: { id: string; title: string; company: string | null; location: string | null; source: string | null } | null;
  kit: ApplicationKit | null;
};

export const ApplyKitDialog = ({ open, onOpenChange, job, kit }: Props) => {
  const { user } = useAuth();
  const [savingField, setSavingField] = useState<string | null>(null);
  const [openInput, setOpenInput] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [savedFields, setSavedFields] = useState<Set<string>>(new Set());

  const copy = async (txt: string, label: string) => {
    try { await navigator.clipboard.writeText(txt); toast.success(`${label} copied`); }
    catch { toast.error("Copy failed"); }
  };

  const copyAll = () => {
    if (!kit?.detected_questions) return;
    const blob = kit.detected_questions
      .map((q) => `${q.label}:\n${q.value || "(missing — fill manually)"}`)
      .join("\n\n");
    copy(blob, "All answers");
  };

  const addToProfile = async (item: { field: string; why?: string; profile_question?: string }) => {
    if (!user) return;
    setSavingField(item.field);
    try {
      const { data: existing } = await supabase.from("agent_memories")
        .select("id, content")
        .eq("user_id", user.id)
        .eq("slug", JOB_PROFILE_SLUG)
        .maybeSingle();

      const heading = `## ${item.field}`;
      // Dedupe: skip if same field already recorded
      if (existing?.content?.includes(heading)) {
        toast.info(`"${item.field}" is already in your job profile`, {
          action: { label: "Open Memory", onClick: () => window.location.assign("/memory") },
        });
        return;
      }

      const block = [
        heading,
        item.profile_question ? `_Question:_ ${item.profile_question}` : "",
        item.why ? `_Why we need it:_ ${item.why}` : "",
        `**Answer:** _(TODO — fill in)_`,
      ].filter(Boolean).join("\n");

      if (existing) {
        await supabase.from("agent_memories")
          .update({ content: `${existing.content ?? ""}\n\n${block}` })
          .eq("id", existing.id);
      } else {
        await supabase.from("agent_memories").insert({
          user_id: user.id,
          slug: JOB_PROFILE_SLUG,
          title: JOB_PROFILE_TITLE,
          kind: "portfolio",
          content:
`# Job application profile

Fields the Apply Assistant has needed across job applications.
Fill in the answers under each heading — once answered, the assistant will reuse them automatically.

${block}`,
        });
      }
      toast.success(`Added "${item.field}" to job profile`, {
        description: "Open Memory → Job application profile to fill in the answer.",
        action: { label: "Open Memory", onClick: () => window.location.assign("/memory") },
      });
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally { setSavingField(null); }
  };

  if (!kit) return null;

  const methodBadge = kit.apply_method === "email" ? "Email apply"
    : kit.apply_method === "external_ats" ? "External ATS (manual)"
    : "Form apply";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <Wand2 className="h-4 w-4" /> Application Kit — {job?.title}
          </DialogTitle>
          <DialogDescription className="truncate">
            {[job?.company, job?.location, job?.source].filter(Boolean).join(" · ")}
          </DialogDescription>
          <div className="pt-1">
            <Badge variant="outline" className="text-[10px]">{methodBadge}</Badge>
          </div>
        </DialogHeader>


        {kit.summary && <p className="text-sm text-muted-foreground">{kit.summary}</p>}

        {kit.notes && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="mr-1 inline h-3.5 w-3.5" /> {kit.notes}
          </div>
        )}

        {/* Missing info / profile gaps */}
        {kit.missing_info && kit.missing_info.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Missing from your profile</h3>
              <Link to="/memory" className="text-[11px] text-muted-foreground underline hover:text-foreground">
                View in Memory →
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved to a dedicated <span className="font-mono">job-application-profile</span> memory.
              Fill in the answers there once and the assistant reuses them on future applications.
            </p>

            <div className="divide-y rounded-md border bg-muted/20">
              {kit.missing_info.map((m, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.field}</div>
                    {m.why && <div className="text-xs text-muted-foreground">{m.why}</div>}
                    {m.profile_question && <div className="mt-1 text-xs italic text-muted-foreground">"{m.profile_question}"</div>}
                  </div>
                  <Button size="sm" variant="outline" className="h-7" disabled={savingField === m.field}
                          onClick={() => addToProfile(m)}>
                    <Plus className="h-3.5 w-3.5" /> Add to profile
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Detected questions */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Form answers ({kit.detected_questions?.length ?? 0})</h3>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={copyAll}>
              <Copy className="h-3 w-3" /> Copy all
            </Button>
          </div>
          <div className="space-y-2">
            {(kit.detected_questions ?? []).map((q, i) => {
              const empty = !q.value || q.needs_user || q.source === "missing";
              return (
                <div key={i} className={`rounded-md border p-2.5 ${empty ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{q.label}</div>
                      {q.source && (
                        <Badge variant="outline" className="mt-0.5 text-[9px]">{q.source}</Badge>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 text-[11px]"
                            onClick={() => copy(q.value || "", q.label)} disabled={!q.value}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                  </div>
                  {q.value ? (
                    <Textarea value={q.value} readOnly rows={q.value.length > 120 ? 4 : 1}
                              className="mt-1.5 font-mono text-xs" />
                  ) : (
                    <div className="mt-1 text-xs text-amber-900 dark:text-amber-200">
                      {q.hint || "Fill manually — info not in your profile yet."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Cover letter */}
        {kit.cover_letter && (
          <section className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Cover letter</h3>
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => copy(kit.cover_letter!, "Cover letter")}>
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            <Textarea value={kit.cover_letter} readOnly rows={8} className="font-mono text-xs" />
          </section>
        )}

        {/* Attachments reminder */}
        {kit.attachments_needed && kit.attachments_needed.length > 0 && (
          <section className="rounded-md border bg-muted/30 p-2 text-xs">
            <div className="mb-1 font-medium">Attachments needed</div>
            <ul className="list-disc pl-4 text-muted-foreground">
              {kit.attachments_needed.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </section>
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {kit.apply_email && (
            <Button variant="outline" asChild>
              <a href={`mailto:${kit.apply_email}`}><Mail className="h-3.5 w-3.5" /> Email</a>
            </Button>
          )}
          {kit.apply_url && (
            <Button asChild>
              <a href={kit.apply_url} target="_blank" rel="noreferrer">
                Open application <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
