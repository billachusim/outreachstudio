import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Campaign = { id: string; name: string };

type Field = "business_name" | "contact_email" | "phone" | "website" | "contact_name" | "address" | "notes" | "skip";

const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "business_name", label: "Business name", required: true },
  { key: "contact_email", label: "Contact email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "contact_name", label: "Contact name" },
  { key: "address", label: "Address" },
  { key: "notes", label: "Notes" },
];

// Heuristic header → field mapping
function autoMap(header: string): Field {
  const h = header.toLowerCase().trim();
  if (/(^|[^a-z])(business|company|organi[sz]ation|name|account)([^a-z]|$)/.test(h) && !h.includes("contact") && !h.includes("first") && !h.includes("last")) return "business_name";
  if (/(e-?mail|mailto)/.test(h)) return "contact_email";
  if (/(phone|mobile|tel|whatsapp|cell)/.test(h)) return "phone";
  if (/(website|url|site|domain|web)/.test(h)) return "website";
  if (/(contact|owner|founder|first ?name|last ?name|full ?name|person)/.test(h)) return "contact_name";
  if (/(address|location|street|city)/.test(h)) return "address";
  if (/(notes?|description|about|summary|comment)/.test(h)) return "notes";
  return "skip";
}

function rootDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = url.trim();
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    return new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function applyAutoMapping(hs: string[]): Record<string, Field> {
  const m: Record<string, Field> = {};
  const used = new Set<Field>();
  hs.forEach((h) => {
    let f = autoMap(h);
    if (f !== "skip" && used.has(f)) f = "skip";
    m[h] = f;
    if (f !== "skip") used.add(f);
  });
  return m;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: Campaign[];
  onImported: () => void;
}

