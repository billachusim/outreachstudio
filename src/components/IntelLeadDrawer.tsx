import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  intelItemId: string | null;
  intelTitle?: string;
  intelUrl?: string | null;
  onCreated?: (leadId: string) => void;
}

export const IntelLeadDrawer = ({ open, onOpenChange, intelItemId, intelTitle, intelUrl, onCreated }: Props) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ leadId?: string; company?: string; website?: string; contactName?: string; reused?: boolean } | null>(null);

  const run = async () => {
    if (!intelItemId) return;
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("intel-to-lead", {
      body: { intelItemId },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    const r = data as any;
    if (r?.error) return toast.error(r.error);
    setResult(r);
    if (r?.reused) toast.info(`${r.company} already in your leads`);
    else toast.success(`Lead created: ${r.company}`);
    if (r?.leadId) onCreated?.(r.leadId);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md px-4">
          <DrawerHeader className="px-0">
            <DrawerTitle>Create lead from this story</DrawerTitle>
            <DrawerDescription className="line-clamp-2">{intelTitle}</DrawerDescription>
          </DrawerHeader>

          <div className="space-y-4 pb-4 text-sm">
            <p className="text-muted-foreground">
              I'll scrape the article, extract the company name, website, and any named contact, then add them as a lead under the matched offering's campaign.
            </p>
            {intelUrl && (
              <a href={intelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                <ExternalLink className="h-3 w-3" /> Source article
              </a>
            )}

            {result && (
              <div className="rounded-md border p-3 space-y-1">
                <p><span className="text-muted-foreground">Company:</span> <strong>{result.company}</strong></p>
                {result.website && <p><span className="text-muted-foreground">Website:</span> {result.website}</p>}
                {result.contactName && <p><span className="text-muted-foreground">Contact:</span> {result.contactName}</p>}
                {result.reused && <p className="text-xs text-amber-600">Linked to existing lead.</p>}
              </div>
            )}
          </div>

          <DrawerFooter className="px-0">
            {!result ? (
              <Button onClick={run} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                {loading ? "Scraping…" : "Create lead"}
              </Button>
            ) : (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
