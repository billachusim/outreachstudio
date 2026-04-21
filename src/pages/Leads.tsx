import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Sparkles, MessageCircle, LayoutGrid, List, Search, Mail, Phone, Globe, Upload, Inbox, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PitchDrawer } from "@/components/PitchDrawer";
import { BulkDraftBar } from "@/components/BulkDraftBar";
import { LeadDetailDrawer, type LeadDetail } from "@/components/LeadDetailDrawer";
import { LeadCard } from "@/components/LeadCard";
import { ImportLeadsDialog } from "@/components/ImportLeadsDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const RAW_VALUE = "__raw__";
const NO_CAMPAIGN = "__none__";

type LeadStatus = "new" | "enriched" | "drafted" | "sent" | "opened" | "replied" | "won" | "lost";
const STATUSES: LeadStatus[] = ["new", "enriched", "drafted", "sent", "opened", "replied", "won", "lost"];

type Campaign = { id: string; name: string };

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

type TabKey = "all" | "raw" | "hot" | "ready" | "needs" | "replied" | "won";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "raw", label: "📥 Raw" },
  { key: "hot", label: "🔥 Hot" },
  { key: "ready", label: "✉ Ready" },
  { key: "needs", label: "⏳ Needs enrichment" },
  { key: "replied", label: "💬 Replied" },
  { key: "won", label: "🏆 Won" },
];

