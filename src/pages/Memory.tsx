import { useEffect, useMemo, useState } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, RefreshCw, Trash2, Brain, Sparkles, BookOpen, ChevronDown, Search, Lightbulb, Globe2 } from "lucide-react";
import { CvUploadCard } from "@/components/CvUploadCard";

const STARTER_SLUGS = ["identity", "personality", "portfolio", "playbook", "learning-loop"];

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
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [region, setRegion] = useState("Nigeria");
  const [countryCode, setCountryCode] = useState("ng");
  const [savingRegion, setSavingRegion] = useState(false);

  const loadRegion = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("profiles")
      .select("outreach_region, outreach_country_code")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      setRegion((data as any).outreach_region || "Nigeria");
      setCountryCode((data as any).outreach_country_code || "ng");
    }
  };

  const saveRegion = async () => {
    if (!user) return;
    setSavingRegion(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        outreach_region: region.trim() || "Nigeria",
        outreach_country_code: (countryCode.trim() || "ng").toLowerCase(),
      } as never)
      .eq("user_id", user.id);
    setSavingRegion(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Outreach region saved", description: `New campaigns will target ${region}.` });
  };

  useEffect(() => { loadRegion(); }, [user?.id]);


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

  const generateJournal = async () => {
    setGenerating(true);
    const { error } = await supabase.functions.invoke("daily-journal", {
      body: { force: true, only_user: true },
    });
    setGenerating(false);
    if (error) {
      toast({ title: "Journal failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Today's journal generated" });
    load();
  };

  const openLessonsLearned = () => {
    const existing = memories.find((m) => m.slug === "lessons-learned");
    if (existing) {
      setDraft(existing);
    } else {
      setDraft({
        slug: "lessons-learned",
        title: "Lessons learned",
        kind: "note",
        content: `# Lessons learned\n\n_Things that worked, things that didn't, patterns spotted. The agent reads this every turn._\n\n- `,
      });
    }
    setOpen(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q),
    );
  }, [memories, search]);

  const journals = useMemo(
    () =>
      filtered
        .filter((m) => m.slug.startsWith("daily-journal-") || m.slug.startsWith("weekly-journal-") || m.slug === "journal-rollup")
        .sort((a, b) => b.slug.localeCompare(a.slug)),
    [filtered],
  );

  const nonJournal = useMemo(
    () =>
      filtered.filter(
        (m) => !m.slug.startsWith("daily-journal-") && !m.slug.startsWith("weekly-journal-") && m.slug !== "journal-rollup",
      ),
    [filtered],
  );

  const grouped = nonJournal.reduce<Record<string, Memory[]>>((acc, m) => {
    (acc[m.kind] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
            <Brain className="h-5 w-5 sm:h-6 sm:w-6" /> Agent Memory
          </h1>
          <p className="text-sm text-muted-foreground">
            The studio agent reads these markdown files at the start of every chat. The journal auto-writes nightly so it learns what happened each day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={openLessonsLearned}>
            <Lightbulb className="h-4 w-4" /> Lessons learned
          </Button>
          <Button variant="outline" size="sm" onClick={generateJournal} disabled={generating}>
            <Sparkles className="h-4 w-4" /> {generating ? "Generating…" : "Generate today's journal"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!user) return;
              if (!confirm(
                "⚠️ OVERWRITE WARNING\n\n" +
                "This will REPLACE your edits to these 5 starter memories:\n" +
                "  • identity\n  • personality\n  • portfolio\n  • playbook\n  • learning-loop\n\n" +
                "Their title, kind and full content will be reset to factory defaults. Any wording you changed in those files will be LOST.\n\n" +
                "SAFE — these are NOT touched:\n" +
                "  • Any memory with a different slug (your custom notes)\n" +
                "  • Daily journals (daily-journal-*)\n" +
                "  • Weekly digests (weekly-journal-*)\n" +
                "  • The journal-rollup\n" +
                "  • Anything the agent appended via the learning loop\n\n" +
                "Continue?"
              )) return;
              await seedAgentMemoryIfEmpty(user.id, true);
              toast({ title: "Defaults restored" });
              load();
            }}
          >
            <RefreshCw className="h-4 w-4" /> Reset starters
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDraft(empty); }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setDraft(empty)}>
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

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories by title, slug, or content…"
          className="pl-9"
        />
      </div>

      <CvUploadCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="h-4 w-4" /> Outreach region
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Lead discovery (campaigns, intel auto-launches) is biased toward this region.
            Defaults to Nigeria.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs">Region name</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Nigeria" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Country code</Label>
              <Input
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toLowerCase().slice(0, 2))}
                placeholder="ng"
                maxLength={2}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={saveRegion} disabled={savingRegion} className="w-full sm:w-auto">
                {savingRegion ? "Saving…" : "Save region"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
          {journals.length > 0 && (
            <Collapsible open={journalOpen} onOpenChange={setJournalOpen}>
              <div className="rounded-lg border bg-card">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    <span className="font-semibold">Journal</span>
                    <Badge variant="secondary">{journals.length}</Badge>
                    <span className="text-xs text-muted-foreground">auto-generated nightly</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 transition-transform ${journalOpen ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="grid gap-3 border-t p-4 sm:grid-cols-2">
                    {journals.map((m) => (
                      <MemoryCard key={m.id} m={m} onEdit={() => { setDraft(m); setOpen(true); }} onDelete={() => handleDelete(m.id)} />
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {KINDS.filter((k) => grouped[k]?.length).map((kind) => (
            <div key={kind} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{kind}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {grouped[kind].map((m) => (
                  <MemoryCard key={m.id} m={m} onEdit={() => { setDraft(m); setOpen(true); }} onDelete={() => handleDelete(m.id)} />
                ))}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No memories match "{search}".
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

const MemoryCard = ({ m, onEdit, onDelete }: { m: Memory; onEdit: () => void; onDelete: () => void }) => (
  <Card className="flex flex-col">
    <CardHeader>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{m.title}</CardTitle>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{m.slug}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="secondary">{m.kind}</Badge>
          {STARTER_SLUGS.includes(m.slug) && (
            <Badge variant="outline" className="text-[10px]" title="Will be overwritten by 'Reset starters'">starter</Badge>
          )}
        </div>
      </div>
    </CardHeader>
    <CardContent className="flex-1 space-y-3">
      <pre className="max-h-40 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
        {m.content.slice(0, 400)}{m.content.length > 400 ? "…" : ""}
      </pre>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          Updated {new Date(m.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
    {children}
  </div>
);

export default Memory;
