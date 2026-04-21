import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Save, Loader2 } from "lucide-react";

type Offering = { id: string; title: string };
type Lead = { id: string; business_name: string; contact_email: string | null };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  intelItemId: string | null;
  intelTitle?: string;
  matchedOfferingIds?: string[];
  linkedLeadId?: string | null;
}

export const IntelPitchDrawer = ({ open, onOpenChange, intelItemId, intelTitle, matchedOfferingIds, linkedLeadId }: Props) => {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [offeringId, setOfferingId] = useState<string>("");
  const [leadId, setLeadId] = useState<string>(linkedLeadId ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(""); setBody("");
    setLeadId(linkedLeadId ?? "");
    setOfferingId(matchedOfferingIds?.[0] ?? "");
    (async () => {
      const [offRes, leadRes] = await Promise.all([
        supabase.from("offerings").select("id, title").eq("status", "active").order("title"),
        supabase.from("leads").select("id, business_name, contact_email").order("created_at", { ascending: false }).limit(50),
      ]);
      setOfferings((offRes.data as Offering[]) ?? []);
      setLeads((leadRes.data as Lead[]) ?? []);
    })();
  }, [open, linkedLeadId, matchedOfferingIds]);

  const draft = async () => {
    if (!intelItemId) return;
    setDrafting(true);
    const { data, error } = await supabase.functions.invoke("draft-pitch-from-intel", {
      body: { intelItemId, offeringId: offeringId || null, leadId: leadId || null, save: false },
    });
    setDrafting(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    setSubject((data as any).subject ?? "");
    setBody((data as any).body ?? "");
    toast.success("Pitch drafted");
  };

  const saveAsDraft = async () => {
    if (!intelItemId || !leadId || !subject.trim() || !body.trim()) {
      return toast.error("Pick a lead and draft a pitch first.");
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("draft-pitch-from-intel", {
      body: { intelItemId, offeringId: offeringId || null, leadId, save: true },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    // Override saved subject/body with what user has on screen if they edited
    if ((data as any).pitchId) {
      await supabase.from("pitches").update({ subject, body }).eq("id", (data as any).pitchId);
    }
    toast.success("Saved as draft on the lead");
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <div className="mx-auto w-full max-w-2xl overflow-y-auto px-4">
          <DrawerHeader className="px-0">
            <DrawerTitle>Draft pitch from intel</DrawerTitle>
            <DrawerDescription className="line-clamp-2">{intelTitle}</DrawerDescription>
          </DrawerHeader>

          <div className="space-y-4 pb-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Offering</Label>
                <Select value={offeringId} onValueChange={setOfferingId}>
                  <SelectTrigger><SelectValue placeholder="Pick offering" /></SelectTrigger>
                  <SelectContent>
                    {offerings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Lead (to save draft)</Label>
                <Select value={leadId} onValueChange={setLeadId}>
                  <SelectTrigger><SelectValue placeholder="Pick lead" /></SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.business_name}{l.contact_email ? ` · ${l.contact_email}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={draft} disabled={drafting} className="w-full">
              {drafting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {drafting ? "Drafting…" : subject ? "Re-draft" : "Draft with AI"}
            </Button>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Body</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Pitch body" />
            </div>
          </div>

          <DrawerFooter className="px-0">
            <Button onClick={saveAsDraft} disabled={saving || !subject || !body || !leadId}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save as draft on lead
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