const Leads = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const campaignFilter = params.get("campaign");

  const [leads, setLeads] = useState<LeadDetail[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [region, setRegion] = useState("Nigeria");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<LeadDetail>>({ business_name: "", status: "new", campaign_id: null });
  const [pitchLead, setPitchLead] = useState<LeadDetail | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<LeadDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState<string>("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [view, setView] = useState<"table" | "cards">(() => {
    if (typeof window === "undefined") return "table";
    return (localStorage.getItem("leads:view") as any) || (window.innerWidth < 640 ? "cards" : "table");
  });
  const [tab, setTab] = useState<TabKey>(() =>
    typeof window === "undefined" ? "all" : ((localStorage.getItem("leads:tab") as TabKey) || "all"),
  );

  useEffect(() => { document.title = "Leads · Outreach Studio"; }, []);
  useEffect(() => { localStorage.setItem("leads:view", view); }, [view]);
  useEffect(() => { localStorage.setItem("leads:tab", tab); }, [tab]);

  const load = async () => {
    if (!user) return;
    let leadsQuery = supabase.from("leads").select("*");
    if (campaignFilter === RAW_VALUE) leadsQuery = leadsQuery.is("campaign_id", null);
    else if (campaignFilter) leadsQuery = leadsQuery.eq("campaign_id", campaignFilter);
    const [{ data: cs }, leadsRes, { data: prof }] = await Promise.all([
      supabase.from("campaigns").select("id,name").order("name"),
      leadsQuery.order("score", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("profiles").select("outreach_region").eq("user_id", user.id).maybeSingle(),
    ]);
    setCampaigns((cs as Campaign[]) ?? []);
    setLeads((leadsRes.data as LeadDetail[]) ?? []);
    if (prof) setRegion((prof as any).outreach_region || "Nigeria");
  };

  useEffect(() => { if (user) load(); }, [user?.id, campaignFilter]);

  const counters = useMemo(() => {
    const total = leads.length;
    const hot = leads.filter((l) => (l.score ?? 0) >= 70).length;
    const ready = leads.filter((l) => l.contact_email && !["sent", "opened", "replied", "won", "lost"].includes(l.status)).length;
    const needs = leads.filter((l) => !l.contact_email && !l.phone).length;
    const raw = leads.filter((l) => !l.campaign_id).length;
    return { total, hot, ready, needs, raw };
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (q && !`${l.business_name} ${l.contact_email ?? ""} ${l.contact_name ?? ""} ${l.website ?? ""}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if ((l.score ?? 0) < minScore) return false;
      switch (tab) {
        case "raw": return !l.campaign_id;
        case "hot": return (l.score ?? 0) >= 70;
        case "ready": return !!l.contact_email && !["sent", "opened", "replied", "won", "lost"].includes(l.status);
        case "needs": return !l.contact_email && !l.phone;
        case "replied": return l.status === "replied";
        case "won": return l.status === "won";
        default: return true;
      }
    });
  }, [leads, search, statusFilter, minScore, tab]);

  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((l) => l.id))));

  const handleCreate = async () => {
    if (!user || !draft.business_name?.trim()) return;
    // campaign_id: explicitly null if user picked "no campaign", else the chosen one, else inherit URL filter (unless filter is RAW)
    let cid: string | null = null;
    if (draft.campaign_id !== undefined) cid = draft.campaign_id;
    else if (campaignFilter && campaignFilter !== RAW_VALUE) cid = campaignFilter;
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
      campaign_id: cid,
    } as never);
    if (error) return toast({ title: "Create failed", description: error.message, variant: "destructive" });
    setOpen(false);
    setDraft({ business_name: "", status: "new", campaign_id: null });
    load();
  };

  const bulkAssign = async (newCampaignId: string | null) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("leads").update({ campaign_id: newCampaignId }).in("id", ids);
    if (error) return toast({ title: "Assign failed", description: error.message, variant: "destructive" });
    toast({ title: newCampaignId ? "Assigned to campaign" : "Detached to raw pool", description: `${ids.length} lead${ids.length === 1 ? "" : "s"} updated.` });
    setSelected(new Set());
    setAssignTarget("");
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

  const sendWhatsApp = async (lead: LeadDetail) => {
    if (!lead.phone) return toast({ title: "No phone", description: "Add a phone number first.", variant: "destructive" });
    const body = window.prompt(`WhatsApp ${lead.business_name} (${lead.phone}):`, "");
    if (!body?.trim()) return;
    const { data, error } = await supabase.functions.invoke("send-whatsapp", { body: { leadId: lead.id, body } });
    if (error || (data && (data as any).error)) return toast({ title: "WhatsApp failed", description: error?.message || (data as any)?.error, variant: "destructive" });
    toast({ title: "WhatsApp sent" });
    load();
  };

  const openDetail = (lead: LeadDetail) => { setDetailLead(lead); setDetailOpen(true); };
  const openDraft = (lead: LeadDetail) => { setPitchLead(lead); setPitchOpen(true); };

  return (
    <div className="container mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Header + counters */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {counters.total} leads · <span className="text-success">{counters.hot} hot</span> · <span className="text-primary">{counters.ready} ready</span> · {counters.needs} need enrichment · <span className="text-foreground">{counters.raw} raw</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" />Region: {region}</Badge>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Add lead</Button></DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Add lead</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <div className="space-y-1.5"><Label>Business name</Label><Input value={draft.business_name ?? ""} onChange={(e) => setDraft({ ...draft, business_name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Campaign</Label>
                  <Select
                    value={draft.campaign_id === null ? NO_CAMPAIGN : (draft.campaign_id ?? (campaignFilter && campaignFilter !== RAW_VALUE ? campaignFilter : NO_CAMPAIGN))}
                    onValueChange={(v) => setDraft({ ...draft, campaign_id: v === NO_CAMPAIGN ? null : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CAMPAIGN}>— Raw lead (no campaign) —</SelectItem>
                      {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>Website</Label><Input value={draft.website ?? ""} onChange={(e) => setDraft({ ...draft, website: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Phone</Label><Input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Contact name</Label><Input value={draft.contact_name ?? ""} onChange={(e) => setDraft({ ...draft, contact_name: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Contact email</Label><Input type="email" value={draft.contact_email ?? ""} onChange={(e) => setDraft({ ...draft, contact_email: e.target.value })} /></div>
                </div>
                <div className="space-y-1.5"><Label>Address</Label><Input value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Notes</Label><Textarea rows={3} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Add lead</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, domain…" className="pl-9" />
        </div>
        <Select value={campaignFilter ?? "all"} onValueChange={(v) => v === "all" ? setParams({}) : setParams({ campaign: v })}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Campaign" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All campaigns</SelectItem>
            <SelectItem value={RAW_VALUE}>📥 Raw leads (unassigned)</SelectItem>
            {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(minScore)} onValueChange={(v) => setMinScore(Number(v))}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Score ≥ 0</SelectItem>
            <SelectItem value="40">Score ≥ 40</SelectItem>
            <SelectItem value="60">Score ≥ 60</SelectItem>
            <SelectItem value="70">Score ≥ 70</SelectItem>
            <SelectItem value="80">Score ≥ 80</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1 rounded-md border p-0.5">
          <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")} className="h-7 px-2"><List className="h-4 w-4" /></Button>
          <Button size="sm" variant={view === "cards" ? "secondary" : "ghost"} onClick={() => setView("cards")} className="h-7 px-2"><LayoutGrid className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex-wrap h-auto">
          {TABS.map((t) => <TabsTrigger key={t.key} value={t.key} className="text-xs sm:text-sm">{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {/* Bulk action bar — assign to campaign */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline"><Inbox className="h-4 w-4" /> Assign to campaign…</Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2">
              <Label className="text-xs">Move {selected.size} lead{selected.size === 1 ? "" : "s"} to:</Label>
              <Select value={assignTarget} onValueChange={setAssignTarget}>
                <SelectTrigger><SelectValue placeholder="Pick campaign" /></SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => assignTarget && bulkAssign(assignTarget)} disabled={!assignTarget}>Assign</Button>
                <Button size="sm" variant="outline" onClick={() => bulkAssign(null)} title="Detach">Detach</Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto"><X className="h-4 w-4" /> Clear</Button>
        </div>
      )}

      <BulkDraftBar selectedIds={Array.from(selected)} onClear={() => setSelected(new Set())} onComplete={() => { setSelected(new Set()); load(); }} />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {leads.length === 0
              ? "No leads yet. Launch a campaign or add one manually."
              : `No leads match this view.`}
          </CardContent>
        </Card>
      ) : view === "cards" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l) => (
            <LeadCard key={l.id} lead={l} selected={selected.has(l.id)} onSelect={() => toggleOne(l.id)} onClick={() => openDetail(l)} />
          ))}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={selected.size > 0 && selected.size === filtered.length} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="w-20">Score</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => {
                const score = l.score ?? 0;
                const scoreColor = score >= 70 ? "border-success/50 text-success" : score >= 40 ? "border-primary/50 text-primary" : "text-muted-foreground";
                return (
                  <TableRow key={l.id} data-state={selected.has(l.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => openDetail(l)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(l.id)} onCheckedChange={() => toggleOne(l.id)} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{l.business_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.contact_name && <span>{l.contact_name} · </span>}
                        {l.website && <span>{l.website.replace(/^https?:\/\//, "")}</span>}
                      </div>
                      {l.enrichment_summary && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/80">{l.enrichment_summary}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={scoreColor}>{score}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {l.contact_email && <Mail className="h-3.5 w-3.5 text-success" />}
                        {l.phone && <Phone className="h-3.5 w-3.5 text-success" />}
                        {(l.linkedin_url || l.instagram_url || l.facebook_url || l.x_url) && <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={l.status} onValueChange={(v) => updateStatus(l.id, v as LeadStatus)}>
                        <SelectTrigger className="h-8 w-[120px] border-0 bg-transparent p-0">
                          <Badge className={statusVariant[l.status as LeadStatus] + " capitalize"}>{l.status}</Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Draft pitch" onClick={() => openDraft(l)}><Sparkles className="h-4 w-4" /></Button>
                        {l.phone && <Button variant="ghost" size="icon" title="WhatsApp" onClick={() => sendWhatsApp(l)}><MessageCircle className="h-4 w-4" /></Button>}
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(l.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <PitchDrawer lead={pitchLead as any} open={pitchOpen} onOpenChange={setPitchOpen} onSaved={load} />
      <LeadDetailDrawer
        lead={detailLead}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        campaigns={campaigns}
        onDraftPitch={(l) => { setDetailOpen(false); openDraft(l); }}
        onWhatsApp={(l) => { setDetailOpen(false); sendWhatsApp(l); }}
        onChanged={load}
      />
      <ImportLeadsDialog open={importOpen} onOpenChange={setImportOpen} campaigns={campaigns} onImported={load} />
    </div>
  );
};

export default Leads;
