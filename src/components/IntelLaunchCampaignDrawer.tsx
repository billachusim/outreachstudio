import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Rocket, Sparkles, Loader2, Edit2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Proposal = {
  matchedOfferingId: string | null;
  newOffering: {
    title: string;
    tagline: string;
    problem_solved: string;
    ideal_customer: string;
    target_audience: string;
    trigger_keywords: string[];
  } | null;
  campaign: {
    name: string;
    city: string | null;
    category: string | null;
    keywords: string;
    discovery_source: "google_places" | "firecrawl";
    channel: "email" | "whatsapp";
  };
  reasoning: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  intelItemId: string | null;
  intelTitle?: string;
};

export const IntelLaunchCampaignDrawer = ({ open, onOpenChange, intelItemId, intelTitle }: Props) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [matchedTitle, setMatchedTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!open || !intelItemId) {
      setProposal(null);
      setMatchedTitle(null);
      setEditing(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke("launch-campaign-from-intel", {
        body: { intelItemId, dryRun: true },
      });
      setLoading(false);
      if (error) { toast.error(error.message); onOpenChange(false); return; }
      if ((data as any)?.error) { toast.error((data as any).error); onOpenChange(false); return; }
      const p = (data as any).proposal as Proposal;
      setProposal(p);
      if (p.matchedOfferingId) {
        const { data: off } = await supabase.from("offerings").select("title").eq("id", p.matchedOfferingId).maybeSingle();
        setMatchedTitle(off?.title ?? null);
      }
    })();
  }, [open, intelItemId, onOpenChange]);

  const launch = async () => {
    if (!intelItemId || !proposal) return;
    setLaunching(true);
    const { data, error } = await supabase.functions.invoke("launch-campaign-from-intel", {
      body: { intelItemId, dryRun: false, proposal },
    });
    setLaunching(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    toast.success("🚀 Campaign launched — discovery starting now");
    onOpenChange(false);
    navigate("/");
  };

  const updateCampaign = (patch: Partial<Proposal["campaign"]>) => {
    if (!proposal) return;
    setProposal({ ...proposal, campaign: { ...proposal.campaign, ...patch } });
  };

  const updateNewOffering = (patch: Partial<NonNullable<Proposal["newOffering"]>>) => {
    if (!proposal || !proposal.newOffering) return;
    setProposal({ ...proposal, newOffering: { ...proposal.newOffering, ...patch } });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" /> Launch campaign from intel
          </DrawerTitle>
          <DrawerDescription className="line-clamp-2">{intelTitle}</DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 overflow-y-auto space-y-4">
          {loading || !proposal ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Analyzing the story…
            </div>
          ) : (
            <>
              {/* Offering section */}
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase text-muted-foreground">Offering</Label>
                    {proposal.matchedOfferingId ? (
                      <Badge variant="outline">Matched existing</Badge>
                    ) : (
                      <Badge className="gap-1"><Sparkles className="h-3 w-3" /> New (saved as draft)</Badge>
                    )}
                  </div>
                  {proposal.matchedOfferingId ? (
                    <p className="font-medium">{matchedTitle ?? "Existing offering"}</p>
                  ) : proposal.newOffering ? (
                    editing ? (
                      <div className="space-y-2">
                        <Input value={proposal.newOffering.title} onChange={(e) => updateNewOffering({ title: e.target.value })} placeholder="Title" />
                        <Input value={proposal.newOffering.tagline} onChange={(e) => updateNewOffering({ tagline: e.target.value })} placeholder="Tagline" />
                        <Textarea rows={2} value={proposal.newOffering.ideal_customer} onChange={(e) => updateNewOffering({ ideal_customer: e.target.value })} placeholder="Ideal customer" />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-medium">{proposal.newOffering.title}</p>
                        <p className="text-sm text-muted-foreground">{proposal.newOffering.tagline}</p>
                        <p className="text-xs text-muted-foreground"><span className="font-medium">ICP:</span> {proposal.newOffering.ideal_customer}</p>
                      </div>
                    )
                  ) : null}
                </CardContent>
              </Card>

              {/* Campaign section */}
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <Label className="text-xs uppercase text-muted-foreground">Campaign</Label>
                  {editing ? (
                    <div className="grid gap-2">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input value={proposal.campaign.name} onChange={(e) => updateCampaign({ name: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">City</Label>
                          <Input value={proposal.campaign.city ?? ""} onChange={(e) => updateCampaign({ city: e.target.value || null })} />
                        </div>
                        <div>
                          <Label className="text-xs">Category</Label>
                          <Input value={proposal.campaign.category ?? ""} onChange={(e) => updateCampaign({ category: e.target.value || null })} />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Keywords</Label>
                        <Input value={proposal.campaign.keywords} onChange={(e) => updateCampaign({ keywords: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Discovery</Label>
                          <Select value={proposal.campaign.discovery_source} onValueChange={(v) => updateCampaign({ discovery_source: v as any })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="firecrawl">Firecrawl (web)</SelectItem>
                              <SelectItem value="google_places">Google Places (local)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Channel</Label>
                          <Select value={proposal.campaign.channel} onValueChange={(v) => updateCampaign({ channel: v as any })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      <p className="font-medium">{proposal.campaign.name}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {proposal.campaign.city && <Badge variant="outline">📍 {proposal.campaign.city}</Badge>}
                        {proposal.campaign.category && <Badge variant="outline">{proposal.campaign.category}</Badge>}
                        <Badge variant="outline">{proposal.campaign.discovery_source === "google_places" ? "Local biz" : "Web"}</Badge>
                        <Badge variant="outline">{proposal.campaign.channel}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground"><span className="font-medium">Keywords:</span> {proposal.campaign.keywords}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
                Target: <span className="font-medium">20 leads</span> · Daily send cap: <span className="font-medium">20</span>
              </div>

              {proposal.reasoning && !editing && (
                <p className="text-xs text-muted-foreground italic">💡 {proposal.reasoning}</p>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing((e) => !e)} className="flex-1">
                  <Edit2 className="h-4 w-4 mr-1.5" /> {editing ? "Done editing" : "Edit details"}
                </Button>
                <Button onClick={launch} disabled={launching} className="flex-1">
                  {launching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />}
                  Launch now
                </Button>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};
