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
import { Plus, Trash2, ArrowLeft, Globe } from "lucide-react";
import { toast } from "sonner";

type Source = { id: string; name: string; url: string; enabled: boolean; created_at: string };

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
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = "Intel sources · Outreach Studio"; }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("intel_sources").select("*").order("created_at");
    if (error) toast.error(error.message);
    setSources((data as Source[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const add = async () => {
    if (!user) return;
    if (!name.trim() || !url.trim()) return toast.error("Name and URL required");
    let safeUrl = url.trim();
    if (!/^https?:\/\//i.test(safeUrl)) safeUrl = `https://${safeUrl}`;
    const { error } = await supabase.from("intel_sources").insert({
      user_id: user.id, name: name.trim(), url: safeUrl, enabled: true,
    });
    if (error) return toast.error(error.message);
    setName(""); setUrl("");
    toast.success("Source added");
    load();
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
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Disrupt Africa" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground">URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://disrupt-africa.com/" />
            </div>
            <div className="flex items-end">
              <Button onClick={add}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
          </div>
        </CardContent>
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
                    <p className="font-medium truncate">{s.name}</p>
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
