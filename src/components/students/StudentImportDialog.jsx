import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { appClient } from "@/api/appClient";
import { Loader2, UploadCloud, Download } from "lucide-react";

const SCHEMA = {
  type: "object",
  properties: {
    students: {
      type: "array",
      items: {
        type: "object",
        properties: {
          full_name: { type: "string" },
          admission_number: { type: "string" },
          roll_number: { type: "string" },
          class_name: { type: "string" },
          section: { type: "string" },
          gender: { type: "string" },
          student_email: { type: "string" },
          student_phone: { type: "string" },
          parent_name: { type: "string" },
          parent_email: { type: "string" },
          parent_phone: { type: "string" },
        },
      },
    },
  },
};

const TEMPLATE_HEADERS = [
  "full_name", "admission_number", "roll_number", "class_name", "section", "gender",
  "student_email", "student_phone", "parent_name", "parent_email", "parent_phone",
];

const norm = (v) => String(v || "").trim().toLowerCase();

// Match an incoming row against an existing student:
// 1) admission number, 2) roll number + class, 3) full name + class + section
const findMatch = (row, existing) =>
  existing.find(
    (s) =>
      (row.admission_number && norm(s.admission_number) === norm(row.admission_number)) ||
      (row.roll_number && row.class_name && norm(s.roll_number) === norm(row.roll_number) && norm(s.class_name) === norm(row.class_name) && norm(s.section || "") === norm(row.section || "")) ||
      (row.full_name && row.class_name && row.section && norm(s.full_name) === norm(row.full_name) && norm(s.class_name) === norm(row.class_name) && norm(s.section) === norm(row.section))
  );

const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const downloadSampleTemplate = () => {
  const rows = TEMPLATE_HEADERS.map((h) => escapeCsv(h)).join(",");
  const example = [
    ["Aarav Sharma", "ADM-1001", "1", "Class 6", "A", "male", "aarav.sharma@example.com", "9811000001", "Rohit Sharma", "rohit.sharma@example.com", "9811000002"],
    ["Priya Verma", "ADM-1002", "2", "Class 11", "Sci-Math-A", "female", "priya.verma@example.com", "9811000003", "Sunitra Verma", "sunitra.verma@example.com", "9811000004"],
  ].map((r) => r.map(escapeCsv).join(","));
  const csv = [rows, ...example].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "student-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
};

export default function StudentImportDialog({ open, onOpenChange, tenantId, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { file_url } = await appClient.integrations.Core.UploadFile({ file, purpose: "import", tenant_id: tenantId });
      const extraction = await appClient.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema: SCHEMA });
      if (extraction.status !== "success") throw new Error(extraction.details || "Extraction failed");
      const rows = (extraction.output?.students || [])
        .filter((s) => s.full_name)
        .map((s) => ({ ...s, tenant_id: tenantId, status: "active" }));
      if (rows.length === 0) throw new Error("No student rows found in file");

      // Match against existing students: update matches, create only new ones (no duplicates)
      const existing = await appClient.entities.Student.filter({ tenant_id: tenantId });
      const toUpdate = [];
      const toCreate = [];
      for (const row of rows) {
        const match = findMatch(row, existing) || findMatch(row, toCreate.map((r, i) => ({ ...r, id: `new-${i}` })));
        if (match && match.id && !String(match.id).startsWith("new-")) {
          toUpdate.push({ id: match.id, ...row });
        } else if (!match) {
          toCreate.push(row);
        }
        // rows duplicated within the file itself are skipped
      }

      const credentialRows = [];
      let syncWarnings = [];
      let defaultPassword = "";

      const pushProvisioned = (prov, fallbackName = "") => {
        const reused = new Set(prov?.reused || []);
        if (prov?.student?.email) {
          credentialRows.push({
            type: "student",
            name: prov.student.full_name || fallbackName,
            email: prov.student.email,
            reused: reused.has(prov.student.email),
          });
        }
        if (prov?.parent?.email) {
          credentialRows.push({
            type: "parent",
            name: prov.parent.full_name || "",
            email: prov.parent.email,
            reused: reused.has(prov.parent.email),
          });
        }
        if (prov?.default_password && !defaultPassword) defaultPassword = prov.default_password;
      };

      if (toUpdate.length > 0) {
        const res = await appClient.entities.Student.bulkUpdate(toUpdate);
        if (res?.syncWarnings?.length) syncWarnings = syncWarnings.concat(res.syncWarnings);
        const provisionedByStudent = res?.provisioned || {};
        for (const [studentId, prov] of Object.entries(provisionedByStudent)) {
          const matched = existing.find((s) => s.id === studentId) || toUpdate.find((r) => r.id === studentId);
          pushProvisioned(prov, matched?.full_name || "");
        }
      }

      if (toCreate.length > 0) {
        const createdItems = await appClient.entities.Student.bulkCreate(toCreate);
        for (const item of createdItems) {
          if (item?._syncWarnings?.length) syncWarnings = syncWarnings.concat(item._syncWarnings);
          pushProvisioned(item?._provisioned, item.full_name || "");
        }
      }

      onImported({ created: toCreate.length, updated: toUpdate.length, credentialRows, defaultPassword, syncWarnings });
      onOpenChange(false);
      setFile(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Import Students</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-stone-500">Upload an Excel or CSV file with student records (name, admission/roll number, class, section, student & parent email/phone). Existing students (matched by admission number, roll number or name+class) are updated instead of duplicated. Portal logins are auto-created for new students and parents with an email — every new login uses the institution default password, which users must change on first sign-in.</p>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-stone-200 rounded-lg p-2"
            />
            <Button variant="outline" size="sm" className="text-xs shrink-0" onClick={downloadSampleTemplate}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Sample
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleImport} disabled={!file || busy}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}