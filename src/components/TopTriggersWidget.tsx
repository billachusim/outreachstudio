import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Newspaper, Sparkles, ExternalLink, Megaphone, FileText } from "lucide-react";
import { IntelPitchDrawer } from "@/components/IntelPitchDrawer";
import { IntelSocialDrawer } from "@/components/IntelSocialDrawer";

type Item = {
  id: string;
  source: string;
  title: string;
  url: string | null;
  relevance_score: number | null;
  matched_offerings: string[] | null;
  linked_lead_id: string | null;
};

export const TopTriggersWidget = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [socialId, setSocialId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("intel_items")
      .select("id, source, title, url, relevance_score, matched_offerings, linked_lead_id")
      .eq("acted_on", false)
      .order("relevance_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3);
    setItems((data as Item[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const active = items.find((i) => i.id === openId) ?? null;
  const activeSocial = items.find((i) => i.id === socialId) ?? null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Newspaper className="h-4 w-4" /> Today's top triggers
          </CardTitle>
          <Button asChild size="sm" variant="ghost">
            <Link to="/intel">Open Intel →</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fresh triggers. <Link to="/intel" className="text-primary hover:underline">Run a scan</Link> to fetch the latest.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((it) => (
                <li key={it.id} className="flex items-start gap-3 rounded-md border p-3">
                  <Badge className="shrink-0">{it.relevance_score ?? 0}</Badge>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-snug line-clamp-2">{it.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">{it.source}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button size="sm" variant="default" onClick={() => setOpenId(it.id)}>
                      <Sparkles className="h-3 w-3 mr-1" /> Pitch
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setSocialId(it.id)}>
                      <Megaphone className="h-3 w-3 mr-1" /> Post
                    </Button>
                    {it.url && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={it.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <IntelPitchDrawer
        open={!!openId}
        onOpenChange={(v) => { if (!v) { setOpenId(null); load(); } }}
        intelItemId={active?.id ?? null}
        intelTitle={active?.title}
        matchedOfferingIds={active?.matched_offerings ?? []}
        linkedLeadId={active?.linked_lead_id ?? null}
      />

      <IntelSocialDrawer
        open={!!socialId}
        onOpenChange={(v) => { if (!v) setSocialId(null); }}
        intelItemId={activeSocial?.id ?? null}
        intelTitle={activeSocial?.title}
      />
    </>
  );
};
