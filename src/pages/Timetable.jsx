import React, { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw,
  Calendar, CheckCircle2, FileSpreadsheet, Users, AlertTriangle, Filter
} from "lucide-react";
import moment from "moment";

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h)) return null;
  return h * 60 + (m || 0);
}

function timesOverlap(startA, endA, startB, endB) {
  const sA = timeToMinutes(startA);
  const eA = timeToMinutes(endA);
  const sB = timeToMinutes(startB);
  const eB = timeToMinutes(endB);
  if (sA == null || eA == null || sB == null || eB == null) return true;
  return Math.max(sA, sB) < Math.min(eA, eB);
}

export default function Timetable() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();

  const [dateSheet, setDateSheet] = useState(null);
  const [loadingDateSheet, setLoadingDateSheet] = useState(false);
  const [filterConflictsOnly, setFilterConflictsOnly] = useState(false);

  const loadDateSheet = async () => {
    if (!user?.tenant_id) return;
    setLoadingDateSheet(true);
    try {
      const res = await appClient.functions.invoke("getExamTimetable", {});
      setDateSheet(res.data || res);
    } catch (err) {
      toast({ title: "Failed to load exam date sheet", description: err.message, variant: "destructive" });
    } finally {
      setLoadingDateSheet(false);
    }
  };

  React.useEffect(() => {
    loadDateSheet();
  }, [user?.tenant_id]);

  const { conflictsByExamId, allConflicts } = useMemo(() => {
    const exams = dateSheet?.date_sheet || [];
    const conflictsByExamId = {};
    const allConflicts = [];

    for (let i = 0; i < exams.length; i++) {
      const a = exams[i];
      if (!a.exam_date) continue;

      for (let j = i + 1; j < exams.length; j++) {
        const b = exams[j];
        if (!b.exam_date || a.exam_date !== b.exam_date) continue;

        // 1. Class conflict: shared class on same day
        const sharedClasses = (a.class_names || []).filter((c) =>
          (b.class_names || []).includes(c)
        );
        if (sharedClasses.length > 0) {
          const conflict = {
            type: "class",
            date: a.exam_date,
            examA: a,
            examB: b,
            detail: `Class ${sharedClasses.join(", ")} scheduled for multiple exams (${a.name} & ${b.name}) on ${moment(a.exam_date).format("MMM D, YYYY")}`,
          };
          allConflicts.push(conflict);
          if (!conflictsByExamId[a.id]) conflictsByExamId[a.id] = [];
          if (!conflictsByExamId[b.id]) conflictsByExamId[b.id] = [];
          conflictsByExamId[a.id].push({ type: "class", otherName: b.name, classes: sharedClasses });
          conflictsByExamId[b.id].push({ type: "class", otherName: a.name, classes: sharedClasses });
        }

        // 2. Venue conflict: same venue with overlapping times
        if (a.venue && b.venue && a.venue.trim().toLowerCase() === b.venue.trim().toLowerCase()) {
          if (timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) {
            const conflict = {
              type: "venue",
              date: a.exam_date,
              venue: a.venue,
              examA: a,
              examB: b,
              detail: `Venue "${a.venue}" double-booked on ${moment(a.exam_date).format("MMM D, YYYY")} (${a.name} & ${b.name})`,
            };
            allConflicts.push(conflict);
            if (!conflictsByExamId[a.id]) conflictsByExamId[a.id] = [];
            if (!conflictsByExamId[b.id]) conflictsByExamId[b.id] = [];
            conflictsByExamId[a.id].push({ type: "venue", otherName: b.name, venue: a.venue });
            conflictsByExamId[b.id].push({ type: "venue", otherName: a.name, venue: a.venue });
          }
        }
      }
    }

    return { conflictsByExamId, allConflicts };
  }, [dateSheet]);

  const displayedExams = useMemo(() => {
    const list = dateSheet?.date_sheet || [];
    if (!filterConflictsOnly) return list;
    return list.filter((e) => conflictsByExamId[e.id]?.length > 0);
  }, [dateSheet, filterConflictsOnly, conflictsByExamId]);

  const sessionBadge = {
    upcoming: "bg-indigo-100 text-indigo-700",
    today: "bg-emerald-100 text-emerald-700",
    completed: "bg-stone-100 text-stone-500",
    unscheduled: "bg-amber-100 text-amber-700",
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Exam Date Sheet"
        description="Official examination schedule derived from the exam workflow — dates, sessions, venues, and classes."
        icon={FileSpreadsheet}
        actions={
          <div className="flex items-center gap-2 sm:gap-3">
            {allConflicts.length > 0 && (
              <Button
                variant={filterConflictsOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterConflictsOnly((v) => !v)}
                className={`gap-1.5 text-xs ${
                  filterConflictsOnly ? "bg-amber-600 hover:bg-amber-700 text-white" : "border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100"
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                {filterConflictsOnly ? "Showing Conflicts" : `Filter Conflicts (${allConflicts.length})`}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={loadDateSheet} disabled={loadingDateSheet} className="gap-2 text-stone-700">
              <RefreshCw className={`w-4 h-4 ${loadingDateSheet ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        }
      />

      {/* Operational Conflict Alert Banner */}
      {allConflicts.length > 0 && (
        <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-700 shrink-0 mt-0.5 sm:mt-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-900">
                {allConflicts.length} Schedule Conflict{allConflicts.length !== 1 ? "s" : ""} Detected
              </h4>
              <p className="text-xs text-amber-700 mt-0.5">
                Examinations are sharing the same classroom cohort or venue on the same calendar day. Review flagged rows below to adjust dates or locations.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-amber-300 text-amber-800 bg-white hover:bg-amber-100 shrink-0 self-start sm:self-center"
            onClick={() => setFilterConflictsOnly((v) => !v)}
          >
            {filterConflictsOnly ? "View All Scheduled Exams" : `Show ${allConflicts.length} Conflicting Exam${allConflicts.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}

      {dateSheet && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Total Exams", value: dateSheet.total_exams, icon: FileSpreadsheet, color: "text-stone-700" },
            { label: "Upcoming", value: dateSheet.upcoming_count, icon: Calendar, color: "text-indigo-600" },
            { label: "Today", value: dateSheet.today_count, icon: CheckCircle2, color: "text-emerald-600" },
            { label: "Completed", value: dateSheet.completed_count, icon: CheckCircle2, color: "text-stone-500" },
            {
              label: "Conflicts",
              value: allConflicts.length,
              icon: AlertTriangle,
              color: allConflicts.length > 0 ? "text-amber-600 font-bold" : "text-stone-400",
              bgColor: allConflicts.length > 0 ? "bg-amber-50/50 border-amber-200" : "bg-white",
            },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border border-stone-200/80 p-4 flex items-center gap-3 ${s.bgColor || "bg-white"}`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <div>
                <p className={`text-xl font-bold ${s.color.includes("text-") ? s.color.split(" ")[0] : "text-stone-900"}`}>{s.value}</p>
                <p className="text-xs text-stone-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-stone-200/80 shadow-sm overflow-hidden">
        {loadingDateSheet ? (
          <div className="p-12 text-center text-stone-400">
            <div className="w-8 h-8 border-3 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
            Loading exam date sheet...
          </div>
        ) : !displayedExams.length ? (
          <div className="p-12 text-center">
            <EmptyState
              icon={filterConflictsOnly ? AlertTriangle : FileSpreadsheet}
              title={filterConflictsOnly ? "No conflicting exams" : "No examinations scheduled"}
              description={
                filterConflictsOnly
                  ? "None of the scheduled exams share overlapping classrooms or venues."
                  : "Create examinations in the Exams module to populate the date sheet."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50/80 border-b border-stone-200 text-xs text-stone-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-4">Subject & Conflicts</th>
                  <th className="py-3.5 px-4">Classes</th>
                  <th className="py-3.5 px-4 text-center">Sections</th>
                  <th className="py-3.5 px-4 text-center">Session</th>
                  <th className="py-3.5 px-4 text-center">Time</th>
                  <th className="py-3.5 px-4 text-center">Venue</th>
                  <th className="py-3.5 px-4 text-center">Roster</th>
                  <th className="py-3.5 px-4 text-center">Duration</th>
                  <th className="py-3.5 px-4 text-center">Questions</th>
                  <th className="py-3.5 px-4 text-center">Marks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {displayedExams.map((e) => {
                  const examConflicts = conflictsByExamId[e.id] || [];
                  const hasConflict = examConflicts.length > 0;
                  return (
                    <tr
                      key={e.id}
                      className={`transition-colors ${
                        hasConflict ? "bg-amber-50/30 hover:bg-amber-50/50" : "hover:bg-stone-50/60"
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-medium text-stone-900">{e.exam_date ? moment(e.exam_date).format("ddd, MMM D YYYY") : "Not scheduled"}</div>
                        <div className="text-xs text-stone-400">{e.exam_date ? moment(e.exam_date).format("YYYY-MM-DD") : ""}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-stone-900">{e.name}</div>
                        <div className="text-xs text-stone-500">{e.subject || ""}</div>
                        {hasConflict && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {examConflicts.map((c, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className={`text-[11px] py-0 px-1.5 font-normal ${
                                  c.type === "class"
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : "bg-amber-100 text-amber-800 border-amber-300"
                                }`}
                              >
                                <AlertTriangle className="w-2.5 h-2.5 mr-1 inline" />
                                {c.type === "class"
                                  ? `Class Collision: ${c.classes.join(", ")} (${c.otherName})`
                                  : `Venue Collision: ${c.venue} (${c.otherName})`}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-stone-600">{e.class_names.join(", ") || "—"}</td>
                      <td className="py-3 px-4 text-center text-stone-600">{e.section_names.length ? e.section_names.join(", ") : "—"}</td>
                      <td className="py-3 px-4 text-center">
                        <Badge className={sessionBadge[e.session] || sessionBadge.unscheduled}>
                          {e.session_label ? e.session_label : e.session === "today" ? "Today" : e.session.replaceAll("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center text-stone-600">
                        {e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ""}` : "—"}
                      </td>
                      <td className="py-3 px-4 text-center text-stone-600">
                        {e.venue ? (
                          <span className={examConflicts.some((c) => c.type === "venue") ? "text-amber-800 font-medium" : ""}>
                            {e.venue}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-3 px-4 text-center text-stone-600">
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-stone-400" /> {e.roster_count}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-stone-600">{e.duration_minutes ? `${e.duration_minutes}m` : "—"}</td>
                      <td className="py-3 px-4 text-center text-stone-600">{e.num_questions || "—"}</td>
                      <td className="py-3 px-4 text-center text-stone-600">{e.max_marks || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}