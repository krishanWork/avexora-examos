import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import EmptyState from "@/components/shared/EmptyState";
import { DashboardSkeleton } from "@/components/shared/Skeletons";
import ClassImprovementChart from "@/components/performance/ClassImprovementChart";
import QuestionSuccessChart from "@/components/performance/QuestionSuccessChart";
import SubjectClassHeatmap from "@/components/performance/SubjectClassHeatmap";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, Award, CalendarCheck, AlertTriangle, BookOpen
} from "lucide-react";

export default function PerformanceDashboard() {
  const { user } = useOutletContext() || {};
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState([]);
  const [classNames, setClassNames] = useState([]);
  const [improvements, setImprovements] = useState([]);
  const [questionData, setQuestionData] = useState([]);
  const [heatmap, setHeatmap] = useState({ classes: [], subjects: [], cells: {} });

  // Phase 2 Attendance & Integrated Performance additions
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [allResults, setAllResults] = useState([]);

  useEffect(() => {
    const load = async () => {
      if (!user?.tenant_id) return;
      setLoading(true);
      const tid = user.tenant_id;
      const [exams, results, students, sheets, keys, att] = await Promise.all([
        appClient.entities.Examination.filter({ tenant_id: tid }, "exam_date", 1000).catch(() => []),
        appClient.entities.Result.filter({ tenant_id: tid }, "-created_date", 10000).catch(() => []),
        appClient.entities.Student.filter({ tenant_id: tid }, "full_name", 10000).catch(() => []),
        appClient.entities.OMRSheet.filter({ tenant_id: tid, status: "completed" }, "-created_date", 10000).catch(() => []),
        appClient.entities.AnswerKey.filter({ tenant_id: tid }, "-created_date", 1000).catch(() => []),
        appClient.entities.Attendance.filter({ tenant_id: tid }, "-created_date", 10000).catch(() => []),
      ]);

      setAttendanceRecords(att);
      setAllStudents(students);
      setAllResults(results);

      // --- Class performance trend across exams (chronological) ---
      const studentClass = Object.fromEntries(students.map((s) => [s.id, s.class_name || "Unassigned"]));
      const sortedExams = [...exams].sort(
        (a, b) => new Date(a.exam_date || a.created_date) - new Date(b.exam_date || b.created_date)
      );
      const classSet = new Set();
      const trend = [];
      sortedExams.forEach((exam) => {
        const rows = results.filter((r) => r.examination_id === exam.id && r.percentage != null);
        if (rows.length === 0) return;
        const byClass = {};
        rows.forEach((r) => {
          const c = studentClass[r.student_id];
          if (!c) return;
          (byClass[c] = byClass[c] || []).push(r.percentage);
        });
        const point = { name: exam.name || exam.title || "Exam" };
        Object.entries(byClass).forEach(([c, arr]) => {
          classSet.add(c);
          point[c] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
        });
        if (Object.keys(point).length > 1) trend.push(point);
      });
      const classes = [...classSet].sort();

      // --- Improvement score per class: latest avg minus first avg ---
      const imps = classes.map((c) => {
        const points = trend.filter((p) => p[c] != null);
        const first = points[0]?.[c] ?? 0;
        const last = points[points.length - 1]?.[c] ?? 0;
        return { class_name: c, improvement: points.length > 1 ? last - first : 0, latest: last };
      });

      // --- Question success rates across all exams ---
      const keyMap = {};
      keys.forEach((k) => { keyMap[`${k.examination_id}_${k.paper_set || "A"}`] = k.answers || {}; });
      const qStats = {};
      sheets.forEach((sh) => {
        const key = keyMap[`${sh.examination_id}_${sh.paper_set || "A"}`];
        if (!key) return;
        const given = sh.extracted_answers || sh.answers || {};
        Object.entries(key).forEach(([q, ans]) => {
          if (!ans) return;
          const s = (qStats[q] = qStats[q] || { correct: 0, total: 0 });
          s.total += 1;
          if (given[q] && String(given[q]).toUpperCase() === String(ans).toUpperCase()) s.correct += 1;
        });
      });
      const qData = Object.keys(qStats)
        .sort((a, b) => Number(a) - Number(b))
        .map((q) => ({
          question: `Q${q}`,
          rate: Math.round((qStats[q].correct / qStats[q].total) * 100),
          attempts: qStats[q].total,
        }));

      // --- Subject x class heatmap: avg score per subject per class ---
      const examById = Object.fromEntries(exams.map((e) => [e.id, e]));
      const hmAgg = {};
      results.forEach((r) => {
        if (r.percentage == null) return;
        const subject = examById[r.examination_id]?.subject || examById[r.examination_id]?.title;
        const cls = studentClass[r.student_id];
        if (!subject || !cls) return;
        const key = `${cls}__${subject}`;
        (hmAgg[key] = hmAgg[key] || []).push(r.percentage);
      });
      const hmClasses = [...new Set(Object.keys(hmAgg).map((k) => k.split("__")[0]))].sort();
      const hmSubjects = [...new Set(Object.keys(hmAgg).map((k) => k.split("__")[1]))].sort();
      const hmCells = {};
      Object.entries(hmAgg).forEach(([key, arr]) => {
        hmCells[key] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      });

      setHeatmap({ classes: hmClasses, subjects: hmSubjects, cells: hmCells });
      setTrendData(trend);
      setClassNames(classes);
      setImprovements(imps);
      setQuestionData(qData);
      setLoading(false);
    };
    load();
  }, [user?.tenant_id]);

  // Integrated performance & attendance calculations
  const performanceStats = useMemo(() => {
    // Exam average
    const validScores = allResults.map((r) => r.percentage || r.marks).filter((s) => s != null && !isNaN(s));
    const avgScore = validScores.length > 0 ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : 0;

    // Attendance stats
    const totalAtt = attendanceRecords.length;
    const presentCount = attendanceRecords.filter((a) => a.status === "present" || a.status === "late").length;
    const overallAttRate = totalAtt > 0 ? Math.round((presentCount / totalAtt) * 100) : 0;

    // Identify at-risk students:
    // Attendance rate < 75% (if at least 3 records) OR Exam average < 45%
    const studentStats = {};
    allStudents.forEach((st) => {
      studentStats[st.id] = { student: st, attTotal: 0, attPresent: 0, scores: [] };
    });
    attendanceRecords.forEach((a) => {
      if (studentStats[a.student_id]) {
        studentStats[a.student_id].attTotal += 1;
        if (a.status === "present" || a.status === "late") studentStats[a.student_id].attPresent += 1;
      }
    });
    allResults.forEach((r) => {
      const score = r.percentage || r.marks;
      if (studentStats[r.student_id] && score != null && !isNaN(score)) {
        studentStats[r.student_id].scores.push(score);
      }
    });

    const atRiskList = [];
    Object.values(studentStats).forEach((entry) => {
      const attPct = entry.attTotal >= 2 ? Math.round((entry.attPresent / entry.attTotal) * 100) : null;
      const examAvg = entry.scores.length > 0 ? Math.round(entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length) : null;
      const isAttRisk = attPct !== null && attPct < 75;
      const isExamRisk = examAvg !== null && examAvg < 45;

      if (isAttRisk || isExamRisk) {
        atRiskList.push({
          student: entry.student,
          attendanceRate: attPct,
          examAverage: examAvg,
          reasons: [
            isAttRisk ? `Low Attendance (${attPct}%)` : null,
            isExamRisk ? `Low Exam Avg (${examAvg}%)` : null,
          ].filter(Boolean),
        });
      }
    });

    return { avgScore, overallAttRate, totalAssessed: validScores.length, atRiskList };
  }, [allResults, attendanceRecords, allStudents]);

  const hasData = trendData.length > 0 || questionData.length > 0 || attendanceRecords.length > 0;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Academic Performance & Analytics"
        description="Holistic performance metrics, attendance correlation, class progression, and at-risk student tracking."
        icon={TrendingUp}
      />

      {loading ? (
        <DashboardSkeleton />
      ) : !hasData ? (
        <EmptyState
          icon={TrendingUp}
          title="No performance data yet"
          description="Publish results or record attendance to see integrated analytics here."
        />
      ) : (
        <div className="space-y-6">
          {/* Top KPI Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="School Exam Average"
              value={`${performanceStats.avgScore}%`}
              icon={Award}
              accent="text-indigo-600"
              subtext="Across all published exams"
            />
            <StatCard
              label="Attendance Rate"
              value={`${performanceStats.overallAttRate}%`}
              icon={CalendarCheck}
              accent="text-emerald-600"
              subtext="Overall recorded attendance"
            />
            <StatCard
              label="Total Assessments"
              value={performanceStats.totalAssessed}
              icon={BookOpen}
              subtext="Student evaluations"
            />
            <StatCard
              label="At-Risk Students"
              value={performanceStats.atRiskList.length}
              icon={AlertTriangle}
              accent={performanceStats.atRiskList.length > 0 ? "text-rose-600" : "text-stone-600"}
              subtext="Needs academic attention"
            />
          </div>

          {/* At-Risk Students Early Intervention Alert Panel */}
          {performanceStats.atRiskList.length > 0 && (
            <div className="bg-rose-50/70 border border-rose-200 rounded-md p-5 space-y-3">
              <div className="flex items-center gap-2 text-rose-900 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Early Academic Intervention Required
              </div>
              <p className="text-xs text-rose-700">
                The following students have attendance below 75% or examination performance below 45% and require teacher or mentor intervention:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                {performanceStats.atRiskList.slice(0, 6).map((item) => (
                  <div key={item.student.id} className="bg-white p-3 rounded-lg border border-rose-100 shadow-sm text-xs space-y-1">
                    <div className="font-semibold text-stone-900">{item.student.full_name}</div>
                    <div className="text-stone-400">{item.student.class_name || "Enrolled"}</div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {item.reasons.map((r) => (
                        <Badge key={r} variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[11px]">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subject-Class Heatmap & Improvements */}
          <SubjectClassHeatmap classes={heatmap.classes} subjects={heatmap.subjects} cells={heatmap.cells} />
          <ClassImprovementChart trendData={trendData} classNames={classNames} improvements={improvements} />
          <QuestionSuccessChart data={questionData} />
        </div>
      )}
    </div>
  );
}