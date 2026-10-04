import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import SheetSelect from "@/components/shared/SheetSelect";
import OMRReviewCard from "@/components/exams/OMRReviewCard";
import ExamDetailedReport from "@/components/portal/ExamDetailedReport";
import { useToast } from "@/components/ui/use-toast";
import { UploadCloud, Loader2, FolderUp, Camera, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Eye } from "lucide-react";
import CameraScanDialog from "@/components/exams/CameraScanDialog";
import OMRExtractionModal from "@/components/exams/OMRExtractionModal";
import { StatusBadge } from "@/lib/statusTokens";
import { isExamWorkflowRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import PlanChangeRequestDialog from "@/components/billing/PlanChangeRequestDialog";

export default function OMRUploadPanel({ examination, tenant, user }) {
  const { toast } = useToast();
  const [reportResult, setReportResult] = useState(null);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [plans, setPlans] = useState([]);
  const [students, setStudents] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [file, setFile] = useState(null);
  const [bulkFiles, setBulkFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total }
  const [reprocessingId, setReprocessingId] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [inspectSheet, setInspectSheet] = useState(null);
  const [rosterError, setRosterError] = useState("");

  // OMR scanning/processing/evaluation is the exam-coordinator workflow. A
  // teacher gets read-only access (roster + blank-sheet printing) so we never
  // render an upload control that would 403 on click. isExamWorkflowRole() is
  // the single shared definition (super_admin included) and now takes the USER
  // rather than a single role, so a teacher who is also an exam coordinator
  // correctly gets the upload control. It never reads the legacy `role` field,
  // which is "user" for every super_admin not bootstrapped from the environment.
  const canManageOMR = isExamWorkflowRole(user);

  const studentOptions = students.map((s) => ({ value: s.id, label: `${s.full_name} (${s.roll_number || "—"})` }));

  const load = async () => {
    const [rosterRes, sheetList] = await Promise.all([
      appClient.functions.invoke("getExamRoster", { examination_id: examination.id }),
      // Teachers have no OMRSheet read scope; only the roster matters to them.
      canManageOMR ? appClient.entities.OMRSheet.filter({ examination_id: examination.id }, "-created_date") : Promise.resolve([]),
    ]);
    setStudents((rosterRes.data?.students || []).map((s) => ({ ...s, id: s.student_id })));
    setSheets(sheetList);
  };

  useEffect(() => {
    // Surface the real reason (403 / 404 / network) instead of silently
    // rendering an empty student selector that looks like an empty roster.
    load()
      .then(() => setRosterError(""))
      .catch((e) => setRosterError(e?.message || "Could not load the exam roster."));
  }, [examination.id]);

  const createAndProcess = async (f, studentId) => {
    const { file_url } = await appClient.integrations.Core.UploadFile({ file: f, purpose: "omr" });
    const sheet = await appClient.entities.OMRSheet.create({
      tenant_id: examination.tenant_id,
      examination_id: examination.id,
      ...(studentId ? { student_id: studentId } : {}),
      paper_set: examination.paper_sets?.[0] || "A",
      image_url: file_url,
      status: "uploaded",
    });
    const { data } = await appClient.functions.invoke("processOMRSheet", { omr_sheet_id: sheet.id });
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // Automatically compute results after sheets are processed (only when an answer key exists)
  const autoEvaluate = async () => {
    const keys = await appClient.entities.AnswerKey.filter({ examination_id: examination.id });
    if (keys.length === 0) return false;
    const { data } = await appClient.functions.invoke("evaluateExamination", { examination_id: examination.id });
    return !data?.error;
  };

  // Plan limit: monthly OMR sheet quota for the institution
  const monthlyLimitOk = async (adding) => {
    const limit = tenant?.omr_sheet_limit_per_month;
    if (!limit) return true;
    const all = await appClient.entities.OMRSheet.filter({ tenant_id: examination.tenant_id });
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const used = all.filter((s) => new Date(s.created_date) >= monthStart).length;
    if (used + adding > limit) {
      toast({ title: "Monthly OMR limit reached", description: `Your plan allows ${limit} OMR sheets per month (${used} used).`, variant: "destructive" });
      // Open the request dialog rather than leaving the message with no action
      // attached, but only for a role that may actually raise one — an exam
      // coordinator hitting the limit is told to contact the administrator instead
      // of being shown a control the server would refuse.
      if (can(user, "submit_plan_change")) {
        setPlanDialogOpen(true);
        if (!plans.length) {
          appClient.entities.SubscriptionPlan.list()
            .then(setPlans)
            .catch(() => {});
        }
      }
      return false;
    }
    return true;
  };

  const processFiles = async (files) => {
    if (files.length === 0) return;
    if (!(await monthlyLimitOk(files.length))) return;
    setUploading(true);
    let matched = 0, unmatched = 0, failed = 0, totalFlagged = 0, readAnswers = 0;
    for (let i = 0; i < files.length; i++) {
      setBulkProgress({ done: i, total: files.length });
      try {
        const data = await createAndProcess(files[i], null);
        if (data?.matched) matched++;
        else unmatched++;
        totalFlagged += data?.flagged_count || 0;
        const sheetAnswers = data?.sheet?.extracted_answers || data?.sheet?.answers || {};
        if (Object.keys(sheetAnswers).length > 0) readAnswers++;
      } catch {
        failed++;
      }
    }
    setBulkProgress(null);
    setBulkFiles([]);
    // Only auto-evaluate when every uploaded sheet is confident AND at least one answer
    // was actually extracted. Sheets flagged for review (or blank sheets with zero reads)
    // are never auto-graded, preventing fabricated results from phantom reads.
    const evaluated = matched > 0 && totalFlagged === 0 && readAnswers > 0 ? await autoEvaluate().catch(() => false) : false;
    setUploading(false);
    toast({
      title: "Upload complete",
      description: `${matched} matched automatically${unmatched ? `, ${unmatched} need manual assignment` : ""}${failed ? `, ${failed} failed` : ""}${totalFlagged ? `. ${totalFlagged} questions flagged for review.` : "."}${evaluated ? " Results updated — see the Results tab." : ""}`,
    });
    load();
  };

  const handleBulkUpload = () => processFiles(bulkFiles);

  const handleUpload = async () => {
    if (!file || !selectedStudent) return;
    if (!(await monthlyLimitOk(1))) return;
    setUploading(true);
    try {
      const data = await createAndProcess(file, selectedStudent);
      const sheetAnswers = data?.sheet?.extracted_answers || data?.sheet?.answers || {};
      const confidentRead = data?.sheet?.status === "completed" && data?.flagged_count === 0 && Object.keys(sheetAnswers).length > 0;
      const evaluated = confidentRead ? await autoEvaluate().catch(() => false) : false;
      const flaggedInfo = data?.flagged_count ? ` ${data.flagged_count} questions flagged for review.` : "";
      const confInfo = data?.avg_confidence ? ` Avg confidence: ${(data.avg_confidence * 100).toFixed(0)}%.` : "";
      toast({
        title: "OMR sheet processed",
        description: data?.sheet?.status === "needs_review"
          ? `Some answers need manual review.${flaggedInfo}${confInfo}`
          : evaluated
            ? `All answers read — results updated in the Results tab.${confInfo}`
            : `All answers read successfully.${confInfo} Add the answer key and run evaluation to compute results.`,
      });
      setFile(null);
      setSelectedStudent("");
      load();
    } catch (e) {
      toast({ title: "Processing failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const assignStudent = async (sheet, studentId) => {
    await appClient.entities.OMRSheet.update(sheet.id, {
      student_id: studentId,
      status: sheet.flagged_questions?.length > 0 ? "needs_review" : "completed",
      error_message: "",
    });
    toast({ title: "Student assigned" });
    load();
  };

  const handleReprocess = async (sheetId) => {
    setReprocessingId(sheetId);
    try {
      const { data } = await appClient.functions.invoke("processOMRSheet", { omr_sheet_id: sheetId });
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Re-processed",
        description: `Confidence: ${data.avg_confidence ? (data.avg_confidence * 100).toFixed(0) : "—"}%. ${data.flagged_count || 0} questions flagged.`,
      });
      load();
    } catch (e) {
      toast({ title: "Re-processing failed", description: e.message, variant: "destructive" });
    } finally {
      setReprocessingId(null);
    }
  };

  const openReport = async (studentId) => {
    const rs = await appClient.entities.Result.filter({ examination_id: examination.id, student_id: studentId });
    if (rs.length === 0) {
      toast({ title: "No result yet", description: "Run evaluation in the Results tab first.", variant: "destructive" });
      return;
    }
    setReportResult(rs[0]);
  };

  const failedSheets = sheets.filter((s) => s.status === "failed" || s.processing_status === "failed");
  const needsReview = sheets.filter((s) => s.status === "needs_review" && s.student_id);
  const unmatchedSheets = sheets.filter((s) => !s.student_id && s.status !== "failed" && s.processing_status !== "failed");
  const others = sheets.filter((s) => s.status !== "needs_review" && s.status !== "failed" && s.processing_status !== "failed" && s.student_id);

  // Summary stats
  const totalCompleted = others.filter((s) => s.status === "completed").length;
  const totalReview = needsReview.length;
  const totalUnmatched = unmatchedSheets.length;
  const totalFailed = failedSheets.length;

  return (
    <div className="space-y-5">
      {rosterError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Could not load the exam roster</p>
              <p className="text-rose-700 mt-0.5">{rosterError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Teacher: read-only. Roster visibility + printing is the teacher's OMR
          surface; scanning/evaluation belongs to the coordinator. */}
      {!canManageOMR && (
        <div className="space-y-5">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
            <p className="font-medium text-stone-900">OMR Sheets</p>
            <p className="text-stone-600 mt-1">
              View your assigned student roster and print blank OMR sheets. Scanning and evaluation are
              handled by the examination coordinator.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h3 className="font-heading font-semibold text-stone-900 mb-1">
              Assigned Students ({students.length})
            </h3>
            <p className="text-xs text-stone-500 mb-3">
              These are the students on this exam's roster. Use &ldquo;Print OMR Sheets&rdquo; above to
              generate blank answer sheets for them.
            </p>
            {students.length === 0 && !rosterError ? (
              <p className="text-sm text-stone-400 py-4 text-center">
                No students on the exam roster for its class/section selection.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {students.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-stone-800">{s.full_name}</span>
                    <span className="text-xs text-stone-400">Roll {s.roll_number || "-"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {canManageOMR && (
      <>
      {/* Summary stats */}
      {sheets.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-emerald-800">{totalCompleted}</span>
            <span className="text-emerald-600">completed</span>
          </div>
          {totalReview > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="font-semibold text-amber-800">{totalReview}</span>
              <span className="text-amber-600">needs review</span>
            </div>
          )}
          {totalFailed > 0 && (
            <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
              <XCircle className="w-4 h-4 text-rose-600" />
              <span className="font-semibold text-rose-800">{totalFailed}</span>
              <span className="text-rose-600">failed</span>
            </div>
          )}
          {totalUnmatched > 0 && (
            <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
              <XCircle className="w-4 h-4 text-stone-500" />
              <span className="font-semibold text-stone-700">{totalUnmatched}</span>
              <span className="text-stone-500">unmatched</span>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Bulk upload */}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <h3 className="font-heading font-semibold text-stone-900 mb-1">Bulk Upload All Scanned Sheets</h3>
        <p className="text-xs text-stone-500 mb-3">Select all scanned sheets at once (JPEG/PNG/PDF). The software reads each sheet's printed name & roll number, matches it to the right student, and evaluates automatically.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setBulkFiles(Array.from(e.target.files || []))}
            className="flex-1 text-sm border border-stone-200 rounded-lg p-2"
          />
          <Button variant="outline" onClick={() => setScanOpen(true)} disabled={uploading}>
            <Camera className="w-4 h-4 mr-2" /> Scan with Camera
          </Button>
          <Button onClick={handleBulkUpload} disabled={bulkFiles.length === 0 || uploading}>
            {uploading && bulkProgress ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FolderUp className="w-4 h-4 mr-2" />}
            {bulkProgress ? `Processing ${bulkProgress.done + 1}/${bulkProgress.total}...` : `Upload ${bulkFiles.length || ""} Sheet${bulkFiles.length !== 1 ? "s" : ""} & Auto-Match`}
          </Button>
        </div>
      </div>

      {/* Single upload (manual fallback) */}
      <div className="bg-white rounded-xl border border-stone-200 p-5">
        <h3 className="font-heading font-semibold text-stone-900 mb-3">Upload for a Specific Student</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <SheetSelect value={selectedStudent} onValueChange={setSelectedStudent} placeholder="Select student" options={studentOptions} className="sm:w-56" />
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="flex-1 text-sm border border-stone-200 rounded-lg p-2"
          />
          <Button onClick={handleUpload} disabled={!file || !selectedStudent || uploading}>
            {uploading && !bulkProgress ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
            Upload & Process
          </Button>
        </div>
      </div>

      {/* Failed sheets needing review / re-scan */}
      {failedSheets.length > 0 && (
        <div className="bg-rose-50 rounded-xl border border-rose-200 p-5">
          <h3 className="font-heading font-semibold text-rose-800 mb-1">
            Failed Processing ({failedSheets.length})
          </h3>
          <p className="text-xs text-rose-700 mb-3">
            OMR could not be confidently processed. Please review the sheet and try again.
          </p>
          <div className="space-y-2">
            {failedSheets.map((s) => (
              <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white rounded-lg p-3 border border-rose-100">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded bg-rose-100 text-rose-700 mr-2">
                    {s.error_code || "PROCESSING_FAILED"}
                  </span>
                  <span className="text-xs text-stone-600">{s.error_details || "Alignment markers not detected or image quality insufficient."}</span>
                  {s.image_url && (
                    <div className="mt-1">
                      <a href={s.image_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-indigo-600 hover:underline">
                        View uploaded sheet
                      </a>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReprocess(s.id)}
                  disabled={reprocessingId === s.id}
                  className="text-xs shrink-0"
                >
                  {reprocessingId === s.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                  Retry
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {unmatchedSheets.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
          <h3 className="font-heading font-semibold text-amber-800 mb-3">Unmatched Sheets ({unmatchedSheets.length}) — assign the student manually</h3>
          <div className="space-y-2">
            {unmatchedSheets.map((s) => (
              <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white rounded-lg p-3 border border-amber-100">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => setInspectSheet(s)}
                    className="text-sm font-medium text-indigo-600 hover:underline flex items-center gap-1 text-left"
                  >
                    <Eye className="w-3.5 h-3.5" /> Inspect & Assign Sheet
                  </button>
                  {s.error_message && <p className="text-xs text-amber-700 mt-0.5">{s.error_message}</p>}
                </div>
                <SheetSelect onValueChange={(v) => assignStudent(s, v)} placeholder="Assign to student" options={studentOptions} className="sm:w-56" />
              </div>
            ))}
          </div>
        </div>
      )}

      {needsReview.length > 0 && (
        <div>
          <h3 className="font-heading font-semibold text-stone-900 mb-3">Needs Review ({needsReview.length})</h3>
          <div className="space-y-3">
            {needsReview.map((s) => (
              <OMRReviewCard
                key={s.id}
                sheet={s}
                examination={examination}
                studentName={students.find((st) => st.id === s.student_id)?.full_name}
                onReviewed={load}
                onInspect={(target) => setInspectSheet(target)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Paper Set</th>
              <th className="text-left px-4 py-3">Confidence</th>
              <th className="text-left px-4 py-3">Flagged</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3 w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {others.map((s) => {
              const confScores = s.confidence_scores || {};
              const confVals = Object.values(confScores);
              const avgConf = confVals.length > 0 ? confVals.reduce((a, b) => a + b, 0) / confVals.length : null;
              const flaggedCount = s.flagged_questions?.length || 0;
              return (
                <tr key={s.id} className="border-t border-stone-100">
                  <td className="px-4 py-3 font-medium">
                    <button onClick={() => openReport(s.student_id)} className="text-indigo-600 hover:underline">
                      {students.find((st) => st.id === s.student_id)?.full_name || "-"}
                    </button>
                    {s.annotated_image_url && (
                      <a
                        href={s.annotated_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-[11px] text-emerald-600 hover:underline mt-0.5"
                      >
                        View Verification Image
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-stone-500">{s.paper_set}</td>
                  <td className="px-4 py-3">
                    {avgConf != null ? (
                      <span className={`text-xs font-semibold tabular-nums ${avgConf >= 0.85 ? "text-emerald-600" : avgConf >= 0.70 ? "text-stone-600" : "text-amber-600"}`}>
                        {(avgConf * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {flaggedCount > 0 ? (
                      <span className="text-xs font-semibold text-amber-600">{flaggedCount}</span>
                    ) : (
                      <span className="text-xs text-stone-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={s.status} type="sheet" /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setInspectSheet(s)}
                        className="text-xs h-7 px-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                        title="Inspect and review answers"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" /> Review
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReprocess(s.id)}
                        disabled={reprocessingId === s.id}
                        title="Re-process this OMR sheet"
                        className="h-7 w-7 p-0"
                      >
                        {reprocessingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sheets.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-400">No OMR sheets uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CameraScanDialog open={scanOpen} onOpenChange={setScanOpen} onDone={processFiles} />

      <ExamDetailedReport
        open={!!reportResult}
        onOpenChange={(o) => !o && setReportResult(null)}
        result={reportResult}
        exam={examination}
        tenant={tenant}
      />

      {can(user, "submit_plan_change") && (
        <PlanChangeRequestDialog
          open={planDialogOpen}
          onOpenChange={setPlanDialogOpen}
          plans={plans}
          currentPlanId={tenant?.subscription_plan_id}
        />
      )}

      {inspectSheet && (
        <OMRExtractionModal
          sheet={inspectSheet}
          exam={examination}
          students={students}
          onClose={() => setInspectSheet(null)}
          onFinalized={() => {
            setInspectSheet(null);
            load();
          }}
        />
      )}
      </>
      )}
    </div>
  );
}