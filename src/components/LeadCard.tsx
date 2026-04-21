import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Phone, Linkedin, Instagram, Facebook, Twitter, Globe } from "lucide-react";
import type { LeadDetail } from "./LeadDetailDrawer";

interface Props {
  lead: LeadDetail;
  selected: boolean;
  onSelect: () => void;
  onClick: () => void;
}

export const LeadCard = ({ lead, selected, onClick }: Props) => {
  const score = lead.score ?? 0;
  const scoreColor =
    score >= 70 ? "text-success border-success/40 bg-success/10" :
    score >= 40 ? "text-primary border-primary/40 bg-primary/10" :
    "text-muted-foreground border-border bg-muted";

  const initial = lead.business_name.charAt(0).toUpperCase();

  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer p-4 transition hover:border-primary/40 hover:shadow-sm ${selected ? "border-primary" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{lead.business_name}</div>
              {lead.contact_name && (
                <div className="truncate text-xs text-muted-foreground">{lead.contact_name}</div>
              )}
            </div>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${scoreColor}`}>
              {score}
            </div>
          </div>
          {lead.enrichment_summary && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{lead.enrichment_summary}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {lead.contact_email && <Mail className="h-3.5 w-3.5 text-success" />}
            {lead.phone && <Phone className="h-3.5 w-3.5 text-success" />}
            {lead.website && <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
            {lead.linkedin_url && <Linkedin className="h-3.5 w-3.5 text-muted-foreground" />}
            {lead.instagram_url && <Instagram className="h-3.5 w-3.5 text-muted-foreground" />}
            {lead.facebook_url && <Facebook className="h-3.5 w-3.5 text-muted-foreground" />}
            {lead.x_url && <Twitter className="h-3.5 w-3.5 text-muted-foreground" />}
            <Badge variant="outline" className="ml-auto capitalize text-[10px]">{lead.status}</Badge>
          </div>
        </div>
      </div>
    </Card>
  );
};
