import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Mail,
  Phone,
  Globe,
  MapPin,
  Linkedin,
  Instagram,
  Facebook,
  Twitter,
  Sparkles,
  MessageCircle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type LeadDetail = {
  id: string;
  business_name: string;
  website: string | null;
  phone: string | null;
  contact_email: string | null;
  contact_name: string | null;
  address: string | null;
  status: string;
  notes: string | null;
  campaign_id: string | null;
  score: number | null;
  enrichment_summary: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  last_enriched_at: string | null;
};

type Pitch = { id: string; subject: string | null; sent_at: string | null; created_at: string };

interface Props {
  lead: LeadDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftPitch: (lead: LeadDetail) => void;
  onWhatsApp: (lead: LeadDetail) => void;
  onChanged?: () => void;
}

export const LeadDetailDrawer = ({ lead, open, onOpenChange, onDraftPitch, onWhatsApp, onChanged }: Props) => {
  const { toast } = useToast();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    (async () => {
      const { data } = await supabase
        .from("pitches")
        .select("id, subject, sent_at, created_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false });
      setPitches((data as Pitch[]) ?? []);
    })();
  }, [open, lead?.id]);

  if (!lead) return null;

  const score = lead.score ?? 0;
  const scoreColor =
    score >= 70 ? "text-success border-success/40 bg-success/10" :
    score >= 40 ? "text-primary border-primary/40 bg-primary/10" :
    "text-muted-foreground border-border bg-muted";

  // Score breakdown approximation (matches compute_lead_score)
  const breakdown: Array<{ label: string; pts: number; got: boolean }> = [
    { label: "Email", pts: 25, got: !!lead.contact_email },
    { label: "Phone", pts: 15, got: !!lead.phone },
    { label: "Website", pts: 10, got: !!lead.website },
    { label: "Contact name", pts: 10, got: !!lead.contact_name },
    { label: "Notes", pts: 10, got: !!(lead.notes && lead.notes.length > 100) },
    { label: "Summary", pts: 10, got: !!(lead.enrichment_summary && lead.enrichment_summary.length > 200) },
    {
      label: "Socials",
      pts: 15,
      got: !!(lead.linkedin_url || lead.instagram_url || lead.facebook_url || lead.x_url),
    },
  ];

  const handleEnrich = async () => {
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-lead", { body: { leadId: lead.id } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Enriched", description: (data as any).email ? `Found ${(data as any).email}` : "Profile updated." });
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Enrich failed", description: e?.message ?? "", variant: "destructive" });
    } finally {
      setEnriching(false);
    }
  };

  const socials = [
    { url: lead.linkedin_url, Icon: Linkedin, label: "LinkedIn" },
    { url: lead.instagram_url, Icon: Instagram, label: "Instagram" },
    { url: lead.facebook_url, Icon: Facebook, label: "Facebook" },
    { url: lead.x_url, Icon: Twitter, label: "X" },
  ].filter((s) => !!s.url);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-start justify-between gap-3 pr-6">
            <span className="leading-tight">{lead.business_name}</span>
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-lg font-semibold ${scoreColor}`}>
              {score}
            </div>
          </SheetTitle>
          <SheetDescription className="capitalize">{lead.status}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Sticky action bar */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onDraftPitch(lead)}>
              <Sparkles className="h-4 w-4" /> Draft pitch
            </Button>
            {lead.phone && (
              <Button size="sm" variant="outline" onClick={() => onWhatsApp(lead)}>
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
            )}
            {lead.website && (
              <Button size="sm" variant="outline" onClick={handleEnrich} disabled={enriching}>
                {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                {lead.last_enriched_at ? "Re-enrich" : "Enrich"}
              </Button>
            )}
          </div>

          <Separator />

          {/* Contact block */}
          <div className="space-y-2 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</h3>
            {lead.contact_name && <div className="font-medium">{lead.contact_name}</div>}
            {lead.contact_email ? (
              <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /><a href={`mailto:${lead.contact_email}`} className="text-primary hover:underline">{lead.contact_email}</a></div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />No email yet</div>
            )}
            {lead.phone && (
              <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><a href={`tel:${lead.phone}`} className="text-primary hover:underline">{lead.phone}</a></div>
            )}
            {lead.website && (
              <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /><a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">{lead.website.replace(/^https?:\/\//, "")}</a></div>
            )}
            {lead.address && (
              <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="h-4 w-4 mt-0.5 shrink-0" /><span>{lead.address}</span></div>
            )}
          </div>

          {socials.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Socials</h3>
                <div className="flex flex-wrap gap-2">
                  {socials.map(({ url, Icon, label }) => (
                    <a key={label} href={url!} target="_blank" rel="noreferrer">
                      <Badge variant="outline" className="gap-1.5 hover:bg-accent"><Icon className="h-3 w-3" />{label}</Badge>
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}

          {lead.enrichment_summary && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</h3>
                <p className="text-sm leading-relaxed text-foreground/80">{lead.enrichment_summary}</p>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Score breakdown</h3>
            <div className="space-y-1">
              {breakdown.map((b) => (
                <div key={b.label} className="flex items-center justify-between text-xs">
                  <span className={b.got ? "text-foreground" : "text-muted-foreground"}>{b.label}</span>
                  <span className={b.got ? "text-success" : "text-muted-foreground"}>{b.got ? `+${b.pts}` : `0 / ${b.pts}`}</span>
                </div>
              ))}
            </div>
          </div>

          {pitches.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pitch history ({pitches.length})</h3>
                <div className="space-y-1.5">
                  {pitches.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2.5 py-1.5 text-xs">
                      <span className="truncate">{p.subject || "(no subject)"}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {p.sent_at ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" />sent</span> : "draft"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
