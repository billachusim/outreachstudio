import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Check, Newspaper, Sparkles, UserPlus, Settings, Share2, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { IntelPitchDrawer } from "@/components/IntelPitchDrawer";
import { IntelLeadDrawer } from "@/components/IntelLeadDrawer";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

type IntelItem = {
  id: string;
  source: string;
  title: string;
  url: string | null;
  summary: string | null;
  relevance_score: number | null;
  tags: string[] | null;
  acted_on: boolean;
  created_at: string;
  published_at: string | null;
  matched_offerings: string[] | null;
  linked_lead_id: string | null;
  linked_pitch_id: string | null;
};

const Intel = () => {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [pitchOpen, setPitchOpen] = useState<IntelItem | null>(null);
  const [leadOpen, setLeadOpen] = useState<IntelItem | null>(null);
  const [draftingSocial, setDraftingSocial] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("intel_items")
      .select("*")
      .order("relevance_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) toast.error(error.message);
    setItems((data as IntelItem[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    const { error } = await supabase.functions.invoke("scan-intel");
    setScanning(false);
    if (error) toast.error(error.message);
    else { toast.success("Scan started — refresh in ~30s"); setTimeout(load, 30000); }
  };

  const markActed = async (id: string) => {
    const { error } = await supabase.from("intel_items").update({ acted_on: true }).eq("id", id);
    if (error) return toast.error(error.message);
    setItems((p) => p.map((i) => (i.id === id ? { ...i, acted_on: true } : i)));
  };

  const draftSocial = async (item: IntelItem, platform: "x" | "linkedin" | "instagram") => {
    setDraftingSocial(item.id);
    const { data, error } = await supabase.functions.invoke("draft-social-from-intel", {
      body: { intelItemId: item.id, platform },
    });
    setDraftingSocial(null);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    toast.success(`${platform.toUpperCase()} draft saved — see Social tab`);
  };

  const scoreColor = (s: number | null) => {
    if (!s) return "bg-muted text-muted-foreground";
    if (s >= 70) return "bg-success/15 text-success";
    if (s >= 50) return "bg-warning/15 text-warning";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="h-6 w-6" /> Intel
          </h1>
          <p className="text-sm text-muted-foreground">News triggers scored against your offerings.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/intel/sources"><Settings className="h-4 w-4 mr-1.5" /> Sources</Link>
          </Button>
          <Button onClick={runScan} disabled={scanning} size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No intel yet. Click "Scan now" to fetch the latest stories.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {items.map((it) => (
            <Card key={it.id} className={it.acted_on ? "opacity-60" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base leading-snug">{it.title}</CardTitle>
                  <Badge className={scoreColor(it.relevance_score)}>{it.relevance_score ?? 0}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{it.source}</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(it.created_at), { addSuffix: true })}</span>
                  {it.linked_lead_id && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <LinkIcon className="h-2.5 w-2.5" /> Linked to lead
                    </Badge>
                  )}
                  {it.linked_pitch_id && (
                    <Badge variant="outline" className="text-[10px]">Pitch drafted</Badge>
                  )}
                  {it.tags?.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {it.summary && <p className="text-sm text-muted-foreground">{it.summary}</p>}
                <div className="flex flex-wrap gap-2">
                  {it.url && (
                    <Button asChild size="sm" variant="outline">
                      <a href={it.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Read
                      </a>
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setPitchOpen(it)}>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Draft pitch
                  </Button>
                  {!it.linked_lead_id && (
                    <Button size="sm" variant="outline" onClick={() => setLeadOpen(it)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Create lead
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" disabled={draftingSocial === it.id}>
                        <Share2 className="h-3.5 w-3.5 mr-1.5" /> Draft post
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => draftSocial(it, "x")}>For X</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => draftSocial(it, "linkedin")}>For LinkedIn</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => draftSocial(it, "instagram")}>For Instagram</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {!it.acted_on && (
                    <Button size="sm" variant="ghost" onClick={() => markActed(it.id)}>
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Mark acted
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <IntelPitchDrawer
        open={!!pitchOpen}
        onOpenChange={(v) => { if (!v) { setPitchOpen(null); load(); } }}
        intelItemId={pitchOpen?.id ?? null}
        intelTitle={pitchOpen?.title}
        matchedOfferingIds={pitchOpen?.matched_offerings ?? []}
        linkedLeadId={pitchOpen?.linked_lead_id ?? null}
      />
      <IntelLeadDrawer
        open={!!leadOpen}
        onOpenChange={(v) => { if (!v) { setLeadOpen(null); load(); } }}
        intelItemId={leadOpen?.id ?? null}
        intelTitle={leadOpen?.title}
        intelUrl={leadOpen?.url ?? null}
        onCreated={() => load()}
      />
    </div>
  );
};

export default Intel;
