import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/statusTokens";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, PlayCircle, Send, ClipboardCheck } from "lucide-react";
import ExamDetailedReport from "@/components/portal/ExamDetailedReport";

export default function ResultsPanel({ examination, user, tenant, onExamUpdated }) {
  const { toast } = useToast();
  const [results, setResults] = useState([]);
  const [students, setStudents] = useState([]);
  const [evaluating, setEvaluating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [detailResult, setDetailResult] = useState(null);

  const load = async () => {
    const [resultList, studentList] = await Promise.all([
      appClient.entities.Result.filter({ examination_id: examination.id }, "rank"),
      appClient.entities.Student.filter({ tenant_id: examination.tenant_id }),
    ]);
    setResults(resultList);
    setStudents(studentList);
  };

  useEffect(() => { load(); }, [examination.id]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const { data } = await appClient.functions.invoke("evaluateExamination", { examination_id: examination.id });
      if (data?.error) throw new Error(data.error);
      await logAudit({ user, tenant_id: examination.tenant_id, action: "evaluate", entity_type: "Examination", entity_id: examination.id });
      toast({ title: "Evaluation complete", description: `${data.count} results computed.` });
      onExamUpdated();
      load();
    } catch (e) {
      toast({ title: "Evaluation failed", description: e.message, variant: "destructive" });
    } finally {
      setEvaluating(false);
    }
  };

  const handleMarkReviewed = async () => {
    setReviewing(true);
    try {
      const reviewedAt = new Date().toISOString();
      await Promise.all(
        results.filter((r) => r.status === "draft").map((r) =>
          appClient.entities.Result.update(r.id, { status: "reviewed", reviewed_by: user?.full_name || "", reviewed_at: reviewedAt })
        )
      );
      await appClient.entities.Examination.update(examination.id, { status: "reviewed" });
      await logAudit({ user, tenant_id: examination.tenant_id, action: "review_results", entity_type: "Examination", entity_id: examination.id });
      toast({ title: "Results reviewed", description: "Results are approved and ready to publish." });
      onExamUpdated();
      load();
    } finally {
      setReviewing(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const publishedAt = new Date().toISOString();
      await Promise.all(results.map((r) => appClient.entities.Result.update(r.id, { status: "published", published_at: publishedAt })));
      await appClient.entities.Examination.update(examination.id, { status: "published" });
      await logAudit({ user, tenant_id: examination.tenant_id, action: "publish_results", entity_type: "Examination", entity_id: examination.id });
      toast({ title: "Results published", description: "Students and parents can now view their results." });
      onExamUpdated();
      load();
    } finally {
      setPublishing(false);
    }
  };

  const studentName = (id) => students.find((s) => s.id === id)?.full_name || "-";
  const allPublished = results.length > 0 && results.every((r) => r.status === "published");
  const hasDraft = results.some((r) => r.status === "draft");
  const allReviewed = results.length > 0 && !hasDraft;
  const mayEvaluate = can(user, "evaluate_exam");
  const mayReview = can(user, "review_results");
  const mayPublish = can(user, "publish_results");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleEvaluate} disabled={evaluating || !mayEvaluate} title={!mayEvaluate ? "Your role can't run evaluation" : undefined}>
          {evaluating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
          Run Evaluation
        </Button>
        <Button variant="outline" onClick={handleMarkReviewed} disabled={reviewing || results.length === 0 || !hasDraft || !mayReview} title={!mayReview ? "Your role can't review results" : undefined}>
          {reviewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
          Mark as Reviewed
        </Button>
        <Button variant="outline" onClick={handlePublish} disabled={publishing || results.length === 0 || allPublished || !allReviewed || !mayPublish} title={!mayPublish ? "Your role can't publish results" : undefined}>
          {publishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          Publish Results
        </Button>
      </div>

      {hasDraft && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          Results are <b>awaiting review</b>. Click a student's name to verify their answers against the scanned OMR sheet, then click <b>Mark as Reviewed</b> to approve. Publishing is enabled only after review.
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Rank</th>
              <th className="text-left px-4 py-3">Student</th>
              <th className="text-left px-4 py-3">Marks</th>
              <th className="text-left px-4 py-3">%</th>
              <th className="text-left px-4 py-3">Grade</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-medium">{r.rank != null ? `#${r.rank}` : "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setDetailResult(r)} className="text-indigo-600 hover:underline font-medium">
                    {studentName(r.student_id)}
                  </button>
                </td>
                <td className="px-4 py-3">{r.total_marks}</td>
                <td className="px-4 py-3">{r.percentage?.toFixed(1)}%</td>
                <td className="px-4 py-3">{r.grade}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} type="exam" />
                </td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-400">Run evaluation after answer key and OMR sheets are ready.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ExamDetailedReport
        open={!!detailResult}
        onOpenChange={(o) => !o && setDetailResult(null)}
        result={detailResult}
        exam={examination}
        tenant={tenant}
      />
    </div>
  );
}