import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Newspaper, Sparkles, ExternalLink, Megaphone, FileText, Rocket, BarChart3, Zap } from "lucide-react";
import { IntelPitchDrawer } from "@/components/IntelPitchDrawer";
import { IntelSocialDrawer } from "@/components/IntelSocialDrawer";
import { IntelLaunchCampaignDrawer } from "@/components/IntelLaunchCampaignDrawer";

type Item = {
  id: string;
  source: string;
  title: string;
  url: string | null;
  relevance_score: number | null;
  matched_offerings: string[] | null;
  linked_lead_id: string | null;
  linked_pitch_id: string | null;
  spawned_campaign_id: string | null;
};

type RunProgress = { leads_sent: number; leads_found: number; target_lead_count: number; state: string };

export const TopTriggersWidget = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [socialId, setSocialId] = useState<string | null>(null);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState<Record<string, RunProgress>>({});

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("intel_items")
      .select("id, source, title, url, relevance_score, matched_offerings, linked_lead_id, linked_pitch_id, spawned_campaign_id")
      .eq("acted_on", false)
      .order("relevance_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3);

    // Also include items already auto-launched in the last 24h so the user sees the result.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: launched } = await supabase
      .from("intel_items")
      .select("id, source, title, url, relevance_score, matched_offerings, linked_lead_id, linked_pitch_id, spawned_campaign_id")
      .not("spawned_campaign_id", "is", null)
      .gte("created_at", since)
      .order("relevance_score", { ascending: false })
      .limit(3);

    const merged: Item[] = [];
    const seen = new Set<string>();
    for (const it of (launched as Item[]) ?? []) {
      if (!seen.has(it.id) && merged.length < 3) { merged.push(it); seen.add(it.id); }
    }
    for (const it of (data as Item[]) ?? []) {
      if (!seen.has(it.id) && merged.length < 3) { merged.push(it); seen.add(it.id); }
    }
    setItems(merged);

    const campaignIds = merged.map((m) => m.spawned_campaign_id).filter(Boolean) as string[];
    if (campaignIds.length > 0) {
      const { data: runs } = await supabase
        .from("campaign_runs")
        .select("campaign_id, leads_sent, leads_found, target_lead_count, state, updated_at")
        .in("campaign_id", campaignIds)
        .order("updated_at", { ascending: false });
      const map: Record<string, RunProgress> = {};
      for (const r of runs ?? []) {
        if (!map[r.campaign_id]) {
          map[r.campaign_id] = {
            leads_sent: r.leads_sent,
            leads_found: r.leads_found,
            target_lead_count: r.target_lead_count,
            state: r.state,
          };
        }
      }
      setRunProgress(map);
    } else {
      setRunProgress({});
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("top-triggers-runs")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_runs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const active = items.find((i) => i.id === openId) ?? null;
  const activeSocial = items.find((i) => i.id === socialId) ?? null;
  const activeLaunch = items.find((i) => i.id === launchId) ?? null;

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
              {items.map((it) => {
                const progress = it.spawned_campaign_id ? runProgress[it.spawned_campaign_id] : null;
                return (
                <li key={it.id} className="flex items-start gap-3 rounded-md border p-3">
                  <Badge className="shrink-0">{it.relevance_score ?? 0}</Badge>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium leading-snug line-clamp-2">{it.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="capitalize">{it.source}</span>
                      {it.spawned_campaign_id && (
                        <>
                          <span>·</span>
                          <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                            <Zap className="h-2.5 w-2.5" /> Auto-launched
                          </Badge>
                          {progress && (
                            <span>· {progress.leads_sent}/{progress.target_lead_count} sent · {progress.state}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {it.spawned_campaign_id ? (
                      <Button asChild size="sm" variant="default">
                        <Link to={`/campaigns?highlight=${it.spawned_campaign_id}`}>
                          <BarChart3 className="h-3 w-3 mr-1" /> View campaign
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="default" onClick={() => setLaunchId(it.id)}>
                        <Rocket className="h-3 w-3 mr-1" /> Launch
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => setOpenId(it.id)}>
                      {it.linked_pitch_id ? <FileText className="h-3 w-3 mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                      {it.linked_pitch_id ? "Pitch ✓" : "Pitch"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSocialId(it.id)}>
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
                );
              })}
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

      <IntelLaunchCampaignDrawer
        open={!!launchId}
        onOpenChange={(v) => { if (!v) { setLaunchId(null); load(); } }}
        intelItemId={activeLaunch?.id ?? null}
        intelTitle={activeLaunch?.title}
      />
    </>
  );
};
