import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Save, Loader2, Copy, ChevronDown, ChevronRight, Pencil, ArrowUpToLine, Trash2, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Lead = { id: string; business_name: string; status: string };
type Template = { id: string; name: string };
type Pitch = {
  id: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  sent_at: string | null;
};

interface Props {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const TONES = ["warm & concise", "punchy & direct", "consultative", "playful", "formal"];

export const PitchDrawer = ({ lead, open, onOpenChange, onSaved }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [tone, setTone] = useState<string>("warm & concise");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [revisingId, setRevisingId] = useState<string | null>(null);
  const [reviseInstructions, setReviseInstructions] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [revising, setRevising] = useState(false);

  useEffect(() => {
    if (!open || !lead) return;
    setSubject("");
    setBody("");
    (async () => {
      const [{ data: tpls }, { data: pts }] = await Promise.all([
        supabase.from("templates").select("id,name").order("created_at", { ascending: false }),
        supabase
          .from("pitches")
          .select("id,subject,body,created_at,sent_at")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false }),
      ]);
      setTemplates((tpls as Template[]) ?? []);
      setPitches((pts as Pitch[]) ?? []);
    })();
  }, [open, lead?.id]);

  const handleDraft = async () => {
    if (!lead) return;
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke("draft-pitch", {
        body: { leadId: lead.id, templateId, tone },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setSubject((data as any).subject ?? "");
      setBody((data as any).body ?? "");
    } catch (e: any) {
      toast({
        title: "Draft failed",
        description: e?.message ?? "Could not draft pitch.",
        variant: "destructive",
      });
    } finally {
      setDrafting(false);
    }
  };

  const handleSave = async () => {
    if (!lead || !user) return;
    if (!subject.trim() && !body.trim()) {
      toast({ title: "Nothing to save", description: "Draft or write something first.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("pitches").insert({
      user_id: user.id,
      lead_id: lead.id,
      subject: subject || null,
      body: body || null,
    });
    if (!error && lead.status === "new") {
      await supabase.from("leads").update({ status: "drafted" }).eq("id", lead.id);
    }
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pitch saved" });
    onSaved?.();
    // refresh pitch list
    const { data: pts } = await supabase
      .from("pitches")
      .select("id,subject,body,created_at,sent_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });
    setPitches((pts as Pitch[]) ?? []);
  };

  const copyToClipboard = async () => {
    const text = `Subject: ${subject}\n\n${body}`;
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const refreshPitches = async () => {
    if (!lead) return;
    const { data: pts } = await supabase
      .from("pitches")
      .select("id,subject,body,created_at,sent_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false });
    setPitches((pts as Pitch[]) ?? []);
  };

  const copyPitch = async (p: Pitch) => {
    await navigator.clipboard.writeText(`Subject: ${p.subject ?? ""}\n\n${p.body ?? ""}`);
    toast({ title: "Copied to clipboard" });
  };

  const loadIntoEditor = (p: Pitch) => {
    setSubject(p.subject ?? "");
    setBody(p.body ?? "");
    toast({ title: "Loaded into editor", description: "Edit and Save to create a new version." });
  };

  const startEdit = (p: Pitch) => {
    setEditingId(p.id);
    setEditSubject(p.subject ?? "");
    setEditBody(p.body ?? "");
    setRevisingId(null);
    setExpandedId(p.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSubject("");
    setEditBody("");
  };

  const saveEdit = async (p: Pitch) => {
    setSavingEdit(true);
    const { error } = await supabase
      .from("pitches")
      .update({ subject: editSubject || null, body: editBody || null })
      .eq("id", p.id);
    setSavingEdit(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pitch updated" });
    cancelEdit();
    await refreshPitches();
  };

  const deletePitch = async (p: Pitch) => {
    if (!confirm("Delete this pitch? This cannot be undone.")) return;
    const { error } = await supabase.from("pitches").delete().eq("id", p.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Pitch deleted" });
    if (expandedId === p.id) setExpandedId(null);
    if (editingId === p.id) cancelEdit();
    await refreshPitches();
  };

  const startRevise = (p: Pitch) => {
    setRevisingId(p.id);
    setReviseInstructions("");
    setEditingId(null);
    setExpandedId(p.id);
  };

  const runRevise = async (p: Pitch) => {
    if (!lead) return;
    if (!reviseInstructions.trim()) {
      toast({ title: "Add instructions", description: "Tell the AI what to change.", variant: "destructive" });
      return;
    }
    setRevising(true);
    try {
      const { data, error } = await supabase.functions.invoke("draft-pitch", {
        body: {
          leadId: lead.id,
          templateId,
          tone,
          basePitch: { subject: p.subject, body: p.body },
          instructions: reviseInstructions,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const newSubject = (data as any).subject ?? "";
      const newBody = (data as any).body ?? "";
      // Overwrite this pitch with the revised version
      const { error: upErr } = await supabase
        .from("pitches")
        .update({ subject: newSubject, body: newBody })
        .eq("id", p.id);
      if (upErr) throw upErr;
      toast({ title: "Pitch revised" });
      setRevisingId(null);
      setReviseInstructions("");
      await refreshPitches();
    } catch (e: any) {
      toast({ title: "Revise failed", description: e?.message ?? "AI revision failed.", variant: "destructive" });
    } finally {
      setRevising(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Draft pitch{lead ? ` — ${lead.business_name}` : ""}</SheetTitle>
          <SheetDescription>
            AI uses this lead's data + linked offering to write a personalized cold email.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Template (optional)</Label>
              <Select value={templateId ?? "none"} onValueChange={(v) => setTemplateId(v === "none" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleDraft} disabled={drafting} className="w-full">
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {drafting ? "Drafting…" : subject || body ? "Re-draft with AI" : "Draft with AI"}
          </Button>

          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="AI-generated subject will appear here" />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder="AI-generated body will appear here" />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save pitch
            </Button>
            <Button variant="outline" onClick={copyToClipboard} disabled={!subject && !body}>
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>

          {pitches.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h3 className="text-sm font-semibold">Pitch history ({pitches.length})</h3>
              <div className="space-y-2">
                {pitches.map((p) => (
                  <div key={p.id} className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium">{p.subject || "(no subject)"}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
                      {p.body || "(empty)"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
