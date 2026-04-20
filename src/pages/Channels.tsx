import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Radio, MessageCircle, Twitter, Facebook, Instagram, ExternalLink } from "lucide-react";

type Channel = "whatsapp" | "x" | "facebook" | "instagram";

type Account = {
  id: string;
  channel: Channel;
  display_name: string;
  external_id: string | null;
  status: string;
  credentials: Record<string, string>;
  created_at: string;
};

const CHANNEL_META: Record<Channel, { label: string; icon: typeof Radio; fields: { key: string; label: string; placeholder: string; secret?: boolean }[]; help: string }> = {
  whatsapp: {
    label: "WhatsApp (Meta Cloud API)",
    icon: MessageCircle,
    fields: [
      { key: "phone_number_id", label: "Phone number ID", placeholder: "123456789012345" },
      { key: "access_token", label: "Permanent access token", placeholder: "EAAG...", secret: true },
    ],
    help: "Create a Meta Business app → add WhatsApp product → copy the Phone Number ID and a permanent System User access token. After connecting, point the webhook to /functions/v1/whatsapp-webhook with your verify token.",
  },
  x: {
    label: "X (Twitter)",
    icon: Twitter,
    fields: [
      { key: "consumer_key", label: "API Key", placeholder: "consumer key" },
      { key: "consumer_secret", label: "API Secret", placeholder: "consumer secret", secret: true },
      { key: "access_token", label: "Access Token", placeholder: "access token" },
      { key: "access_token_secret", label: "Access Token Secret", placeholder: "access token secret", secret: true },
    ],
    help: "Create an X developer app with Read+Write permissions, generate user-context OAuth1 keys, paste all four values. Display name = your @handle (no @).",
  },
  facebook: {
    label: "Facebook Page",
    icon: Facebook,
    fields: [
      { key: "page_id", label: "Page ID", placeholder: "1234567890" },
      { key: "page_access_token", label: "Page access token", placeholder: "EAAG...", secret: true },
    ],
    help: "From Meta Graph API Explorer: pick your Page → grant pages_manage_posts + pages_read_engagement → exchange for a long-lived Page access token.",
  },
  instagram: {
    label: "Instagram Business",
    icon: Instagram,
    fields: [
      { key: "ig_user_id", label: "Instagram user ID", placeholder: "17841400000000000" },
      { key: "page_access_token", label: "Page access token", placeholder: "EAAG...", secret: true },
    ],
    help: "Connect an IG Business account to a Facebook Page. Use the Page access token (with instagram_basic + instagram_content_publish) and your IG user ID.",
  },
};

const Channels = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [displayName, setDisplayName] = useState("");
  const [externalId, setExternalId] = useState("");
  const [creds, setCreds] = useState<Record<string, string>>({});

  useEffect(() => { document.title = "Channels · Outreach Studio"; }, []);

  const load = async () => {
    const { data } = await supabase.from("channel_accounts").select("*").order("created_at", { ascending: false });
    setAccounts((data as Account[]) ?? []);
  };
  useEffect(() => { if (user) load(); }, [user?.id]);

  const reset = () => {
    setChannel("whatsapp"); setDisplayName(""); setExternalId(""); setCreds({});
  };

  const handleSave = async () => {
    if (!user || !displayName.trim()) return;
    const meta = CHANNEL_META[channel];
    for (const f of meta.fields) {
      if (!creds[f.key]?.trim()) {
        return toast({ title: "Missing field", description: `${f.label} is required`, variant: "destructive" });
      }
    }
    const { error } = await supabase.from("channel_accounts").insert({
      user_id: user.id, channel, display_name: displayName.trim(),
      external_id: externalId.trim() || null, credentials: creds, status: "active",
    } as never);
    if (error) return toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    toast({ title: "Connected", description: `${meta.label} added.` });
    setOpen(false); reset(); load();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("channel_accounts").delete().eq("id", id);
    if (error) return toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    load();
  };

  const handleToggle = async (a: Account) => {
    const next = a.status === "active" ? "paused" : "active";
    const { error } = await supabase.from("channel_accounts").update({ status: next } as never).eq("id", a.id);
    if (error) return toast({ title: "Update failed", description: error.message, variant: "destructive" });
    load();
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Connect WhatsApp, X, Facebook and Instagram so campaigns can reach leads outside email.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Connect channel</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader><DialogTitle>Connect a channel</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={channel} onValueChange={(v) => { setChannel(v as Channel); setCreds({}); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CHANNEL_META) as Channel[]).map((c) => (
                      <SelectItem key={c} value={c}>{CHANNEL_META[c].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{CHANNEL_META[channel].help}</p>
              </div>
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={channel === "x" ? "billachusim (no @)" : "Tech Faculty NG"} />
              </div>
              {CHANNEL_META[channel].fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label}</Label>
                  <Input
                    type={f.secret ? "password" : "text"}
                    value={creds[f.key] ?? ""}
                    onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                  />
                </div>
              ))}
              {channel === "whatsapp" && (
                <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
                  <p className="font-medium">Webhook setup</p>
                  <p className="text-muted-foreground break-all">URL: {webhookUrl}</p>
                  <p className="text-muted-foreground">Verify token: set the <code>WHATSAPP_VERIFY_TOKEN</code> secret (default <code>lovable-verify</code>) and use the same value in Meta.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>Connect</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Radio className="h-8 w-8" />
            <p>No channels connected yet. Add WhatsApp, X, Facebook or Instagram to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((a) => {
            const meta = CHANNEL_META[a.channel];
            const Icon = meta.icon;
            return (
              <Card key={a.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">{a.display_name}</CardTitle>
                    </div>
                    <Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{meta.label}</p>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleToggle(a)}>
                    {a.status === "active" ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(a.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ExternalLink className="h-4 w-4" /> Where to get credentials</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p><strong>WhatsApp:</strong> developers.facebook.com → My Apps → WhatsApp → API Setup. Use a System User token for permanent access.</p>
          <p><strong>X:</strong> developer.x.com → Projects & Apps. Set User authentication to Read+Write. Generate consumer keys + access tokens.</p>
          <p><strong>Facebook/Instagram:</strong> developers.facebook.com → Graph API Explorer. Select your Page, request the right scopes, then use debug_token to extend the access token.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Channels;
