import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Send, Trash2, Newspaper, Loader2, Twitter, Linkedin, Instagram } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type Platform = "x" | "linkedin" | "instagram";
type Draft = {
  id: string;
  platform: Platform;
  body: string;
  status: string;
  posted_at: string | null;
  created_at: string;
  intel_item_id: string | null;
  intel_items?: { title: string; url: string | null; source: string } | null;
};
type ChannelAccount = { channel: string };

const platformMeta: Record<Platform, { label: string; icon: any; postFn: string }> = {
  x: { label: "X", icon: Twitter, postFn: "post-x" },
  linkedin: { label: "LinkedIn", icon: Linkedin, postFn: "" }, // no LinkedIn function yet
  instagram: { label: "Instagram", icon: Instagram, postFn: "post-instagram" },
};

const Social = () => {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [channels, setChannels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<string | null>(null);
  const [tab, setTab] = useState<Platform>("x");

  useEffect(() => { document.title = "Social · Outreach Studio"; }, []);

  const load = async () => {
    setLoading(true);
    const [draftsRes, chRes] = await Promise.all([
      supabase
        .from("social_drafts")
        .select("*, intel_items(title, url, source)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("channel_accounts").select("channel").eq("status", "active"),
    ]);
    setDrafts((draftsRes.data as Draft[]) ?? []);
    setChannels(new Set(((chRes.data as ChannelAccount[]) ?? []).map((c) => c.channel)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const copy = async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Copied to clipboard");
    } catch { toast.error("Copy failed"); }
  };

  const dismiss = async (id: string) => {
    const { error } = await supabase.from("social_drafts").update({ status: "dismissed" }).eq("id", id);
    if (error) return toast.error(error.message);
    setDrafts((p) => p.filter((d) => d.id !== id));
  };

  const post = async (d: Draft) => {
    const meta = platformMeta[d.platform];
    if (!meta.postFn) return toast.error("Auto-posting for this platform not yet wired");
    if (!isPlatformConnected(d.platform)) {
      return toast.error(`Connect a ${meta.label} channel first`);
    }
    setPosting(d.id);
    const payload = d.platform === "instagram"
      ? { caption: d.body, image_url: "" }
      : { text: d.body };
    const { data, error } = await supabase.functions.invoke(meta.postFn, { body: payload });
    setPosting(null);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    await supabase.from("social_drafts").update({
      status: "posted",
      posted_at: new Date().toISOString(),
      provider_post_id: (data as any)?.id ?? (data as any)?.tweet_id ?? null,
    }).eq("id", d.id);
    toast.success(`Posted to ${meta.label}`);
    load();
  };

  const isPlatformConnected = (p: Platform) => {
    if (p === "x") return channels.has("x") || channels.has("twitter");
    if (p === "instagram") return channels.has("instagram");
    if (p === "linkedin") return channels.has("linkedin");
    return false;
  };

  const filtered = drafts.filter((d) => d.platform === tab && d.status === "draft");

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Social</h1>
        <p className="text-sm text-muted-foreground">AI-drafted posts off your top intel triggers. Copy or auto-post.</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Platform)}>
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
          {(["x", "linkedin", "instagram"] as Platform[]).map((p) => {
            const meta = platformMeta[p];
            const Icon = meta.icon;
            const count = drafts.filter((d) => d.platform === p && d.status === "draft").length;
            return (
              <TabsTrigger key={p} value={p} className="gap-1.5">
                <Icon className="h-4 w-4" /> {meta.label}
                {count > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{count}</Badge>}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(["x", "linkedin", "instagram"] as Platform[]).map((p) => (
          <TabsContent key={p} value={p} className="space-y-3 mt-4">
            {!isPlatformConnected(p) && (
              <Card className="border-amber-500/40">
                <CardContent className="p-3 text-xs text-muted-foreground">
                  No {platformMeta[p].label} channel connected — you can still copy posts manually. <a href="/channels" className="text-primary hover:underline">Connect channel →</a>
                </CardContent>
              </Card>
            )}
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
                No {platformMeta[p].label} drafts yet. Drafts are auto-generated nightly from top intel, or via the "Draft post" button on Intel cards.
              </CardContent></Card>
            ) : (
              filtered.map((d) => (
                <Card key={d.id}>
                  <CardContent className="p-4 space-y-3">
                    {d.intel_items && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <Newspaper className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="line-clamp-1">
                            {d.intel_items.url ? (
                              <a href={d.intel_items.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                {d.intel_items.title}
                              </a>
                            ) : d.intel_items.title}
                          </p>
                          <p className="capitalize">{d.intel_items.source} · {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}</p>
                        </div>
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{d.body}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => copy(d.body)}>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => post(d)}
                        disabled={posting === d.id || !isPlatformConnected(d.platform) || !platformMeta[d.platform].postFn}
                      >
                        {posting === d.id
                          ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          : <Send className="h-3.5 w-3.5 mr-1" />}
                        Auto-post
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dismiss(d.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default Social;
