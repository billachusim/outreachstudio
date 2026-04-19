import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { seedOfferingsIfEmpty } from "@/lib/seedOfferings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, RefreshCw, Trash2, Rocket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { startOutreachFromOffering } from "@/lib/startOutreach";
import { useNavigate } from "react-router-dom";

type Offering = {
  id: string;
  title: string;
  tagline: string | null;
  target_audience: string | null;
  problem_solved: string | null;
  pricing: string | null;
  demo_url: string | null;
  testimonial: string | null;
  ideal_customer: string | null;
  status: string;
};

const empty: Partial<Offering> = {
  title: "",
  tagline: "",
  target_audience: "",
  problem_solved: "",
  pricing: "",
  demo_url: "",
  testimonial: "",
  ideal_customer: "",
};

const Offerings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Offering>>(empty);
  const [starting, setStarting] = useState<string | null>(null);

  const handleStart = async (o: Offering) => {
    if (!user) return;
    setStarting(o.id);
    try {
      await startOutreachFromOffering({ userId: user.id, offeringId: o.id, offeringTitle: o.title });
      toast({ title: "Outreach started", description: "Engine is finding leads now. Check Studio for progress." });
      navigate("/");
    } catch (e: any) {
      toast({ title: "Could not start", description: e?.message ?? "Try again", variant: "destructive" });
    } finally {
      setStarting(null);
    }
  };

  useEffect(() => {
    document.title = "Offerings · Outreach Studio";
  }, []);

  const load = async () => {
    if (!user) return;
    await seedOfferingsIfEmpty(user.id);
    const { data, error } = await supabase
      .from("offerings")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    else setOfferings(data as Offering[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSave = async () => {
    if (!user || !draft.title?.trim()) return;
    const payload = { ...draft, user_id: user.id, status: draft.status ?? "active" };
    const { error } = draft.id
      ? await supabase.from("offerings").update(payload).eq("id", draft.id)
      : await supabase.from("offerings").insert(payload as never);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    setOpen(false);
    setDraft(empty);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this offering?")) return;
    const { error } = await supabase.from("offerings").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    load();
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Offerings</h1>
          <p className="text-sm text-muted-foreground">Your products, services and skills you pitch to leads.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              if (!user) return;
              if (!confirm("Refresh the built-in offerings (2nd Baze Garden, Tech Faculty, RetailOS, Free Landing Pages) to their latest defaults? This overwrites your edits to those rows.")) return;
              await seedOfferingsIfEmpty(user.id, true);
              toast({ title: "Defaults refreshed" });
              load();
            }}
          >
            <RefreshCw className="h-4 w-4" /> Refresh defaults
          </Button>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDraft(empty); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setDraft(empty)}>
              <Plus className="h-4 w-4" /> New offering
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{draft.id ? "Edit offering" : "New offering"}</DialogTitle>
              <DialogDescription>Describe what you're selling clearly — this fuels every pitch.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <Field label="Title">
                <Input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="Tagline">
                <Input value={draft.tagline ?? ""} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Target audience">
                  <Input value={draft.target_audience ?? ""} onChange={(e) => setDraft({ ...draft, target_audience: e.target.value })} />
                </Field>
                <Field label="Pricing">
                  <Input value={draft.pricing ?? ""} onChange={(e) => setDraft({ ...draft, pricing: e.target.value })} />
                </Field>
              </div>
              <Field label="Problem solved">
                <Textarea rows={3} value={draft.problem_solved ?? ""} onChange={(e) => setDraft({ ...draft, problem_solved: e.target.value })} />
              </Field>
              <Field label="Ideal customer">
                <Textarea rows={2} value={draft.ideal_customer ?? ""} onChange={(e) => setDraft({ ...draft, ideal_customer: e.target.value })} />
              </Field>
              <Field label="Demo URL">
                <Input value={draft.demo_url ?? ""} onChange={(e) => setDraft({ ...draft, demo_url: e.target.value })} />
              </Field>
              <Field label="Testimonial">
                <Textarea rows={2} value={draft.testimonial ?? ""} onChange={(e) => setDraft({ ...draft, testimonial: e.target.value })} />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>Save offering</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : offerings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No offerings yet. Create your first one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {offerings.map((o) => (
            <Card key={o.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">{o.title}</CardTitle>
                  <Badge variant="secondary" className="capitalize">{o.status}</Badge>
                </div>
                {o.tagline && <p className="text-sm text-muted-foreground">{o.tagline}</p>}
              </CardHeader>
              <CardContent className="flex-1 space-y-3 text-sm">
                {o.target_audience && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Audience</p>
                    <p>{o.target_audience}</p>
                  </div>
                )}
                {o.problem_solved && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Problem</p>
                    <p className="line-clamp-3">{o.problem_solved}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => handleStart(o)} disabled={starting === o.id}>
                    <Rocket className="h-3.5 w-3.5" />
                    {starting === o.id ? "Starting…" : "Start Outreach"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setDraft(o); setOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(o.id)}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
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

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
    {children}
  </div>
);

export default Offerings;
