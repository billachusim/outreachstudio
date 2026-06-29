import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowLeft, Globe, Sparkles, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";

type Kind = "news" | "job_board" | "talent_marketplace" | "ad_signal_meta" | "ad_signal_google" | "google_maps";
type Source = { id: string; name: string; url: string; enabled: boolean; created_at: string; auto_promoted: boolean; kind: Kind };
type Suggestion = { name: string; url: string; why_relevant: string; type: "news" | "blog" | "directory" | "listicle" | "ad_signal_meta" | "ad_signal_google" | "google_maps" };

const DEFAULTS = [
  { name: "Techcabal", url: "https://techcabal.com/" },
  { name: "Techpoint", url: "https://techpoint.africa/" },
  { name: "BusinessDay Tech", url: "https://businessday.ng/category/technology/" },
];

const IntelSources = () => {
  const { user } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("news");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);

  // Discover state
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [addingHosts, setAddingHosts] = useState<Set<string>>(new Set());

  useEffect(() => { document.title = "Intel sources · Outreach Studio"; }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("intel_sources").select("*")
      .in("kind", ["news", "ad_signal_meta", "ad_signal_google", "google_maps"])
      .order("created_at");
    if (error) toast.error(error.message);
    setSources((data as Source[]) ?? []);
    setLoading(false);
  };

  const scanAdsNow = async () => {
    setScanning(true);
    try {
      const { error } = await supabase.functions.invoke("scan-ads", { body: {} });
      if (error) throw error;
      toast.success("Ad scan started — new advertiser leads will land in your Leads list shortly.");
    } catch (e: any) {
      toast.error(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => { load(); }, [user?.id]);

  const add = async () => {
    if (!user) return;
    const isAd = kind === "ad_signal_meta" || kind === "ad_signal_google" || kind === "google_maps";
    if (!name.trim()) return toast.error(isAd ? "Keyword required" : "Name required");
    if (!isAd && !url.trim()) return toast.error("URL required");
    let safeUrl = url.trim();
    if (safeUrl && !/^https?:\/\//i.test(safeUrl)) safeUrl = `https://${safeUrl}`;
    const { error } = await supabase.from("intel_sources").insert({
      user_id: user.id, name: name.trim(), url: safeUrl || name.trim(), enabled: true, kind,
    } as never);
    if (error) return toast.error(error.message);
    setName(""); setUrl("");
    toast.success(isAd ? "Ad source added — run a scan to pull advertisers." : "Source added");
    load();
  };

  const scanJobsNow = async () => {
    setScanning(true);
    try {
      const { error } = await supabase.functions.invoke("scan-jobs", { body: {} });
      if (error) throw error;
      toast.success("Scan started — new jobs will appear in your Freelance Jobs campaign within ~30s.");
    } catch (e: any) {
      toast.error(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const toggle = async (s: Source) => {
    const { error } = await supabase.from("intel_sources").update({ enabled: !s.enabled }).eq("id", s.id);
    if (error) return toast.error(error.message);
    setSources((p) => p.map((x) => x.id === s.id ? { ...x, enabled: !x.enabled } : x));
  };

  const remove = async (s: Source) => {
    if (!confirm(`Remove "${s.name}"?`)) return;
    const { error } = await supabase.from("intel_sources").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    setSources((p) => p.filter((x) => x.id !== s.id));
  };

  const discover = async () => {
    setDiscovering(true);
    setSuggestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("discover-intel-sources", { body: {} });
      if (error) throw error;
      const d = data as { suggestions?: Suggestion[]; error?: string };
      if (d?.error) throw new Error(d.error);
      const list = d?.suggestions ?? [];
      setSuggestions(list);
      if (list.length === 0) toast.info("No new suggestions — try again later or refine your offerings.");
      else toast.success(`Found ${list.length} new source${list.length === 1 ? "" : "s"} to consider`);
    } catch (e: any) {
      toast.error(e?.message ?? "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const addSuggestion = async (s: Suggestion) => {
    if (!user) return;
    const AD_TYPES = ["ad_signal_meta", "ad_signal_google", "google_maps"] as const;
    const isAd = (AD_TYPES as readonly string[]).includes(s.type);
    const kind: Kind = isAd ? (s.type as Kind) : "news";
    const dedupeKey = isAd ? `${s.type}::${s.name.toLowerCase()}` : s.url;
    setAddingHosts((p) => new Set(p).add(dedupeKey));
    try {
      const { error } = await supabase.from("intel_sources").insert({
        user_id: user.id,
        name: s.name,
        url: isAd ? (s.url || s.name) : s.url,
        enabled: true,
        kind,
      } as never);
      if (error) throw error;
      toast.success(`Added ${s.name}`);
      setSuggestions((prev) => (prev ?? []).filter((x) => (isAd ? !(x.type === s.type && x.name === s.name) : x.url !== s.url)));
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add");
    } finally {
      setAddingHosts((p) => { const n = new Set(p); n.delete(dedupeKey); return n; });
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Button asChild size="sm" variant="ghost" className="mb-2 -ml-2">
            <Link to="/intel"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Intel</Link>
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6" /> Intel sources
          </h1>
          <p className="text-sm text-muted-foreground">Add custom news sites or RSS feeds. Scanned alongside the defaults.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Built-in sources (always on)</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {DEFAULTS.map((d) => (
              <li key={d.url} className="flex items-center justify-between rounded-md border p-2">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">{d.url}</p>
                </div>
                <Badge variant="secondary">Default</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Add a custom source</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_180px_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Name / keyword</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind.startsWith("ad_signal") || kind === "google_maps" ? "e.g. dental clinic" : "Remote OK"} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">URL {(kind.startsWith("ad_signal") || kind === "google_maps") && <span className="text-[10px] normal-case">(optional for ad sources)</span>}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind.startsWith("ad_signal") || kind === "google_maps" ? "https://(optional)" : "https://remoteok.com/"} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Kind</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <option value="news">News / blog</option>
                <option value="ad_signal_meta">Meta Ads advertisers</option>
                <option value="ad_signal_google">Google Ads advertisers</option>
                <option value="google_maps">Google Maps businesses</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={add}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <span>Ad sources surface businesses actively running ads — high buyer intent. Scan runs automatically; you can trigger one now.</span>
            <Button size="sm" variant="outline" onClick={scanAdsNow} disabled={scanning} className="gap-1.5 shrink-0">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Scan ads now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" /> Discover new sources
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Find news sites, blogs, and directories that match your offerings and region.
              </p>
            </div>
            <Button size="sm" onClick={discover} disabled={discovering} className="gap-1.5 shrink-0">
              {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : suggestions ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {discovering ? "Searching…" : suggestions ? "Refresh" : "Discover"}
            </Button>
          </div>
        </CardHeader>
        {suggestions && (
          <CardContent>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fresh suggestions right now. Try refreshing or update your offerings.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((s) => {
                  const host = (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })();
                  const adding = addingHosts.has(host);
                  return (
                    <li key={s.url} className="flex items-start justify-between gap-3 rounded-md border p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{s.name}</p>
                          <Badge variant="outline" className="text-[10px] capitalize">{s.type}</Badge>
                        </div>
                        <a href={s.url} target="_blank" rel="noreferrer" className="block text-xs text-primary truncate hover:underline">{s.url}</a>
                        <p className="text-xs text-muted-foreground mt-1">{s.why_relevant}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={adding} onClick={() => addSuggestion(s)} className="shrink-0">
                        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-1" /> Add</>}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Your sources</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom sources yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border p-2 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{s.name}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{(s.kind || "news").replace("_", " ")}</Badge>
                      {s.auto_promoted && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <Sparkles className="h-2.5 w-2.5" /> Auto-promoted
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{s.url}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} />
                    <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default IntelSources;
