import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { seedOfferingsIfEmpty } from "@/lib/seedOfferings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Megaphone, Users, ArrowRight } from "lucide-react";

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({ offerings: 0, campaigns: 0, leads: 0 });

  useEffect(() => { document.title = "Outreach Studio"; }, []);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      await seedOfferingsIfEmpty(user.id);
      const [o, c, l] = await Promise.all([
        supabase.from("offerings").select("id", { count: "exact", head: true }),
        supabase.from("campaigns").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }),
      ]);
      setStats({ offerings: o.count ?? 0, campaigns: c.count ?? 0, leads: l.count ?? 0 });
    };
    load();
  }, [user?.id]);

  const tiles = [
    { label: "Offerings", count: stats.offerings, to: "/offerings", icon: Package },
    { label: "Campaigns", count: stats.campaigns, to: "/campaigns", icon: Megaphone },
    { label: "Leads", count: stats.leads, to: "/leads", icon: Users },
  ];

  return (
    <div className="container mx-auto max-w-6xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Your outreach command center.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to}>
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
                <t.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-semibold">{t.count}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Review your seeded offerings in <Link to="/offerings" className="text-primary hover:underline">Offerings</Link>.</p>
          <p>2. Create a campaign for one of them.</p>
          <p>3. Add leads manually for now — auto-discovery and AI drafting are in Phase 2.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
