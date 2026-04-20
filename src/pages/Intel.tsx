import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw, Check, Newspaper } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
};

const Intel = () => {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

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
    else { toast.success("Scan complete"); load(); }
  };

  const markActed = async (id: string) => {
    const { error } = await supabase.from("intel_items").update({ acted_on: true }).eq("id", id);
    if (error) return toast.error(error.message);
    setItems((p) => p.map((i) => (i.id === id ? { ...i, acted_on: true } : i)));
  };

  const scoreColor = (s: number | null) => {
    if (!s) return "bg-muted text-muted-foreground";
    if (s >= 70) return "bg-green-500/15 text-green-700 dark:text-green-400";
    if (s >= 50) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Newspaper className="h-6 w-6" /> Intel
          </h1>
          <p className="text-sm text-muted-foreground">News triggers from Techcabal, Techpoint, BusinessDay — scored against your offerings.</p>
        </div>
        <Button onClick={runScan} disabled={scanning} size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning…" : "Scan now"}
        </Button>
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
    </div>
  );
};

export default Intel;
