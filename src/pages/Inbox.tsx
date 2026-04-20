import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Inbox as InboxIcon, Mail, Loader2 } from "lucide-react";

type SentRow = {
  id: string;
  subject: string | null;
  sent_at: string;
  lead: { id: string; business_name: string; contact_email: string | null } | null;
};

const Inbox = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<SentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = "Inbox · Outreach Studio"; }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("pitches")
        .select("id, subject, sent_at, lead:leads(id, business_name, contact_email)")
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(200);
      setRows((data as unknown as SentRow[]) ?? []);
      setLoading(false);
    })();
  }, [user?.id]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Inbox</h1>
        <p className="text-sm text-muted-foreground">Pitches you've sent. Reply tracking comes next.</p>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <InboxIcon className="h-8 w-8" />
            <p>No pitches sent yet.</p>
            <p className="text-xs">Draft a pitch on a lead, then click Send.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.sent_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <div>
                        {r.lead ? (
                          <Link to="/leads" className="font-medium hover:underline">
                            {r.lead.business_name}
                          </Link>
                        ) : (
                          <span className="font-medium">(deleted lead)</span>
                        )}
                        {r.lead?.contact_email && (
                          <div className="text-xs text-muted-foreground">{r.lead.contact_email}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{r.subject || "(no subject)"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
};

export default Inbox;