export const ImportLeadsDialog = ({ open, onOpenChange, campaigns, onImported }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, Field>>({});
  const [target, setTarget] = useState<"raw" | "campaign">("raw");
  const [campaignId, setCampaignId] = useState<string>("");
  const [dedupe, setDedupe] = useState(true);
  const [importing, setImporting] = useState(false);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");

  const reset = () => {
    setFileName(""); setHeaders([]); setRows([]); setMapping({});
    setTarget("raw"); setCampaignId(""); setDedupe(true); setImporting(false);
    setWorkbook(null); setSheetNames([]); setActiveSheet("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onClose = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
    // Headers from first row keys, but also use sheet header row in declared order
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
    const headerRow = (aoa[0] ?? []) as unknown[];
    const hs = headerRow.map((h) => (h ?? "").toString()).filter((h) => h.length > 0);
    setHeaders(hs);
    setRows(json);
    setMapping(applyAutoMapping(hs));
  };

  const parseExcel = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const names = wb.SheetNames;
    setWorkbook(wb);
    setSheetNames(names);
    const first = names[0] ?? "";
    setActiveSheet(first);
    if (first) loadSheet(wb, first);
  };

  const handleFile = (file: File) => {
    setFileName(file.name);
    setWorkbook(null); setSheetNames([]); setActiveSheet("");
    const name = file.name.toLowerCase();
    const isExcel = /\.(xlsx|xls)$/i.test(name) ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel";

    if (isExcel) {
      parseExcel(file).catch((err) =>
        toast({ title: "Excel parse error", description: err?.message ?? "Could not read file", variant: "destructive" }),
      );
      return;
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const hs = results.meta.fields ?? [];
        setHeaders(hs);
        setRows(results.data);
        setMapping(applyAutoMapping(hs));
      },
      error: (err) => toast({ title: "CSV parse error", description: err.message, variant: "destructive" }),
    });
  };

  const handleSheetChange = (sheet: string) => {
    setActiveSheet(sheet);
    if (workbook) loadSheet(workbook, sheet);
  };

  const businessHeader = useMemo(
    () => Object.entries(mapping).find(([, f]) => f === "business_name")?.[0],
    [mapping],
  );

  const handleImport = async () => {
    if (!user) return;
    if (!businessHeader) {
      return toast({ title: "Mapping required", description: "Map one column to Business name.", variant: "destructive" });
    }
    if (target === "campaign" && !campaignId) {
      return toast({ title: "Pick a campaign", description: "Or choose Raw leads.", variant: "destructive" });
    }
    setImporting(true);
    try {
      // Build records
      const records = rows
        .map((r) => {
          const rec: Record<string, string | null> = {};
          for (const [h, f] of Object.entries(mapping)) {
            if (f === "skip") continue;
            const v = (r[h] ?? "").toString().trim();
            rec[f] = v.length ? v : null;
          }
          return rec;
        })
        .filter((r) => r.business_name && r.business_name.length > 0);

      let skipped = 0;
      let toInsert = records;

      if (dedupe) {
        // Pull existing emails + root domains
        const { data: existing } = await supabase
          .from("leads")
          .select("contact_email, website")
          .eq("user_id", user.id);
        const existingEmails = new Set(
          (existing ?? []).map((l) => (l.contact_email ?? "").toLowerCase()).filter(Boolean),
        );
        const existingDomains = new Set(
          (existing ?? []).map((l) => rootDomain(l.website)).filter(Boolean) as string[],
        );

        const seenEmails = new Set<string>();
        const seenDomains = new Set<string>();
        toInsert = records.filter((r) => {
          const email = (r.contact_email ?? "").toLowerCase();
          const dom = rootDomain(r.website);
          if (email && (existingEmails.has(email) || seenEmails.has(email))) { skipped++; return false; }
          if (dom && (existingDomains.has(dom) || seenDomains.has(dom))) { skipped++; return false; }
          if (email) seenEmails.add(email);
          if (dom) seenDomains.add(dom);
          return true;
        });
      }

      const assignTo = target === "campaign" ? campaignId : null;
      const payload = toInsert.map((r) => ({
        user_id: user.id,
        campaign_id: assignTo,
        business_name: r.business_name!,
        contact_email: r.contact_email ?? null,
        phone: r.phone ?? null,
        website: r.website ?? null,
        contact_name: r.contact_name ?? null,
        address: r.address ?? null,
        notes: r.notes ?? null,
        status: "new" as const,
      }));

      // Batch in chunks of 100
      let inserted = 0;
      for (let i = 0; i < payload.length; i += 100) {
        const chunk = payload.slice(i, i + 100);
        const { error } = await supabase.from("leads").insert(chunk as never);
        if (error) throw error;
        inserted += chunk.length;
      }

      toast({
        title: `Imported ${inserted} lead${inserted === 1 ? "" : "s"}`,
        description: skipped ? `${skipped} skipped as duplicates.` : undefined,
      });
      onImported();
      onClose(false);
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const preview = rows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import leads from CSV or Excel</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* File picker */}
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 p-6 text-sm text-muted-foreground hover:bg-muted/50"
            >
              {fileName ? (
                <><FileSpreadsheet className="h-6 w-6 text-primary" /><span className="font-medium text-foreground">{fileName}</span><span className="text-xs">{rows.length} rows · click to change</span></>
              ) : (
                <><Upload className="h-6 w-6" /><span>Drop file or click to browse</span><span className="text-xs">CSV or Excel (.csv, .xlsx, .xls)</span></>
              )}
            </button>
          </div>

          {/* Sheet picker (Excel multi-sheet only) */}
          {sheetNames.length > 1 && (
            <div className="space-y-2">
              <Label>Sheet</Label>
              <Select value={activeSheet} onValueChange={handleSheetChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sheetNames.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {rows.length > 0 && (
            <>
              {/* Assign to */}
              <div className="space-y-2">
                <Label>Assign to</Label>
                <RadioGroup value={target} onValueChange={(v) => setTarget(v as any)}>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="raw" id="r-raw" />
                    <Label htmlFor="r-raw" className="cursor-pointer font-normal">📥 Raw leads (no campaign)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="campaign" id="r-camp" />
                    <Label htmlFor="r-camp" className="cursor-pointer font-normal">Specific campaign</Label>
                  </div>
                </RadioGroup>
                {target === "campaign" && (
                  <Select value={campaignId} onValueChange={setCampaignId}>
                    <SelectTrigger><SelectValue placeholder="Select campaign…" /></SelectTrigger>
                    <SelectContent>
                      {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <Label>Detected {rows.length} rows · Preview</Label>
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>{headers.map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-t">
                          {headers.map((h) => <td key={h} className="max-w-[160px] truncate px-2 py-1.5 text-muted-foreground">{r[h]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mapping */}
              <div className="space-y-2">
                <Label>Column mapping (auto-detected)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {headers.map((h) => (
                    <div key={h} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs text-muted-foreground">"{h}"</span>
                      <span className="text-xs">→</span>
                      <Select value={mapping[h] ?? "skip"} onValueChange={(v) => setMapping({ ...mapping, [h]: v as Field })}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">(skip)</SelectItem>
                          {FIELDS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {!businessHeader && (
                  <p className="text-xs text-destructive">Map at least one column to "Business name".</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="dedupe" checked={dedupe} onCheckedChange={(v) => setDedupe(!!v)} />
                <Label htmlFor="dedupe" className="cursor-pointer font-normal">Skip duplicates by email / website domain</Label>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={importing}>Cancel</Button>
          <Button onClick={handleImport} disabled={importing || rows.length === 0 || !businessHeader}>
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            Import {rows.length > 0 ? `${rows.length} lead${rows.length === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
