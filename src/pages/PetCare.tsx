import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ExternalLink, RefreshCw, Play, Pause, Mail, PawPrint, Search, Ban, Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Stage = "none" | "contacted" | "replied" | "interested" | "trial" | "active" | "not_interested";

const STAGES: Array<{ value: Stage; label: string }> = [
  { value: "none", label: "Not contacted" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "interested", label: "Interested" },
  { value: "trial", label: "Trial started" },
  { value: "active", label: "Active partner" },
  { value: "not_interested", label: "Not interested" },
];

const stageLabel = (s: string) => STAGES.find((x) => x.value === s)?.label ?? s;

type Lead = {
  id: string;
  business_name: string;
  website: string | null;
  contact_email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  services: string | null;
  relevance_reason: string | null;
  source_url: string | null;
  score: number;
  status: string;
  partner_stage: string;
  opted_out: boolean;
  notes: string | null;
  created_at: string;
  last_activity_at: string | null;
};

type Pitch = { id: string; lead_id: string; subject: string | null; body: string | null; sent_at: string | null };

export default function PetCare() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<{ id: string; name: string; status: string } | null>(null);
  const [runState, setRunState] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [filter, setFilter] = useState<"all" | "emailed" | "waiting" | "partners">("all");
  const [preview, setPreview] = useState<{ lead: Lead; pitch: Pitch | null } | null>(null);

  const load = useCallback(async () => {
    const { data: camp } = await supabase
      .from("campaigns")
      .select("id, name, status")
      .eq("mode", "partner_acquisition")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setCampaign(camp ?? null);

    if (camp) {
      const { data: run } = await supabase
        .from("campaign_runs")
        .select("state")
        .eq("campaign_id", camp.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setRunState(run?.state ?? null);

      const { data: ls } = await supabase
        .from("leads")
        .select("id, business_name, website, contact_email, phone, city, state, services, relevance_reason, source_url, score, status, partner_stage, opted_out, notes, created_at, last_activity_at")
        .eq("campaign_id", camp.id)
        .order("score", { ascending: false });
      const list = (ls ?? []) as Lead[];
      setLeads(list);

      if (list.length) {
        const { data: ps } = await supabase
          .from("pitches")
          .select("id, lead_id, subject, body, sent_at")
          .in("lead_id", list.slice(0, 500).map((l) => l.id));
        setPitches((ps ?? []) as Pitch[]);
      } else {
        setPitches([]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sentLeadIds = new Set(pitches.filter((p) => p.sent_at).map((p) => p.lead_id));
  const contacted = leads.filter((l) => sentLeadIds.has(l.id));
  const qualified = leads.filter((l) => l.contact_email && !l.opted_out);
  const replied = leads.filter((l) => ["replied", "interested", "trial", "active"].includes(l.partner_stage) || l.status === "replied");
  const interested = leads.filter((l) => ["interested", "trial", "active"].includes(l.partner_stage));
  const trials = leads.filter((l) => ["trial", "active"].includes(l.partner_stage));
  const partners = leads.filter((l) => l.partner_stage === "active");

  const shown = leads.filter((l) => {
    if (filter === "emailed") return sentLeadIds.has(l.id);
    if (filter === "waiting") return !sentLeadIds.has(l.id);
    if (filter === "partners") return ["interested", "trial", "active"].includes(l.partner_stage);
    return true;
  });

  const runFn = async (fn: string, body: Record<string, unknown>, label: string) => {
    setBusy(fn);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      const inserted = (data as { inserted?: number })?.inserted;
      toast.success(inserted !== undefined ? `${label}: ${inserted} added` : label);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const toggleCampaign = async () => {
    if (!campaign) return;
    const next = campaign.status === "active" ? "paused" : "active";
    setBusy("toggle");
    const { error } = await supabase.from("campaigns").update({ status: next }).eq("id", campaign.id);
    if (error) toast.error(error.message);
    else {
      if (next === "active") {
        await supabase.from("campaign_runs").insert({
          campaign_id: campaign.id,
          user_id: (await supabase.auth.getUser()).data.user!.id,
          state: "queued",
          daily_send_cap: 20,
          target_lead_count: 30,
        });
      }
      toast.success(next === "active" ? "Campaign resumed" : "Campaign paused");
      await load();
    }
    setBusy(null);
  };

  const setStage = async (lead: Lead, stage: Stage) => {
    const patch = {
      partner_stage: stage,
      partner_stage_at: new Date().toISOString(),
      ...(stage === "not_interested" ? { opted_out: true } : {}),
    };
    const { error } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (error) return toast.error(error.message);
    toast.success(`${lead.business_name} → ${stageLabel(stage)}`);
    void load();
  };

  const stopContacting = async (lead: Lead) => {
    const { error } = await supabase.from("leads").update({ opted_out: true }).eq("id", lead.id);
    if (error) return toast.error(error.message);
    await supabase.from("pitch_sequences").update({ status: "cancelled", reason: "opted out" })
      .eq("lead_id", lead.id).eq("status", "scheduled");
    toast.success(`No more emails to ${lead.business_name}`);
    void load();
  };

  if (loading) {
    return (
      <div className="p-4 space-y-4 md:p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No Pet Care Card campaign found yet.
        </CardContent></Card>
      </div>
    );
  }

  const isActive = campaign.status === "active";

  return (
    <div className="p-4 space-y-5 md:p-6 max-w-5xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <PawPrint className="h-6 w-6 text-primary" /> Pet Care Card partners
        </h1>
        <p className="text-sm text-muted-foreground">
          Finding U.S. pet-sitting businesses and inviting them to test Pet Care Card with their clients.
        </p>
      </header>

      {/* Headline metric */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Active pet-sitting partners</p>
              <p className="text-4xl font-bold tabular-nums">{partners.length}</p>
            </div>
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? (runState ? `Running · ${runState}` : "Running") : "Paused"}
            </Badge>
          </div>
          <Progress value={Math.min(100, (partners.length / 5) * 100)} />
          <p className="text-xs text-muted-foreground">
            First milestone: 5 partners. The campaign keeps running until you pause it.
          </p>
        </CardContent>
      </Card>

      {/* Funnel */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Discovered", leads.length],
          ["Qualified", qualified.length],
          ["Emailed", contacted.length],
          ["Replied", replied.length],
          ["Interested", interested.length],
          ["Trials", trials.length],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardContent className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={toggleCampaign} disabled={busy === "toggle"} variant={isActive ? "outline" : "default"}>
          {isActive ? <><Pause className="h-4 w-4 mr-2" /> Pause campaign</> : <><Play className="h-4 w-4 mr-2" /> Resume campaign</>}
        </Button>
        <Button variant="secondary" disabled={busy !== null}
          onClick={() => runFn("discover-pet-sitters", { campaignId: campaign.id, cityCount: 3, perCity: 6 }, "Searched for pet sitters")}>
          <Search className={`h-4 w-4 mr-2 ${busy === "discover-pet-sitters" ? "animate-spin" : ""}`} /> Find more businesses
        </Button>
        <Button variant="secondary" disabled={busy !== null}
          onClick={() => runFn("campaign-tick", { campaignId: campaign.id }, "Advanced the campaign")}>
          <Sparkles className="h-4 w-4 mr-2" /> Run next step
        </Button>
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {([["all", "All"], ["emailed", "Emailed"], ["waiting", "Not emailed"], ["partners", "Warm"]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
            {label}
          </Button>
        ))}
      </div>

      {/* Leads */}
      <div className="space-y-3">
        {shown.length === 0 && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">
            No businesses here yet. Tap “Find more businesses” to search.
          </CardContent></Card>
        )}
        {shown.map((lead) => {
          const pitch = pitches.find((p) => p.lead_id === lead.id) ?? null;
          const sent = pitch?.sent_at ?? null;
          return (
            <Card key={lead.id} className={lead.opted_out ? "opacity-60" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base leading-tight truncate">{lead.business_name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[lead.city, lead.state].filter(Boolean).join(", ") || "United States"}
                      {lead.services ? ` · ${lead.services}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 tabular-nums">{lead.score}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {lead.relevance_reason && (
                  <p className="text-xs text-muted-foreground line-clamp-3">{lead.relevance_reason}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  {lead.contact_email
                    ? <Badge variant="secondary" className="font-normal">{lead.contact_email}</Badge>
                    : <Badge variant="outline" className="font-normal">No public email</Badge>}
                  {lead.phone && <Badge variant="outline" className="font-normal">{lead.phone}</Badge>}
                  {sent && <Badge className="font-normal">Emailed {formatDistanceToNow(new Date(sent), { addSuffix: true })}</Badge>}
                  {lead.opted_out && <Badge variant="destructive" className="font-normal">Do not contact</Badge>}
                  <Badge variant="outline" className="font-normal">{stageLabel(lead.partner_stage)}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {lead.website && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={lead.website} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> Site
                      </a>
                    </Button>
                  )}
                  {pitch && (
                    <Button size="sm" variant="outline" onClick={() => setPreview({ lead, pitch })}>
                      <Mail className="h-3.5 w-3.5 mr-1" /> View email
                    </Button>
                  )}
                  <Select value={lead.partner_stage} onValueChange={(v) => void setStage(lead, v as Stage)}>
                    <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGES.map((s) => <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {!lead.opted_out && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void stopContacting(lead)}>
                      <Ban className="h-3.5 w-3.5 mr-1" /> Stop emails
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{preview?.pitch?.subject ?? "Email"}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            To {preview?.lead.contact_email} · {preview?.pitch?.sent_at
              ? `sent ${formatDistanceToNow(new Date(preview.pitch.sent_at), { addSuffix: true })}`
              : "not sent yet"}
          </p>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed max-h-[55vh] overflow-y-auto">
            {preview?.pitch?.body}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
