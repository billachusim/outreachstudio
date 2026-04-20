import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, FileText, Trash2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Template = {
  id: string;
  name: string;
  subject: string | null;
  body: string | null;
};

const Templates = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Partial<Template>>({ name: "", subject: "", body: "" });

  useEffect(() => { document.title = "Templates · Outreach Studio"; }, []);

  const load = async () => {
    const { data } = await supabase.from("templates").select("*").order("created_at", { ascending: false });
    setTemplates((data as Template[]) ?? []);
  };

  useEffect(() => { if (user) load(); }, [user?.id]);

  const openCreate = () => {
    setEditing(null);
    setDraft({ name: "", subject: "", body: "" });
    setOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setDraft({ name: t.name, subject: t.subject ?? "", body: t.body ?? "" });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!user || !draft.name?.trim()) return;
    if (editing) {
      const { error } = await supabase
        .from("templates")
        .update({ name: draft.name, subject: draft.subject ?? null, body: draft.body ?? null })
        .eq("id", editing.id);
      if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      const { error } = await supabase.from("templates").insert({
        user_id: user.id,
        name: draft.name,
        subject: draft.subject ?? null,
        body: draft.body ?? null,
      });
      if (error) return toast({ title: "Create failed", description: error.message, variant: "destructive" });
    }
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    load();
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Templates</h1>
          <p className="text-sm text-muted-foreground">Tone & style references the AI uses when drafting pitches.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="h-4 w-4" /> New template</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit template" : "New template"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Friendly first-touch" />
              </div>
              <div className="space-y-1.5">
                <Label>Subject (sample)</Label>
                <Input value={draft.subject ?? ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Body (sample)</Label>
                <Textarea rows={10} value={draft.body ?? ""} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Hi {{name}}, ..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>{editing ? "Save changes" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p>No templates yet. Add one to guide the AI's tone when drafting pitches.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{t.name}</CardTitle>
                {t.subject && <p className="text-xs text-muted-foreground">Subject: {t.subject}</p>}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-3">
                <p className="line-clamp-5 whitespace-pre-wrap text-sm text-muted-foreground">
                  {t.body || "(no body)"}
                </p>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Templates;
