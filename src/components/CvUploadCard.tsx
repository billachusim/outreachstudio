import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileUp, Loader2, Briefcase, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type Profile = {
  full_name?: string;
  headline?: string;
  years_experience?: number;
  primary_stack?: string[];
  availability?: string;
  rate?: string;
  location?: string;
};

export const CvUploadCard = () => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.storage.from("resumes").list(user.id, { limit: 1, sortBy: { column: "created_at", order: "desc" } });
    setExistingPath(data?.[0]?.name ? `${user.id}/${data[0].name}` : null);
    const { data: mem } = await supabase
      .from("agent_memories")
      .select("content")
      .eq("user_id", user.id)
      .eq("slug", "freelance-senior-engineer")
      .maybeSingle();
    if (mem?.content) {
      const c = mem.content;
      const grab = (label: string) => {
        const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`);
        const m = c.match(re);
        return m?.[1]?.trim();
      };
      setProfile({
        full_name: grab("Name"),
        headline: grab("Headline"),
        availability: grab("Availability"),
        rate: grab("Rate"),
        location: grab("Location / TZ"),
      });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const handleUpload = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      if (!["pdf", "docx", "doc", "txt"].includes(ext)) {
        throw new Error("Use PDF, DOCX, or TXT");
      }
      const path = `${user.id}/resume-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("resumes").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      toast.message("Parsing your CV…", { description: "This takes ~15s" });
      const { data, error } = await supabase.functions.invoke("ingest-cv", { body: { storagePath: path } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("CV parsed", { description: "Freelance profile + Freelance Jobs campaign ready." });
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Briefcase className="h-4 w-4" /> Freelance profile (CV)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload your CV. The agent will extract your skills, stack and trigger keywords, then auto-create a
          "Freelance Jobs" campaign that scans remote job boards every 3 hours.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {existingPath && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            CV on file: <span className="font-mono">{existingPath.split("/").pop()}</span>
          </div>
        )}
        {profile && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {profile.headline && <Badge variant="secondary">{profile.headline}</Badge>}
            {profile.availability && <Badge variant="outline">{profile.availability}</Badge>}
            {profile.rate && <Badge variant="outline">{profile.rate}</Badge>}
            {profile.location && <Badge variant="outline">{profile.location}</Badge>}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {busy ? "Working…" : existingPath ? "Replace CV" : "Upload CV"}
        </Button>
      </CardContent>
    </Card>
  );
};
