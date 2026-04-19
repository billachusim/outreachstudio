import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Inbox as InboxIcon } from "lucide-react";

const Inbox = () => {
  useEffect(() => { document.title = "Inbox · Outreach Studio"; }, []);
  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Replies and delivery events. Activates when sending is wired up.</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <InboxIcon className="h-8 w-8" />
          <p>No messages yet.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Inbox;
