import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { DashboardSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from "recharts";
import {
  BarChart3, Trophy, TrendingUp, CheckCircle2, Users, Printer
} from "lucide-react";

const GRADE_COLORS = {
  "A+": "#10B981", // emerald
  "A": "#4F46E5",  // blue
  "B+": "#6366F1", // indigo
  "B": "#8B5CF6",  // purple
  "C": "#F59E0B",  // amber
  "D": "#F97316",  // orange
  "F": "#EF4444",  // red
};

export default function Analytics() {
  const { user } = useOutletContext() || {};
  const [exams, setExams] = useState([]);
  const [results, setResults] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState("all");

  useEffect(() => {
    const load = async () => {
      if (!user?.tenant_id) return;
      try {
        setLoading(true);
        const [exList, resList, stList] = await Promise.all([
          appClient.entities.Examination.filter({ tenant_id: user.tenant_id, status: "published" }, "-created_date").catch(() => []),
          appClient.entities.Result.filter({ tenant_id: user.tenant_id, status: "published" }, "-created_date").catch(() => []),
          appClient.entities.Student.filter({ tenant_id: user.tenant_id, status: "active" }).catch(() => []),
        ]);
        setExams(exList);
        setResults(resList);
        setStudents(stList);
      } catch (err) {
        console.error("Failed to load analytics data:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.tenant_id]);

  // Student Lookup Map
  const studentMap = useMemo(() => {
    const map = {};
    students.forEach((s) => { map[s.id] = s; });
    return map;
  }, [students]);

  // Filtered Results
  const filteredResults = useMemo(() => {
    if (selectedExamId === "all") return results;
    return results.filter((r) => r.examination_id === selectedExamId);
  }, [results, selectedExamId]);

  // KPI Calculations
  const totalEvaluated = filteredResults.length;
  const overallAvg = totalEvaluated > 0
    ? Math.round(filteredResults.reduce((s, r) => s + (r.percentage || 0), 0) / totalEvaluated)
    : 0;
  const passedCount = filteredResults.filter((r) => r.passed || (r.percentage || 0) >= 33).length;
  const passRate = totalEvaluated > 0 ? Math.round((passedCount / totalEvaluated) * 100) : 0;
  const highestScore = totalEvaluated > 0
    ? Math.max(...filteredResults.map((r) => r.percentage || 0))
    : 0;

  // Exam-by-Exam Comparison Chart Data
  const examComparisonData = useMemo(() => {
    return exams.map((e) => {
      const examRes = results.filter((r) => r.examination_id === e.id);
      if (examRes.length === 0) return null;
      const avg = Math.round(examRes.reduce((s, r) => s + (r.percentage || 0), 0) / examRes.length);
      const passed = examRes.filter((r) => r.passed || (r.percentage || 0) >= 33).length;
      const rate = Math.round((passed / examRes.length) * 100);
      const top = Math.max(...examRes.map((r) => r.percentage || 0));
      return {
        id: e.id,
        name: e.name.length > 18 ? e.name.slice(0, 16) + "…" : e.name,
        fullName: e.name,
        subject: e.subject,
        avgPercentage: avg,
        passRate: rate,
        topScore: top,
        studentsCount: examRes.length,
      };
    }).filter(Boolean);
  }, [exams, results]);

  // Grade Distribution Data
  const gradeDistribution = useMemo(() => {
    const counts = { "A+": 0, "A": 0, "B+": 0, "B": 0, "C": 0, "D": 0, "F": 0 };
    filteredResults.forEach((r) => {
      const g = r.grade || "F";
      if (counts[g] != null) counts[g]++;
      else counts["F"]++;
    });
    return Object.entries(counts).map(([grade, count]) => ({
      grade,
      count,
      pct: totalEvaluated > 0 ? Math.round((count / totalEvaluated) * 100) : 0,
      fill: GRADE_COLORS[grade] || "#A8A29E",
    }));
  }, [filteredResults, totalEvaluated]);

  // Subject Performance Breakdown
  const subjectBreakdown = useMemo(() => {
    const subjMap = {};
    results.forEach((r) => {
      const exam = exams.find((e) => e.id === r.examination_id);
      const subj = exam?.subject || "General";
      if (!subjMap[subj]) subjMap[subj] = { scores: [], pass: 0, total: 0 };
      subjMap[subj].scores.push(r.percentage || 0);
      subjMap[subj].total++;
      if (r.passed || (r.percentage || 0) >= 33) subjMap[subj].pass++;
    });
    return Object.entries(subjMap).map(([subject, data]) => ({
      subject,
      avg: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
      passRate: Math.round((data.pass / data.total) * 100),
      count: data.total,
    })).sort((a, b) => b.avg - a.avg);
  }, [results, exams]);

  // Score Bands
  const scoreBands = useMemo(() => {
    const bands = [
      { label: "Distinction (75%–100%)", min: 75, max: 100, color: "bg-emerald-500", count: 0 },
      { label: "First Division (60%–74%)", min: 60, max: 74.99, color: "bg-indigo-500", count: 0 },
      { label: "Second Division (50%–59%)", min: 50, max: 59.99, color: "bg-indigo-500", count: 0 },
      { label: "Third Division (33%–49%)", min: 33, max: 49.99, color: "bg-amber-500", count: 0 },
      { label: "Needs Improvement (<33%)", min: 0, max: 32.99, color: "bg-red-500", count: 0 },
    ];
    filteredResults.forEach((r) => {
      const p = r.percentage || 0;
      const band = bands.find((b) => p >= b.min && p <= b.max);
      if (band) band.count++;
    });
    return bands.map((b) => ({
      ...b,
      pct: totalEvaluated > 0 ? Math.round((b.count / totalEvaluated) * 100) : 0,
    }));
  }, [filteredResults, totalEvaluated]);

  // Merit Board (Top 10 Rankers)
  const topRankers = useMemo(() => {
    return [...filteredResults]
      .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
      .slice(0, 10)
      .map((r) => {
        const student = studentMap[r.student_id];
        const exam = exams.find((e) => e.id === r.examination_id);
        return {
          id: r.id,
          studentName: student?.full_name || "Student",
          rollNumber: student?.roll_number || "—",
          className: student?.class_name || exam?.class_name || "—",
          examName: exam?.name || "Exam",
          marks: r.total_marks,
          percentage: r.percentage,
          grade: r.grade,
          rank: r.rank || 1,
        };
      });
  }, [filteredResults, studentMap, exams]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
        <DashboardSkeleton />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <PageHeader
        title="Institutional Analytics & Intelligence"
        description="Comprehensive academic performance metrics, score distributions, and merit telemetry."
        actions={
          <div className="flex items-center gap-2">
            <Select value={selectedExamId} onValueChange={setSelectedExamId}>
              <SelectTrigger className="w-56 h-9 text-xs bg-white">
                <SelectValue placeholder="All Examinations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Published Exams ({exams.length})</SelectItem>
                {exams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handlePrint} className="text-xs">
              <Printer className="w-3.5 h-3.5 mr-1.5" /> Print / Export
            </Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Overall Average"
          value={`${overallAvg}%`}
          subtext={overallAvg >= 75 ? "Distinction Level" : overallAvg >= 60 ? "First Class Level" : "Average"}
          icon={TrendingUp}
          accent="text-indigo-600"
        />
        <StatCard
          label="Pass Rate"
          value={`${passRate}%`}
          subtext={`${passedCount} of ${totalEvaluated} passed`}
          icon={CheckCircle2}
          accent="text-emerald-600"
        />
        <StatCard
          label="Highest Score"
          value={`${highestScore}%`}
          subtext="Top Achiever"
          icon={Trophy}
          accent="text-amber-600"
        />
        <StatCard
          label="Evaluated Sheets"
          value={totalEvaluated}
          subtext={`Across ${exams.length} Exams`}
          icon={Users}
          accent="text-indigo-600"
        />
      </div>

      {totalEvaluated === 0 ? (
        <div className="bg-white border border-dashed border-stone-200 rounded-3xl p-16 text-center">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 text-stone-300" />
          <h3 className="font-heading font-bold text-stone-800 text-lg mb-1">No Published Results Found</h3>
          <p className="text-sm text-stone-400 max-w-md mx-auto mb-4">
            Analytics will dynamically compute and visualize once examinations are evaluated and published.
          </p>
          <Button asChild className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Link to="/examinations">Go to Examinations</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Main Analytics Visualizations Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Exam Performance Comparative Chart */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-bold text-stone-900 text-base">Examination Performance Trends</h3>
                  <p className="text-xs text-stone-500">Average score % vs Pass rate % across published examinations</p>
                </div>
                <Badge variant="outline" className="text-xs font-semibold text-indigo-700 bg-indigo-50 border-indigo-200">
                  {examComparisonData.length} Exams
                </Badge>
              </div>

              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={examComparisonData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#78716C" }} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#78716C" }} tickLine={false} unit="%" />
                    <Tooltip
                      formatter={(value, name) => [`${value}%`, name === "avgPercentage" ? "Average Score" : "Pass Rate"]}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                      contentStyle={{ borderRadius: "12px", border: "1px solid #E7E5E4", fontSize: "12px" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
                    <Bar dataKey="avgPercentage" name="Average Score" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="passRate" name="Pass Rate" fill="#10B981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Right 1 Col: Grade Distribution Breakdown */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="font-heading font-bold text-stone-900 text-base">Grade Distribution</h3>
                <p className="text-xs text-stone-500">Academic grading hierarchy across {totalEvaluated} results</p>
              </div>

              <div className="space-y-2.5 pt-1">
                {gradeDistribution.map((item) => (
                  <div key={item.grade} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: item.fill }}
                        />
                        <span className="font-bold text-stone-800">Grade {item.grade}</span>
                      </div>
                      <span className="text-stone-500 font-mono text-[11px]">
                        {item.count} ({item.pct}%)
                      </span>
                    </div>
                    <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${item.pct}%`,
                          backgroundColor: item.fill,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Secondary Grid: Score Bands & Subject Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Bands / Performance Levels */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="font-heading font-bold text-stone-900 text-base">Performance Bands</h3>
                <p className="text-xs text-stone-500">Categorization by standard institutional achievement levels</p>
              </div>

              <div className="space-y-3 pt-2">
                {scoreBands.map((band) => (
                  <div key={band.label} className="p-3 rounded-xl border border-stone-100 bg-stone-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${band.color}`} />
                      <div>
                        <p className="text-xs font-semibold text-stone-800">{band.label}</p>
                        <p className="text-[11px] text-stone-400">{band.count} Students</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {band.pct}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Subject-Wise Comparative Metrics */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="font-heading font-bold text-stone-900 text-base">Subject Mastery Breakdown</h3>
                <p className="text-xs text-stone-500">Comparative average percentage by academic subject</p>
              </div>

              <div className="space-y-2.5 pt-2">
                {subjectBreakdown.map((s, idx) => (
                  <div key={s.subject} className="flex items-center justify-between p-3 rounded-xl border border-stone-100 bg-white hover:bg-stone-50 transition">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-stone-900">{s.subject}</p>
                        <p className="text-[11px] text-stone-400">{s.count} student evaluations</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-stone-800">{s.avg}% avg</p>
                      <p className="text-[11px] text-emerald-600 font-semibold">{s.passRate}% pass</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Performers Merit Board */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Trophy className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-stone-900 text-base">Merit Roll of Honor</h3>
                  <p className="text-xs text-stone-500">Top 10 highest-achieving students across evaluated examinations</p>
                </div>
              </div>
              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                Top 10
              </Badge>
            </div>

            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-500 uppercase font-semibold">
                  <tr>
                    <th scope="col" className="px-4 py-3">Rank</th>
                    <th scope="col" className="px-4 py-3">Student Name</th>
                    <th scope="col" className="px-4 py-3">Roll No</th>
                    <th scope="col" className="px-4 py-3">Class</th>
                    <th scope="col" className="px-4 py-3">Examination</th>
                    <th scope="col" className="px-4 py-3 text-right">Score</th>
                    <th scope="col" className="px-4 py-3 text-right">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {topRankers.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-stone-50/50 transition">
                      <td className="px-4 py-3 font-bold">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${
                          idx === 0 ? "bg-amber-400 text-stone-900 font-black" :
                          idx === 1 ? "bg-stone-300 text-stone-900 font-bold" :
                          idx === 2 ? "bg-amber-700 text-white font-bold" :
                          "bg-stone-100 text-stone-600"
                        }`}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-stone-900">
                        {r.studentName}
                      </td>
                      <td className="px-4 py-3 font-mono text-stone-500">{r.rollNumber}</td>
                      <td className="px-4 py-3 text-stone-600">{r.className}</td>
                      <td className="px-4 py-3 text-stone-600">{r.examName}</td>
                      <td className="px-4 py-3 text-right font-bold text-stone-900">
                        {r.percentage}% <span className="text-stone-400 text-[11px] font-normal">({r.marks} pts)</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[11px]">
                          {r.grade}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}