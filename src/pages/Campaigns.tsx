import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Megaphone, Rocket, Trash2, RotateCcw, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { startOutreach } from "@/lib/startOutreach";
import { useNavigate } from "react-router-dom";

type Campaign = {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  keywords: string | null;
  status: string;
  offering_id: string | null;
  discovery_source: "firecrawl" | "google_places";
  channel: "email" | "whatsapp" | "x" | "facebook" | "instagram";
  auto_send: boolean;
  auto_followup: boolean;
  email_cap: number;
  whatsapp_cap: number;
  social_cap: number;
  follow_up_days: number[];
  created_at: string;
};

type Offering = { id: string; title: string };

const Campaigns = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Campaign>>({ name: "", status: "active", discovery_source: "firecrawl", channel: "email", auto_send: false });

  useEffect(() => { document.title = "Campaigns · Outreach Studio"; }, []);

  const load = async () => {
    const [{ data: cs }, { data: os }] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("offerings").select("id,title").order("title"),
    ]);
    setCampaigns((cs as Campaign[]) ?? []);
    setOfferings((os as Offering[]) ?? []);

    // counts
    if (cs && cs.length) {
      const ids = cs.map((c) => c.id);
      const { data: leads } = await supabase
        .from("leads")
        .select("campaign_id")
        .in("campaign_id", ids);
      const map: Record<string, number> = {};
      (leads ?? []).forEach((l: { campaign_id: string | null }) => {
        if (l.campaign_id) map[l.campaign_id] = (map[l.campaign_id] ?? 0) + 1;
      });
      setCounts(map);
    }
  };

  useEffect(() => { if (user) load(); }, [user?.id]);

  const handleCreate = async () => {
    if (!user || !draft.name?.trim()) return;
    const { error } = await supabase.from("campaigns").insert({
      user_id: user.id,
      name: draft.name,
      city: draft.city ?? null,
      category: draft.category ?? null,
      keywords: draft.keywords ?? null,
      offering_id: draft.offering_id ?? null,
      discovery_source: draft.discovery_source ?? "firecrawl",
      channel: draft.channel ?? "email",
      auto_send: draft.auto_send ?? false,
      status: "active",
    } as never);
    if (error) return toast({ title: "Create failed", description: error.message, variant: "destructive" });
    setOpen(false);
    setDraft({ name: "", status: "active", discovery_source: "firecrawl", channel: "email", auto_send: false });
    load();
  };

  const updateSource = async (id: string, source: "firecrawl" | "google_places") => {
    const { error } = await supabase.from("campaigns").update({ discovery_source: source } as never).eq("id", id);
    if (error) return toast({ title: "Update failed", description: error.message, variant: "destructive" });
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, discovery_source: source } : c)));
  };

  const updateCampaign = async (id: string, patch: Partial<Campaign>) => {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from("campaigns").update(patch as never).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Group leads by who you're targeting and which offering you're pitching.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New campaign</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New campaign</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Lagos lounges Q2" />
              </div>
              <div className="space-y-1.5">
                <Label>Offering</Label>
                <Select value={draft.offering_id ?? undefined} onValueChange={(v) => setDraft({ ...draft, offering_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select offering" /></SelectTrigger>
                  <SelectContent>
                    {offerings.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Input value={draft.city ?? ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} placeholder="Lagos" />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Input value={draft.category ?? ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Lounge / supermarket / school" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Keywords</Label>
                <Input value={draft.keywords ?? ""} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} placeholder="rooftop, premium, family-owned" />
              </div>
              <div className="space-y-1.5">
                <Label>Outreach channel</Label>
                <Select
                  value={draft.channel ?? "email"}
                  onValueChange={(v: Campaign["channel"]) => setDraft({ ...draft, channel: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="x">X (Twitter)</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Connect the channel in Channels first. Auto-mode sends drafts automatically through the engine.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Lead discovery source</Label>
                <Select
                  value={draft.discovery_source ?? "firecrawl"}
                  onValueChange={(v: "firecrawl" | "google_places") => setDraft({ ...draft, discovery_source: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="firecrawl">Firecrawl (web search)</SelectItem>
                    <SelectItem value="google_places">Google Places (local businesses)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Google Places is best for restaurants, gyms, salons. Firecrawl works for any web-discoverable business.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Megaphone className="h-8 w-8" />
            <p>No campaigns yet. Create one to start collecting leads.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const offering = offerings.find((o) => o.id === c.offering_id);
            return (
              <Card key={c.id} className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/leads?campaign=${c.id}`}>
                      <CardTitle className="text-lg hover:underline">{c.name}</CardTitle>
                    </Link>
                    <Badge variant="secondary">{counts[c.id] ?? 0} leads</Badge>
                  </div>
                  {offering && <p className="text-sm text-muted-foreground">Pitching: {offering.title}</p>}
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  {c.city && <p>📍 {c.city}</p>}
                  {c.category && <p>🏷️ {c.category}</p>}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Discovery source</Label>
                    <Select
                      value={c.discovery_source ?? "firecrawl"}
                      onValueChange={(v: "firecrawl" | "google_places") => updateSource(c.id, v)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="firecrawl">Firecrawl</SelectItem>
                        <SelectItem value="google_places">Google Places</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase">Email/day</Label>
                      <Input
                        type="number" min={0} max={500}
                        className="h-8 text-xs"
                        value={c.email_cap ?? 50}
                        onChange={(e) => updateCampaign(c.id, { email_cap: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase">WApp/day</Label>
                      <Input
                        type="number" min={0} max={500}
                        className="h-8 text-xs"
                        value={c.whatsapp_cap ?? 50}
                        onChange={(e) => updateCampaign(c.id, { whatsapp_cap: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase">Social/day</Label>
                      <Input
                        type="number" min={0} max={500}
                        className="h-8 text-xs"
                        value={c.social_cap ?? 10}
                        onChange={(e) => updateCampaign(c.id, { social_cap: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase">Follow-up days</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="3, 7, 14"
                      value={(c.follow_up_days ?? [3, 7, 14]).join(", ")}
                      onChange={(e) => {
                        const days = e.target.value
                          .split(",")
                          .map((s) => parseInt(s.trim(), 10))
                          .filter((n) => Number.isFinite(n) && n > 0);
                        updateCampaign(c.id, { follow_up_days: days });
                      }}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={c.auto_followup ?? true}
                      onChange={(e) => updateCampaign(c.id, { auto_followup: e.target.checked })}
                      className="h-3.5 w-3.5"
                    />
                    Auto follow-up sequences
                  </label>
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!user) return;
                      try {
                        await startOutreach({ userId: user.id, campaignId: c.id });
                        toast({ title: "Outreach started", description: "Engine is running. Watch Studio for progress." });
                        navigate("/");
                      } catch (e: any) {
                        toast({ title: "Could not start", description: e?.message, variant: "destructive" });
                      }
                    }}
                  >
                    <Rocket className="h-3.5 w-3.5" /> Start Outreach
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Campaigns;
