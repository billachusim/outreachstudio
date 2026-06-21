import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Globe, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Kind = "job_board" | "talent_marketplace";
type Source = { id: string; name: string; url: string; enabled: boolean; created_at: string; kind: Kind };

const DEFAULTS = [
  { name: "Remote OK", url: "https://remoteok.com/" },
  { name: "We Work Remotely", url: "https://weworkremotely.com/" },
];

export const JobSourcesPanel = () => {
  const { user } = useAuth();
  const [sources, setSources] = useState<Source[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("job_board");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastScans, setLastScans] = useState<Record<string, { fetched: number; kept_new: number; level: string; at: string }>>({});

  const loadDiagnostics = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("run_events")
      .select("level, message, created_at")
      .eq("user_id", user.id)
      .eq("kind", "scan_jobs")
      .order("created_at", { ascending: false })
      .limit(200);
    const map: Record<string, { fetched: number; kept_new: number; level: string; at: string }> = {};
    for (const ev of (data ?? []) as Array<{ level: string; message: string; created_at: string }>) {
      const m = ev.message.match(/^source:(.+?)\s+fetched=(\d+)\s+kept_new=(\d+)/);
      if (!m) continue;
      const nm = m[1].trim();
      if (map[nm]) continue; // keep most recent
      map[nm] = { fetched: Number(m[2]), kept_new: Number(m[3]), level: ev.level, at: ev.created_at };
    }
    setLastScans(map);
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("intel_sources").select("*")
      .in("kind", ["job_board", "talent_marketplace"])
      .order("created_at");
    if (error) toast.error(error.message);
    setSources((data as Source[]) ?? []);
    setLoading(false);
    loadDiagnostics();
  };

  useEffect(() => { load(); }, [user?.id]);

  const add = async () => {
    if (!user) return;
    if (!name.trim() || !url.trim()) return toast.error("Name and URL required");
    let safeUrl = url.trim();
    if (!/^https?:\/\//i.test(safeUrl)) safeUrl = `https://${safeUrl}`;
    const { error } = await supabase.from("intel_sources").insert({
      user_id: user.id, name: name.trim(), url: safeUrl, enabled: true, kind,
    } as never);
    if (error) return toast.error(error.message);
    setName(""); setUrl("");
    toast.success("Source added");
    load();
  };

  const scan = async () => {
    setScanning(true);
    try {
      const { error } = await supabase.functions.invoke("scan-jobs", { body: {} });
      if (error) throw error;
      toast.success("Scan started — new jobs appear within ~30s.");
    } catch (e: any) { toast.error(e?.message ?? "Scan failed"); }
    finally { setScanning(false); }
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" /> Built-in job boards
          </CardTitle>
          <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {scanning ? "Scanning…" : "Scan jobs now"}
          </Button>
        </CardHeader>
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
        <CardHeader><CardTitle className="text-base">Add a custom job source</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_160px_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Remote OK" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://remoteok.com/" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Kind</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <option value="job_board">Job board</option>
                <option value="talent_marketplace">Talent marketplace</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={add}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Your job sources</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom job sources yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border p-2 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{s.name}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{s.kind.replace("_", " ")}</Badge>
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
