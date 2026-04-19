import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { seedAgentMemoryIfEmpty } from "@/lib/seedAgentMemory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, RefreshCw, Trash2, Brain } from "lucide-react";

type Memory = {
  id: string;
  slug: string;
  title: string;
  kind: string;
  content: string;
  updated_at: string;
};

const KINDS = ["identity", "personality", "portfolio", "playbook", "note"] as const;

const empty: Partial<Memory> = { slug: "", title: "", kind: "note", content: "" };

const Memory = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Memory>>(empty);

  useEffect(() => {
    document.title = "Memory · Outreach Studio";
  }, []);

  const load = async () => {
    if (!user) return;
    await seedAgentMemoryIfEmpty(user.id);
    const { data, error } = await supabase
      .from("agent_memories")
      .select("*")
      .order("kind", { ascending: true })
      .order("updated_at", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else setMemories(data as Memory[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSave = async () => {
    if (!user || !draft.slug?.trim() || !draft.title?.trim()) {
      toast({ title: "Slug and title required", variant: "destructive" });
      return;
    }
    const payload = {
      user_id: user.id,
      slug: draft.slug.trim(),
      title: draft.title.trim(),
      kind: draft.kind ?? "note",
      content: draft.content ?? "",
    };
    const { error } = draft.id
      ? await supabase.from("agent_memories").update(payload).eq("id", draft.id)
      : await supabase.from("agent_memories").insert(payload as never);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    setOpen(false);
    setDraft(empty);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this memory file? The agent will lose this context.")) return;
    const { error } = await supabase.from("agent_memories").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    load();
  };

  const grouped = memories.reduce<Record<string, Memory[]>>((acc, m) => {
    (acc[m.kind] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-6 w-6" /> Agent Memory
          </h1>
          <p className="text-sm text-muted-foreground">
            The studio agent reads these markdown files at the start of every chat. Edit them to shape its identity, tone, knowledge, and playbook.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              if (!user) return;
              if (!confirm("Reset the 4 starter memories (identity, personality, portfolio, playbook) to defaults? Your custom notes are not touched.")) return;
              await seedAgentMemoryIfEmpty(user.id, true);
              toast({ title: "Defaults restored" });
              load();
            }}
          >
            <RefreshCw className="h-4 w-4" /> Reset starters
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDraft(empty); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setDraft(empty)}>
                <Plus className="h-4 w-4" /> New memory
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit memory" : "New memory"}</DialogTitle>
                <DialogDescription>Markdown is recommended. The agent sees the full content on every turn.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Slug (unique id)">
                    <Input
                      value={draft.slug ?? ""}
                      onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "-") })}
                      placeholder="e.g. retailos-objections"
                    />
                  </Field>
                  <Field label="Kind">
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draft.kind ?? "note"}
                      onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Title">
                  <Input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </Field>
                <Field label="Content (markdown)">
                  <Textarea
                    rows={18}
                    className="font-mono text-xs"
                    value={draft.content ?? ""}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  />
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleSave}>Save memory</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : memories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No memories yet. Click "Reset starters" to seed the defaults.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {KINDS.filter((k) => grouped[k]?.length).map((kind) => (
            <div key={kind} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{kind}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {grouped[kind].map((m) => (
                  <Card key={m.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{m.title}</CardTitle>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">{m.slug}</p>
                        </div>
                        <Badge variant="secondary">{m.kind}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3">
                      <pre className="max-h-40 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                        {m.content.slice(0, 400)}{m.content.length > 400 ? "…" : ""}
                      </pre>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setDraft(m); setOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(m.id)}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
    {children}
  </div>
);

export default Memory;
