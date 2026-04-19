import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PitchDrawer } from "@/components/PitchDrawer";

type LeadStatus = "new" | "enriched" | "drafted" | "sent" | "opened" | "replied" | "won" | "lost";
type Lead = {
  id: string;
  business_name: string;
  website: string | null;
  phone: string | null;
  contact_email: string | null;
  contact_name: string | null;
  address: string | null;
  status: LeadStatus;
  notes: string | null;
  campaign_id: string | null;
};

type Campaign = { id: string; name: string };

const STATUSES: LeadStatus[] = ["new", "enriched", "drafted", "sent", "opened", "replied", "won", "lost"];

const statusVariant: Record<LeadStatus, string> = {
  new: "bg-muted text-muted-foreground",
  enriched: "bg-accent text-accent-foreground",
  drafted: "bg-accent text-accent-foreground",
  sent: "bg-primary/10 text-primary",
  opened: "bg-primary/15 text-primary",
  replied: "bg-warning/15 text-warning",
  won: "bg-success/15 text-success",
  lost: "bg-destructive/10 text-destructive",
};

const Leads = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const campaignFilter = params.get("campaign");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Lead>>({ business_name: "", status: "new" });
  const [pitchLead, setPitchLead] = useState<Lead | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);

  useEffect(() => { document.title = "Leads · Outreach Studio"; }, []);

  const load = async () => {
    const [{ data: cs }, leadsRes] = await Promise.all([
      supabase.from("campaigns").select("id,name").order("name"),
      campaignFilter
        ? supabase.from("leads").select("*").eq("campaign_id", campaignFilter).order("created_at", { ascending: false })
        : supabase.from("leads").select("*").order("created_at", { ascending: false }),
    ]);
    setCampaigns((cs as Campaign[]) ?? []);
    setLeads((leadsRes.data as Lead[]) ?? []);
  };

  useEffect(() => { if (user) load(); }, [user?.id, campaignFilter]);

  const handleCreate = async () => {
    if (!user || !draft.business_name?.trim()) return;
    const { error } = await supabase.from("leads").insert({
      user_id: user.id,
      business_name: draft.business_name,
      website: draft.website ?? null,
      phone: draft.phone ?? null,
      contact_email: draft.contact_email ?? null,
      contact_name: draft.contact_name ?? null,
      address: draft.address ?? null,
      notes: draft.notes ?? null,
      status: (draft.status ?? "new") as LeadStatus,
      campaign_id: draft.campaign_id ?? campaignFilter ?? null,
    } as never);
    if (error) return toast({ title: "Create failed", description: error.message, variant: "destructive" });
    setOpen(false);
    setDraft({ business_name: "", status: "new" });
    load();
  };

  const updateStatus = async (id: string, status: LeadStatus) => {
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) return toast({ title: "Update failed", description: error.message, variant: "destructive" });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    const { error } = await supabase.from("leads").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    load();
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">Manage prospects and move them through the pipeline.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={campaignFilter ?? "all"}
            onValueChange={(v) => {
              if (v === "all") setParams({});
              else setParams({ campaign: v });
            }}
          >
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Add lead</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add lead</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="space-y-1.5">
                  <Label>Business name</Label>
                  <Input value={draft.business_name ?? ""} onChange={(e) => setDraft({ ...draft, business_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Campaign</Label>
                  <Select
                    value={draft.campaign_id ?? campaignFilter ?? undefined}
                    onValueChange={(v) => setDraft({ ...draft, campaign_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Website</Label>
                    <Input value={draft.website ?? ""} onChange={(e) => setDraft({ ...draft, website: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact name</Label>
                    <Input value={draft.contact_name ?? ""} onChange={(e) => setDraft({ ...draft, contact_name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact email</Label>
                    <Input type="email" value={draft.contact_email ?? ""} onChange={(e) => setDraft({ ...draft, contact_email: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Input value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea rows={3} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Add lead</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {leads.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            No leads yet. Add one manually — auto-discovery comes in the next phase.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.business_name}</div>
                    {l.address && <div className="text-xs text-muted-foreground">{l.address}</div>}
                  </TableCell>
                  <TableCell>
                    {l.contact_name && <div className="text-sm">{l.contact_name}</div>}
                    {l.contact_email && <div className="text-xs text-muted-foreground">{l.contact_email}</div>}
                    {l.phone && <div className="text-xs text-muted-foreground">{l.phone}</div>}
                  </TableCell>
                  <TableCell>
                    {l.website && (
                      <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                        {l.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select value={l.status} onValueChange={(v) => updateStatus(l.id, v as LeadStatus)}>
                      <SelectTrigger className="h-8 w-[130px] border-0 bg-transparent p-0">
                        <Badge className={statusVariant[l.status] + " capitalize"}>{l.status}</Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Draft pitch"
                        onClick={() => { setPitchLead(l); setPitchOpen(true); }}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(l.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <PitchDrawer
        lead={pitchLead}
        open={pitchOpen}
        onOpenChange={setPitchOpen}
        onSaved={load}
      />
    </div>
  );
};

export default Leads;
