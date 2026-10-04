import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import EmptyState from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  CalendarCheck, CheckCircle2, XCircle, Users,
  RefreshCw, AlertTriangle, Download, UserCheck
} from "lucide-react";

import { StatusBadge } from "@/lib/statusTokens";

export default function Attendance() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();

  const [exams, setExams] = useState([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [attendance, setAttendance] = useState(null);
  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [statusFilter, setStatusFilter] = useState("present");

  const selectedExam = useMemo(() => exams.find((e) => e.id === selectedExamId) || null, [exams, selectedExamId]);

  const loadExams = async () => {
    if (!user?.tenant_id) return;
    setLoadingExams(true);
    try {
      const list = await appClient.entities.Examination.filter({ tenant_id: user.tenant_id }, "-created_date");
      setExams(list);
      if (list.length > 0 && !selectedExamId) {
        setSelectedExamId((prev) => prev || list[0].id);
      }
    } catch (err) {
      toast({ title: "Failed to load examinations", description: err.message, variant: "destructive" });
    } finally {
      setLoadingExams(false);
    }
  };

  const loadRoster = async (examId = selectedExamId) => {
    if (!examId) return;
    setLoadingRoster(true);
    try {
      const res = await appClient.functions.invoke("getExamAttendance", { examination_id: examId });
      setAttendance(res.data || res);
    } catch (err) {
      toast({ title: "Failed to load exam attendance", description: err.message, variant: "destructive" });
    } finally {
      setLoadingRoster(false);
    }
  };

  useEffect(() => { loadExams(); }, [user?.tenant_id]);
  useEffect(() => { if (selectedExamId) loadRoster(selectedExamId); }, [selectedExamId]);

  const handleReconcile = async () => {
    if (!selectedExamId) return;
    setReconciling(true);
    try {
      const res = await appClient.functions.invoke("reconcileExamAbsentees", { examination_id: selectedExamId });
      const data = res.data || res;
      toast({
        title: "Absentees Finalized",
        description: `Marked ${data.marked_absent} student(s) absent for ${selectedExam?.name}. Students flagged for review were left untouched.`,
      });
      await loadRoster(selectedExamId);
    } catch (err) {
      toast({ title: "Failed to reconcile absentees", description: err.message, variant: "destructive" });
    } finally {
      setReconciling(false);
    }
  };

  const handleExport = () => {
    if (!attendance) return;
    const rows = [...attendance.present, ...attendance.needs_review, ...attendance.absent, ...attendance.unmarked].map((s) =>
      [s.full_name, s.admission_number, s.roll_number, s.status].join(",")
    );
    const csv = ["Student,Admission Number,Roll Number,Status", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(selectedExam?.name || "exam").replaceAll(/\s+/g, "-").toLowerCase()}-attendance.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lists = {
    present: attendance?.present || [],
    needs_review: attendance?.needs_review || [],
    absent: attendance?.absent || [],
    unmarked: attendance?.unmarked || [],
  };
  const roster = lists[statusFilter] || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Exam Attendance"
        description="Automated attendance from OMR scanning. Sheets with unreadable admission bubbles are flagged for review, never silently marked absent."
        icon={CalendarCheck}
        actions={
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="outline" size="sm" onClick={() => loadExams()} disabled={loadingExams} className="gap-2 text-stone-700">
              <RefreshCw className={`w-4 h-4 ${loadingExams ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleReconcile} disabled={reconciling || loadingRoster || !selectedExamId} className="gap-2 text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200">
              <XCircle className="w-4 h-4" /> {reconciling ? "Marking..." : "Finalize Absentees"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!attendance} className="gap-2 text-stone-700">
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* Exam selector */}
      <div className="bg-white p-4 rounded-xl border border-stone-200/80 shadow-sm">
        <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Examination</label>
        <Select value={selectedExamId} onValueChange={setSelectedExamId} disabled={loadingExams || exams.length === 0}>
          <SelectTrigger className="w-full sm:max-w-md">
            <SelectValue placeholder={loadingExams ? "Loading examinations..." : "Select an examination"} />
          </SelectTrigger>
          <SelectContent>
            {exams.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
                {e.status ? ` (${e.status.replaceAll("_", " ")})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedExam?.exam_date && (
          <p className="text-xs text-stone-400 mt-1.5">Exam date: {selectedExam.exam_date}</p>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total Enrolled" value={attendance?.total_enrolled ?? "-"} icon={Users} subtext="In exam roster" />
        <StatCard label="Present" value={attendance?.present_count ?? "-"} icon={CheckCircle2} accent="text-emerald-600" subtext="Confirmed via OMR" />
        <StatCard label="Absent" value={attendance?.absent_count ?? "-"} icon={XCircle} accent="text-rose-600" subtext="After finalization" />
        <StatCard label="Needs Review" value={attendance?.needs_review_count ?? "-"} icon={AlertTriangle} accent="text-amber-600" subtext="Unreadable admission" />
        <StatCard label="Attendance Rate" value={attendance ? `${attendance.percentage}%` : "-"} icon={CalendarCheck} accent="text-indigo-600" subtext="Present / enrolled" />
      </div>

      {/* Status filter tabs */}
      <div className="bg-white rounded-xl border border-stone-200/80 shadow-sm overflow-hidden">
        <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-stone-100">
          {[
            { key: "present", label: "Present" },
            { key: "needs_review", label: "Needs Review" },
            { key: "absent", label: "Absent" },
            { key: "unmarked", label: "Unmarked" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === t.key ? "bg-indigo-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200/70"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 ${statusFilter === t.key ? "text-indigo-100" : "text-stone-400"}`}>
                {lists[t.key].length}
              </span>
            </button>
          ))}
        </div>

        {loadingRoster ? (
          <div className="p-12 text-center text-stone-400">
            <div className="w-8 h-8 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
            Loading exam attendance...
          </div>
        ) : !selectedExamId ? (
          <div className="p-12 text-center">
            <EmptyState icon={CalendarCheck} title="No examination selected" description="Choose an examination to view its OMR-driven attendance." />
          </div>
        ) : roster.length === 0 ? (
          <div className="p-12 text-center">
            <EmptyState icon={Users} title={`No ${statusFilter.replaceAll("_", " ")} students`} description="No students in this category for the selected examination." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50/80 border-b border-stone-200 text-xs text-stone-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">#</th>
                  <th className="py-3.5 px-4">Student</th>
                  <th className="py-3.5 px-4">Admission Number</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {roster.map((s, idx) => (
                  <tr key={s.student_id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="py-3 px-4 text-stone-400 font-mono text-xs">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-stone-900">{s.full_name}</div>
                      <div className="text-xs text-stone-400">{s.roll_number ? `Roll: ${s.roll_number}` : ""}</div>
                    </td>
                    <td className="py-3 px-4 text-stone-600">{s.admission_number || "—"}</td>
                    <td className="py-3 px-4 text-center">
                      <StatusBadge status={s.status} type="attendance" />
                    </td>
                    <td className="py-3 px-4 text-xs text-stone-500">
                      {s.status === "present" ? (
                        <span className="flex items-center gap-1 text-emerald-700"><UserCheck className="w-3.5 h-3.5" /> OMR scan</span>
                      ) : s.status === "needs_review" ? (
                        <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Unreadable bubble grid</span>
                      ) : (
                        <span>{s.status === "absent" ? "No matching scan" : "Awaiting scan"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {roster.length > 0 && (
          <div className="p-4 bg-stone-50 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-stone-500 font-medium">
              {roster.length} student{roster.length === 1 ? "" : "s"} in "{statusFilter.replaceAll("_", " ")}" filter
            </p>
            <Button onClick={handleReconcile} disabled={reconciling || !selectedExamId} size="sm" variant="outline" className="gap-2 text-rose-700">
              <XCircle className="w-4 h-4" /> {reconciling ? "Marking..." : "Mark unmarked as absent"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}