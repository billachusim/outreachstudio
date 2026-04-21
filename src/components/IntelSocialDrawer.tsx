import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Sparkles, Copy, Send, Loader2 } from "lucide-react";

type Platform = "x" | "linkedin" | "instagram";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  intelItemId: string | null;
  intelTitle?: string;
}

const POST_FN: Record<Platform, string | null> = {
  x: "post-x",
  instagram: "post-instagram",
  linkedin: null,
};

const EMPTY = { x: "", linkedin: "", instagram: "" };

export const IntelSocialDrawer = ({ open, onOpenChange, intelItemId, intelTitle }: Props) => {
  const [platform, setPlatform] = useState<Platform>("x");
  const [bodies, setBodies] = useState<Record<Platform, string>>(EMPTY);
  const [cached, setCached] = useState<Record<Platform, boolean>>({ x: false, linkedin: false, instagram: false });
  const [draftIds, setDraftIds] = useState<Record<Platform, string | null>>({ x: null, linkedin: null, instagram: null });
  const [drafting, setDrafting] = useState<Platform | null>(null);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(false);

  // Pre-load cached drafts when drawer opens — zero AI calls
  useEffect(() => {
    if (!open || !intelItemId) {
      setBodies(EMPTY);
      setCached({ x: false, linkedin: false, instagram: false });
      setDraftIds({ x: null, linkedin: null, instagram: null });
      setPlatform("x");
      return;
    }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("social_drafts")
        .select("id, platform, body")
        .eq("intel_item_id", intelItemId);
      const newBodies = { ...EMPTY };
      const newCached = { x: false, linkedin: false, instagram: false };
      const newIds: Record<Platform, string | null> = { x: null, linkedin: null, instagram: null };
      for (const row of data ?? []) {
        const p = row.platform as Platform;
        if (p in newBodies) {
          newBodies[p] = row.body;
          newCached[p] = true;
          newIds[p] = row.id;
        }
      }
      setBodies(newBodies);
      setCached(newCached);
      setDraftIds(newIds);
      setLoading(false);
    })();
  }, [open, intelItemId]);

  const draft = async (p: Platform) => {
    if (!intelItemId) return;
    setDrafting(p);
    const { data, error } = await supabase.functions.invoke("draft-social-from-intel", {
      body: { intelItemId, platform: p, force: cached[p] }, // force re-draft only when explicitly clicking Re-draft
    });
    setDrafting(null);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    const id = (data as any)?.id;
    if (!id) return;
    const { data: row } = await supabase.from("social_drafts").select("body").eq("id", id).maybeSingle();
    if (row?.body) {
      setBodies((b) => ({ ...b, [p]: row.body }));
      setCached((c) => ({ ...c, [p]: true }));
      setDraftIds((d) => ({ ...d, [p]: id }));
      toast.success((data as any)?.cached ? `${p.toUpperCase()} draft loaded from cache` : `${p.toUpperCase()} draft ready`);
    }
  };

  const copy = async () => {
    const text = bodies[platform];
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const post = async () => {
    const text = bodies[platform];
    if (!text) return toast.error("Draft a post first");
    const fn = POST_FN[platform];
    if (!fn) return toast.error("LinkedIn auto-post not yet supported. Copy & paste for now.");
    setPosting(true);
    const { data, error } = await supabase.functions.invoke(fn, { body: { text } });
    setPosting(false);
    if (error) return toast.error(error.message);
    if ((data as any)?.error) return toast.error((data as any).error);
    toast.success("Posted");
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <div className="mx-auto w-full max-w-2xl overflow-y-auto px-4">
          <DrawerHeader className="px-0">
            <DrawerTitle>Draft social post from intel</DrawerTitle>
            <DrawerDescription className="line-clamp-2">{intelTitle}</DrawerDescription>
          </DrawerHeader>

          <Tabs value={platform} onValueChange={(v) => setPlatform(v as Platform)} className="pb-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="x" className="gap-1.5">
                X {cached.x && <Badge variant="secondary" className="text-[9px] px-1 h-4">Cached</Badge>}
              </TabsTrigger>
              <TabsTrigger value="linkedin" className="gap-1.5">
                LinkedIn {cached.linkedin && <Badge variant="secondary" className="text-[9px] px-1 h-4">Cached</Badge>}
              </TabsTrigger>
              <TabsTrigger value="instagram" className="gap-1.5">
                Instagram {cached.instagram && <Badge variant="secondary" className="text-[9px] px-1 h-4">Cached</Badge>}
              </TabsTrigger>
            </TabsList>

            {(["x", "linkedin", "instagram"] as Platform[]).map((p) => (
              <TabsContent key={p} value={p} className="space-y-3 pt-4">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => draft(p)} disabled={drafting === p || loading} className="w-full gap-2">
                        {drafting === p ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {drafting === p
                          ? "Drafting…"
                          : cached[p]
                            ? `Re-draft ${p.toUpperCase()} post`
                            : `Draft ${p.toUpperCase()} post`}
                        <Badge variant="outline" className="text-[9px] px-1 h-4 ml-1">AI</Badge>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Uses 1 AI call</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                    Post
                    {cached[p] && !drafting && <Badge variant="secondary" className="text-[9px] px-1 h-4">Cached</Badge>}
                  </Label>
                  <Textarea
                    value={bodies[p]}
                    onChange={(e) => setBodies((b) => ({ ...b, [p]: e.target.value }))}
                    rows={p === "x" ? 6 : 12}
                    placeholder={loading ? "Loading cached drafts…" : `Click "Draft ${p.toUpperCase()} post" to generate with AI`}
                  />
                  {p === "x" && bodies.x && (
                    <p className="text-xs text-muted-foreground text-right">{bodies.x.length} / 280</p>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <DrawerFooter className="px-0 flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={copy} disabled={!bodies[platform]}>
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button className="flex-1" onClick={post} disabled={posting || !bodies[platform]}>
              {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Auto-post
            </Button>
          </DrawerFooter>
          <Button variant="ghost" className="w-full mb-2" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
