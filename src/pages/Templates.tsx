import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";

const Templates = () => {
  useEffect(() => { document.title = "Templates · Outreach Studio"; }, []);
  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Templates</h1>
        <p className="text-sm text-muted-foreground">Reusable pitch templates. Coming with AI drafting in Phase 2.</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <FileText className="h-8 w-8" />
          <p>Template editor will appear here once AI drafting is enabled.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Templates;
