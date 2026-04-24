

## Add Excel (.xlsx/.xls) Import Support to Leads Page

Extend the existing CSV import dialog to also accept Excel spreadsheet files. The current dialog only supports `.csv` via PapaParse — we'll add a parallel path that uses the `xlsx` (SheetJS) library to parse Excel files into the same row format, so all downstream logic (auto-mapping, preview, dedupe, insert) works unchanged.

### What Changes for the User
- The "Import leads" dialog now accepts **`.csv`, `.xlsx`, and `.xls`** files.
- Drop zone copy updates to: "CSV or Excel (.csv, .xlsx, .xls)".
- For multi-sheet Excel workbooks, a **sheet picker** appears so the user chooses which tab to import (defaults to the first sheet).
- Everything else (auto-mapping, preview, campaign assignment, dedupe, batched insert) stays identical.

### Technical Plan

1. **Add dependency**: install `xlsx` (SheetJS community build) for parsing `.xlsx` / `.xls`.

2. **Modify `src/components/ImportLeadsDialog.tsx`**:
   - Update file `<input accept>` to `.csv,.xlsx,.xls` plus the corresponding MIME types.
   - Add a `parseExcel(file)` helper that:
     - Reads the file as an ArrayBuffer.
     - Calls `XLSX.read(buf, { type: "array" })`.
     - Stores `sheetNames` in new state and defaults to the first sheet.
     - Converts the chosen sheet via `XLSX.utils.sheet_to_json(ws, { defval: "", raw: false })` so dates/numbers come through as readable strings (matching CSV behavior).
     - Feeds the resulting headers + rows into the existing `setHeaders` / `setRows` / auto-mapping flow.
   - Branch in `handleFile(file)` on extension/MIME: `.csv` → existing PapaParse path; `.xlsx`/`.xls` → `parseExcel`.
   - Add new state: `workbook`, `sheetNames`, `activeSheet`. When the user changes `activeSheet`, re-run the sheet→rows conversion and re-run auto-mapping.
   - Render a **Sheet selector** (`Select`) above the preview, only when `sheetNames.length > 1`.
   - Update the dropzone label to mention Excel support and show the file icon for either type.
   - Extend `reset()` to clear the new state.

3. **No changes needed** to: mapping logic, dedupe logic, insert payload, campaign assignment, or the Leads page itself — the dialog already returns parsed rows in a generic `Record<string, string>[]` shape.

### Edge Cases Handled
- Multi-sheet workbooks → sheet picker, re-parse on switch.
- Excel cells with numbers/dates → coerced to strings via `raw: false` so the trim/length checks behave like CSV.
- Empty rows → filtered out by the existing `r.business_name && r.business_name.length > 0` guard.
- File >20 MB → not applicable; import is client-side, but we'll keep PapaParse behavior (no extra size guard added).

### Files Touched
- `package.json` (add `xlsx`)
- `src/components/ImportLeadsDialog.tsx` (parsing branch + sheet picker)

