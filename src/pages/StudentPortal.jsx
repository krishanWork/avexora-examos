import React, { useEffect, useState, useMemo } from "react";
import { appClient } from "@/api/appClient";
import useCurrentUser from "@/hooks/useCurrentUser";
import { generateReportCardPDF } from "@/lib/generateReportCardPDF";
import PortalHeader from "@/components/shared/PortalHeader";
import ImpersonationBanner from "@/components/shared/ImpersonationBanner";
import EmptyState from "@/components/shared/EmptyState";
import ExamDetailedReport from "@/components/portal/ExamDetailedReport";
import PerformanceTrend from "@/components/portal/PerformanceTrend";
import AnnouncementBanner from "@/components/announcements/AnnouncementBanner";
import StatCard from "@/components/shared/StatCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  Trophy, FileDown, LogOut, Award, User, Layers, CalendarCheck, Clock, FileText,
  MapPin
} from "lucide-react";
import moment from "moment";

const InfoRow = ({ label, value }) => (
  <div>
    <p className="text-xs text-stone-400 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-medium text-stone-800 mt-0.5">{value || "-"}</p>
  </div>
);

export default function StudentPortal() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [student, setStudent] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [schoolClass, setSchoolClass] = useState(null);
  const [section, setSection] = useState(null);
  const [classmates, setClassmates] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [results, setResults] = useState([]);
  const [exams, setExams] = useState({});
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  // Phase 2 additions
  const [attendance, setAttendance] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);

  // Submit assignment dialog
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [selectedAsg, setSelectedAsg] = useState(null);
  const [submissionText, setSubmissionText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        setLoading(true);
        let sid = user.linked_student_id;
        if (!sid) {
          const res = await appClient.functions.invoke("linkMyAccount", {});
          sid = res.data?.linked_student_id;
        }
        if (!sid) {
          setLoading(false);
          return;
        }

        const s = await appClient.entities.Student.get(sid);
        setStudent(s);

        const [tRes, resultList, allExams, subList, attList, ttRes, asgList, submsList] = await Promise.all([
          appClient.functions.invoke("getMyTenant", { tenant_id: s.tenant_id }).catch(() => ({ data: {} })),
          appClient.entities.Result.filter({ student_id: s.id, status: "published" }, "-created_date").catch(() => []),
          appClient.entities.Examination.filter({ tenant_id: s.tenant_id }, "-created_date").catch(() => []),
          appClient.entities.Subject.filter({ tenant_id: s.tenant_id }).catch(() => []),
          appClient.entities.Attendance.filter({ student_id: s.id }, "-date").catch(() => []),
          appClient.functions.invoke("getExamTimetable", {}).catch(() => ({ data: { date_sheet: [] } })),
          appClient.entities.Assignment.filter({ tenant_id: s.tenant_id, status: "published" }, "-created_date").catch(() => []),
          appClient.entities.AssignmentSubmission.filter({ student_id: s.id }, "-created_date").catch(() => []),
        ]);

        setTenant(tRes.data?.tenant || null);
        setResults(resultList);
        setSubjects(subList);
        setAttendance(attList);
        setTimetable(ttRes.data?.date_sheet || ttRes.data || []);
        setAssignments(asgList);
        setSubmissions(submsList);

        const examMap = {};
        allExams.forEach((e) => { examMap[e.id] = e; });
        setExams(examMap);

        // Fetch Class and Section
        if (s.school_class_id) {
          appClient.entities.SchoolClass.get(s.school_class_id).then(setSchoolClass).catch(() => {});
        }
        if (s.section_id) {
          appClient.entities.Section.get(s.section_id).then(setSection).catch(() => {});
        }

        // Fetch Classmates: SERVER AUTHORIZED
        if (s.school_class_id) {
          const peers = await appClient.entities.Student.filter({
            tenant_id: s.tenant_id,
            school_class_id: s.school_class_id,
          }).catch(() => []);
          setClassmates(peers);
        }
      } catch (err) {
        console.error("Failed to load student portal data:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleOpenSubmit = (asg) => {
    setSelectedAsg(asg);
    const existing = submissions.find((s) => s.assignment_id === asg.id);
    setSubmissionText(existing?.submission_text || "");
    setSubmitDialogOpen(true);
  };

  const handleSubmitAnswer = async (e) => {
    e.preventDefault();
    if (!selectedAsg || !student) return;
    try {
      setSubmitting(true);
      const existing = submissions.find((s) => s.assignment_id === selectedAsg.id);
      if (existing?.status === "graded") {
        toast({ title: "Already graded", description: "This submission has been graded, so it cannot be updated.", variant: "destructive" });
        setSubmitDialogOpen(false);
        return;
      }
      const payload = {
        assignment_id: selectedAsg.id,
        student_id: student.id,
        submission_text: submissionText,
        status: "submitted",
      };

      if (existing) {
        await appClient.entities.AssignmentSubmission.update(existing.id, payload);
      } else {
        await appClient.entities.AssignmentSubmission.create(payload);
      }

      toast({ title: "Assignment Submitted", description: "Your coursework response has been uploaded." });
      setSubmitDialogOpen(false);

      // Refresh submissions
      const updated = await appClient.entities.AssignmentSubmission.filter({ student_id: student.id }, "-created_date").catch(() => []);
      setSubmissions(updated);
    } catch (err) {
      toast({ title: "Submission Failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async () => {
    if (!student || results.length === 0) return;
    try {
      const url = await generateReportCardPDF({
        student,
        results,
        exams,
        tenant,
        classTeacher: null,
      });
      if (url) window.open(url, "_blank");
    } catch (err) {
      toast({ title: "Download failed", description: err.message || "Please try again.", variant: "destructive" });
    }
  };

  // Attendance metrics
  const attendanceMetrics = useMemo(() => {
    const total = attendance.length;
    const present = attendance.filter((a) => a.status === "present" || a.status === "late").length;
    const absent = attendance.filter((a) => a.status === "absent").length;
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, rate };
  }, [attendance]);

  const avgPercentage = useMemo(() => {
    const valid = results.filter((r) => r.percentage != null);
    if (!valid.length) return 0;
    return Math.round(valid.reduce((sum, r) => sum + r.percentage, 0) / valid.length);
  }, [results]);

  const bestScore = useMemo(() => {
    return results.reduce((max, r) => Math.max(max, r.percentage || 0), 0);
  }, [results]);

  const trendData = useMemo(() => {
    return results.map((r) => ({
      name: exams[r.examination_id]?.name || exams[r.examination_id]?.title || "Exam",
      percentage: r.percentage,
      date: exams[r.examination_id]?.exam_date,
    }));
  }, [results, exams]);

  const assignmentsDueCount = useMemo(() => {
    return assignments.filter((a) => !submissions.some((s) => s.assignment_id === a.id && (s.status === "submitted" || s.status === "graded"))).length;
  }, [assignments, submissions]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
            <User className="w-6 h-6" />
          </div>
          <h2 className="font-heading font-bold text-stone-900 text-lg">Student Profile Not Linked</h2>
          <p className="text-xs text-stone-500">
            No enrolled student record is linked to this account ({user?.email}). Please contact your school administrator.
          </p>
          <Button onClick={() => appClient.auth.logout("/login")} variant="outline" size="sm" className="w-full">
            <LogOut className="w-4 h-4 mr-2" /> Log Out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <ImpersonationBanner />
      <PortalHeader
        tenant={tenant}
        user={user}
        title={tenant?.name || "Student Portal"}
        subtitle={`Welcome, ${student.full_name}`}
        onLogout={() => appClient.auth.logout("/login")}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <AnnouncementBanner userId={user?.id} tenantId={user?.tenant_id} />
        {/* Student Profile Summary Card */}
        <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white font-bold text-2xl flex items-center justify-center shadow-md">
              {student.full_name?.charAt(0) || "S"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading font-bold text-stone-900 text-xl">{student.full_name}</h2>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  {student.status || "Enrolled"}
                </Badge>
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {student.class_name || schoolClass?.name || "Class"} {student.section || section?.name ? `Section ${student.section || section?.name}` : ""}
                {student.roll_number ? ` * Roll #${student.roll_number}` : ""}
                {student.admission_number ? ` * Adm #${student.admission_number}` : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Quick KPI stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Overall Average" value={`${avgPercentage}%`} icon={Award} accent="text-indigo-600" />
          <StatCard label="Highest Score" value={`${Math.round(bestScore)}%`} icon={Trophy} accent="text-amber-500" />
          <StatCard label="Attendance Rate" value={`${attendanceMetrics.rate}%`} icon={CalendarCheck} accent="text-emerald-600" />
          <StatCard label="Assignments Due" value={assignmentsDueCount} icon={FileText} accent="text-purple-600" />
        </div>

        <Tabs defaultValue="results" className="space-y-4">
          <TabsList className="bg-white border border-stone-200 p-1 rounded-xl flex-wrap">
            <TabsTrigger value="results" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <Trophy className="w-3.5 h-3.5 mr-1" /> My Results ({results.length})
            </TabsTrigger>
            <TabsTrigger value="attendance" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <CalendarCheck className="w-3.5 h-3.5 mr-1" /> My Attendance ({attendanceMetrics.rate}%)
            </TabsTrigger>
            <TabsTrigger value="timetable" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <Clock className="w-3.5 h-3.5 mr-1" /> My Exam Schedule
            </TabsTrigger>
            <TabsTrigger value="assignments" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <FileText className="w-3.5 h-3.5 mr-1" /> Coursework ({assignments.length})
            </TabsTrigger>
            <TabsTrigger value="profile" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <User className="w-3.5 h-3.5 mr-1" /> Profile
            </TabsTrigger>
            <TabsTrigger value="class" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <Layers className="w-3.5 h-3.5 mr-1" /> Class & Peers
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: RESULTS */}
          <TabsContent value="results" className="space-y-6">
            {results.length > 0 ? (
              <>
                <PerformanceTrend data={trendData} />
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h3 className="font-heading font-semibold text-stone-900">Published Exam Results</h3>
                    <Button size="sm" variant="outline" onClick={handleDownload}>
                      <FileDown className="w-4 h-4 mr-2" /> Download PDF
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                        <tr>
                          <th scope="col" className="text-left px-5 py-3 font-semibold">Examination</th>
                          <th scope="col" className="text-left px-5 py-3">Date</th>
                          <th scope="col" className="text-left px-5 py-3">Score</th>
                          <th scope="col" className="text-left px-5 py-3">%</th>
                          <th scope="col" className="text-left px-5 py-3">Grade</th>
                          <th scope="col" className="text-right px-5 py-3">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r) => (
                          <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50/50">
                            <td className="px-5 py-3 font-medium text-stone-900 max-w-[220px] truncate" title={exams[r.examination_id]?.name || exams[r.examination_id]?.title || "Examination"}>
                              {exams[r.examination_id]?.name || exams[r.examination_id]?.title || "Examination"}
                            </td>
                            <td className="px-5 py-3 text-stone-500 whitespace-nowrap">
                              {exams[r.examination_id]?.exam_date ? moment(exams[r.examination_id].exam_date).format("DD MMM YYYY") : "-"}
                            </td>
                            <td className="px-5 py-3 whitespace-nowrap">{r.total_marks ?? r.marks ?? "—"} / {exams[r.examination_id]?.max_marks ?? "—"}</td>
                            <td className="px-5 py-3 font-semibold text-indigo-600 whitespace-nowrap">{r.percentage != null ? `${r.percentage.toFixed(1)}%` : "—"}</td>
                            <td className="px-5 py-3">{r.grade || "-"}</td>
                            <td className="px-5 py-3 text-right">
                              <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                                View Breakdown
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                icon={Award}
                title="No published results yet"
                description="Your examination scores and report cards will appear here once published."
              />
            )}
          </TabsContent>

          {/* TAB 2: MY ATTENDANCE */}
          <TabsContent value="attendance" className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-semibold text-stone-900">Attendance Log</h3>
                  <p className="text-xs text-stone-500">Daily presence recorded by class teachers</p>
                </div>
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  {attendanceMetrics.rate}% Cumulative Attendance
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2.5">Date</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-left px-4 py-2.5">Teacher Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {attendance.map((att) => (
                      <tr key={att.id} className="hover:bg-stone-50/50">
                        <td className="px-4 py-2.5 font-medium text-stone-800 text-xs">{moment(att.date).format("ddd, MMM D, YYYY")}</td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={
                              att.status === "present"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                                : att.status === "late"
                                ? "bg-amber-50 text-amber-700 border-amber-200 text-xs"
                                : "bg-rose-50 text-rose-700 border-rose-200 text-xs"
                            }
                          >
                            {att.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-stone-500">{att.remarks || "-"}</td>
                      </tr>
                    ))}
                    {attendance.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-stone-400 text-xs">
                          No attendance records found yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* TAB 3: EXAM SCHEDULE */}
          <TabsContent value="timetable" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {timetable.map((exam) => (
                <div key={exam.id} className="p-4 bg-white rounded-xl border border-stone-200 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold text-xs">
                      {exam.exam_date ? moment(exam.exam_date).format("ddd, MMM D YYYY") : "Not scheduled"}
                    </Badge>
                    {exam.session_label && (
                      <span className="text-xs text-stone-400 capitalize">{exam.session_label}</span>
                    )}
                  </div>
                  <div className="font-semibold text-stone-900 text-sm">{exam.name}</div>
                  <div className="text-xs text-stone-500">{exam.subject || ""}</div>
                  <div className="flex items-center justify-between text-xs text-stone-500 pt-2 border-t border-stone-100">
                    <span>{exam.start_time ? `${exam.start_time}${exam.end_time ? `–${exam.end_time}` : ""}` : "Time TBD"}</span>
                    {exam.venue && (
                      <span className="flex items-center gap-1 text-stone-400">
                        <MapPin className="w-3 h-3" /> {exam.venue}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {timetable.length === 0 && (
                <div className="col-span-full p-10 bg-white rounded-xl border border-dashed border-stone-200 text-center text-stone-400 text-xs">
                  No examinations scheduled for your class yet.
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 4: MY COURSEWORK / ASSIGNMENTS */}
          <TabsContent value="assignments" className="space-y-4">
            <div className="divide-y divide-stone-100 bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              {assignments.map((asg) => {
                const sub = subjects.find((s) => s.id === asg.subject_id);
                const submission = submissions.find((sm) => sm.assignment_id === asg.id);
                const isSubmitted = Boolean(submission);
                const isGraded = submission?.status === "graded";

                return (
                  <div key={asg.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-900 text-sm">{asg.title}</span>
                        {isGraded ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                            Graded: {submission.marks_obtained}/{asg.max_marks || 100}
                          </Badge>
                        ) : isSubmitted ? (
                          <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">Submitted</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Pending</Badge>
                        )}
                      </div>
                      <p className="text-xs text-stone-500 line-clamp-2">{asg.description}</p>
                      <div className="flex items-center gap-4 text-xs text-stone-400 pt-1">
                        <span>Subject: {sub?.name || "Academic"}</span>
                        <span>Due: {moment(asg.due_date).format("MMM D, YYYY [at] h:mm A")}</span>
                      </div>
                      {isGraded && submission.teacher_feedback && (
                        <div className="mt-2 p-2.5 bg-emerald-50/60 rounded-lg text-xs text-emerald-800 border border-emerald-100">
                          <span className="font-semibold block mb-0.5">Teacher Feedback:</span>
                          <p>{submission.teacher_feedback}</p>
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleOpenSubmit(asg)}
                      disabled={isGraded}
                      className={isSubmitted ? "bg-stone-100 text-stone-700 hover:bg-stone-200" : "bg-indigo-600 hover:bg-indigo-700 text-white"}
                      title={isGraded ? "This submission has been graded and cannot be updated" : undefined}
                    >
                      {isGraded ? "Graded" : isSubmitted ? "Update Submission" : "Submit Answer"}
                    </Button>
                  </div>
                );
              })}
              {assignments.length === 0 && (
                <div className="p-10 text-center text-stone-400 text-xs">
                  No active coursework assignments published for your class.
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 5: PROFILE */}
          <TabsContent value="profile" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
                <h3 className="font-heading font-semibold text-stone-900">Academic & Identity Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Full Name" value={student.full_name} />
                  <InfoRow label="Admission Number" value={student.admission_number} />
                  <InfoRow label="Roll Number" value={student.roll_number} />
                  <InfoRow label="Class" value={student.class_name || schoolClass?.name} />
                  <InfoRow label="Section" value={student.section || section?.name} />
                  <InfoRow label="Gender" value={student.gender} />
                  <InfoRow label="Date of Birth" value={student.date_of_birth || student.dob} />
                  <InfoRow label="Blood Group" value={student.blood_group} />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
                <h3 className="font-heading font-semibold text-stone-900">Contact & Institutional Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Student Email" value={student.student_email || user.email} />
                  <InfoRow label="Phone" value={student.phone || student.student_phone} />
                  <InfoRow label="Emergency Contact" value={student.emergency_contact || student.parent_phone} />
                  <InfoRow label="Status" value={student.status || "active"} />
                  <div className="col-span-2">
                    <InfoRow label="Residential Address" value={student.address} />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 6: MY CLASS */}
          <TabsContent value="class" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-3">
                <h3 className="font-heading font-semibold text-stone-900">Current Cohort</h3>
                <div className="space-y-2">
                  <p className="text-xl font-bold text-stone-900">
                    {student.class_name || schoolClass?.name || "Class"} {student.section || section?.name ? `- Section ${student.section || section?.name}` : ""}
                  </p>
                  {section?.room_number && (
                    <p className="text-xs text-stone-400">Homeroom: {section.room_number}</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-semibold text-stone-900">Classmates</h3>
                  <Badge variant="outline">{classmates.length} Peers</Badge>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {classmates.map((peer) => (
                    <div
                      key={peer.id}
                      className={`flex items-center justify-between p-2 rounded-lg text-xs ${
                        peer.id === student.id ? "bg-indigo-50 border border-indigo-200 font-medium" : "bg-stone-50 border border-stone-100"
                      }`}
                    >
                      <span className="text-stone-800">{peer.full_name} {peer.id === student.id ? "(You)" : ""}</span>
                      <span className="text-stone-400">Roll #{peer.roll_number || "-"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Submit Assignment Dialog */}
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Submit Coursework: {selectedAsg?.title}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitAnswer} className="space-y-4 pt-2">
            <div>
              <p className="text-xs text-stone-500 mb-2">{selectedAsg?.description}</p>
              <label className="text-xs font-semibold text-stone-700 block mb-1">Your Solution / Answer</label>
              <Textarea
                placeholder="Type your answer or paste your solution here..."
                value={submissionText}
                onChange={(e) => setSubmissionText(e.target.value)}
                rows={6}
                required
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSubmitDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {submitting ? "Uploading..." : "Submit Answer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ExamDetailedReport
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        result={detail}
        exam={detail ? exams[detail.examination_id] : null}
        previousResult={null}
        tenant={tenant}
      />
    </div>
  );
}
