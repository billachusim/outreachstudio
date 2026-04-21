import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, MessageSquare, Share2, Users, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { title: "Studio", url: "/", icon: LayoutDashboard },
  { title: "Agent", url: "/chat", icon: MessageSquare },
  { title: "Social", url: "/social", icon: Share2 },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Inbox", url: "/inbox", icon: Inbox },
];

export const MobileTabBar = () => {
  const location = useLocation();

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-16 shrink-0 items-center justify-around border-t border-border bg-card/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        const active =
          tab.url === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(tab.url);
        return (
          <NavLink
            key={tab.url}
            to={tab.url}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
            <span className="leading-none">{tab.title}</span>
          </NavLink>
        );
      })}
    </nav>
  );
};
