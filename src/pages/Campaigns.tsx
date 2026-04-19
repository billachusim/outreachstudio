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
import { Plus, Megaphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Campaign = {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  keywords: string | null;
  status: string;
  offering_id: string | null;
  created_at: string;
};

type Offering = { id: string; title: string };

const Campaigns = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Campaign>>({ name: "", status: "active" });

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
      status: "active",
    } as never);
    if (error) return toast({ title: "Create failed", description: error.message, variant: "destructive" });
    setOpen(false);
    setDraft({ name: "", status: "active" });
    load();
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Group leads by who you're targeting and which offering you're pitching.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New campaign</Button>
          </DialogTrigger>
          <DialogContent>
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const offering = offerings.find((o) => o.id === c.offering_id);
            return (
              <Link key={c.id} to={`/leads?campaign=${c.id}`}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">{c.name}</CardTitle>
                      <Badge variant="secondary">{counts[c.id] ?? 0} leads</Badge>
                    </div>
                    {offering && <p className="text-sm text-muted-foreground">Pitching: {offering.title}</p>}
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    {c.city && <p>📍 {c.city}</p>}
                    {c.category && <p>🏷️ {c.category}</p>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Campaigns;
