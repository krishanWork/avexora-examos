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
import {
  Users, Trophy, FileDown, LogOut, Award, User,
  BookOpen, GraduationCap, CalendarCheck, Clock, FileText,
  MapPin
} from "lucide-react";
import moment from "moment";

const InfoRow = ({ label, value }) => (
  <div>
    <p className="text-xs text-stone-400 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-medium text-stone-800 mt-0.5">{value || "-"}</p>
  </div>
);

export default function ParentPortal() {
  const { user } = useCurrentUser();
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  // Selected child specific data
  const [results, setResults] = useState([]);
  const [exams, setExams] = useState({});
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [coursework, setCoursework] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [schoolClass, setSchoolClass] = useState(null);
  const [section, setSection] = useState(null);
  const [detail, setDetail] = useState(null);

  // Load parent's authorized children on mount
  useEffect(() => {
    const loadParent = async () => {
      if (!user) return;
      try {
        setLoading(true);
        // Link account to Parent / ParentStudent records
        await appClient.functions.invoke("linkMyAccount", {}).catch(() => ({}));

        // Query server-authorized student records
        // Server readScope() guarantees Parent only gets linked children
        const kids = await appClient.entities.Student.filter({ tenant_id: user.tenant_id }).catch(() => []);
        setChildren(kids);

        if (kids.length > 0) {
          setSelectedChildId(kids[0].id);
          const tRes = await appClient.functions.invoke("getMyTenant", { tenant_id: kids[0].tenant_id }).catch(() => ({ data: {} }));
          setTenant(tRes.data?.tenant || null);
        }
      } catch (err) {
        console.error("Failed to load parent portal data:", err);
      } finally {
        setLoading(false);
      }
    };
    loadParent();
  }, [user]);

  // Load selected child's details whenever selectedChildId changes
  useEffect(() => {
    if (!selectedChildId) return;
    const selected = children.find((c) => c.id === selectedChildId);
    if (!selected) return;

    const loadChildData = async () => {
      try {
        const [resList, allExams, subList, tList, aList, attList, ttRes, courseList, submsList] = await Promise.all([
          appClient.entities.Result.filter({ student_id: selected.id, status: "published" }, "-created_date").catch(() => []),
          appClient.entities.Examination.filter({ tenant_id: selected.tenant_id }, "-created_date").catch(() => []),
          appClient.entities.Subject.filter({ tenant_id: selected.tenant_id }).catch(() => []),
          appClient.entities.Teacher.filter({ tenant_id: selected.tenant_id }).catch(() => []),
          appClient.entities.TeacherAssignment.filter({ tenant_id: selected.tenant_id }).catch(() => []),
          appClient.entities.Attendance.filter({ student_id: selected.id }, "-date").catch(() => []),
          appClient.functions.invoke("getExamTimetable", {}).catch(() => ({ data: { date_sheet: [] } })),
          appClient.entities.Assignment.filter({ tenant_id: selected.tenant_id, status: "published" }, "-created_date").catch(() => []),
          appClient.entities.AssignmentSubmission.filter({ student_id: selected.id }, "-created_date").catch(() => []),
        ]);

        setResults(resList);
        setSubjects(subList);
        setTeachers(tList);
        setAssignments(aList);
        setAttendance(attList);
        setTimetable(ttRes?.data?.date_sheet || ttRes?.data || []);
        setCoursework(courseList);
        setSubmissions(submsList);

        const examMap = {};
        allExams.forEach((e) => { examMap[e.id] = e; });
        setExams(examMap);

        if (selected.school_class_id) {
          appClient.entities.SchoolClass.get(selected.school_class_id).then(setSchoolClass).catch(() => setSchoolClass(null));
        } else {
          setSchoolClass(null);
        }

        if (selected.section_id) {
          appClient.entities.Section.get(selected.section_id).then(setSection).catch(() => setSection(null));
        } else {
          setSection(null);
        }
      } catch (err) {
        console.error("Failed to load child specific data:", err);
      }
    };
    loadChildData();
  }, [selectedChildId, children]);

  const selectedChild = children.find((c) => c.id === selectedChildId);

  const handleDownloadReportCard = async () => {
    if (!selectedChild) return;
    const url = await generateReportCardPDF({
      tenant,
      student: selectedChild,
      results: results.map((r) => ({ ...r, examName: exams[r.examination_id]?.name || exams[r.examination_id]?.title })),
    });
    window.open(url, "_blank");
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

  const courseworkDueCount = useMemo(() => {
    return coursework.filter((c) => !submissions.some((s) => s.assignment_id === c.id && s.status === "submitted")).length;
  }, [coursework, submissions]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-2 text-stone-500 text-sm">
          <div className="w-5 h-5 border-2 border-stone-300 border-t-indigo-600 rounded-full animate-spin"></div>
          Loading parent portal...
        </div>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="font-heading font-bold text-stone-900 text-lg">No Linked Student Profiles</h2>
          <p className="text-xs text-stone-500">
            No children are currently linked to this parent account ({user?.email}). Please contact your school administration with your email address to establish student-parent relationship records.
          </p>
          <Button onClick={() => appClient.auth.logout("/login")} variant="outline" size="sm" className="w-full">
            <LogOut className="w-4 h-4 mr-2" /> Log Out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 pb-12">
      <ImpersonationBanner />
      <PortalHeader
        tenant={tenant}
        user={user}
        title={tenant?.name || "Parent Portal"}
        subtitle={`Guardian Oversight * ${user.full_name || user.email}`}
        onLogout={() => appClient.auth.logout("/login")}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <AnnouncementBanner userId={user?.id} tenantId={user?.tenant_id} />
        {/* Child Selection Bar */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-indigo-600" />
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">Enrolled Children:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => setSelectedChildId(child.id)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                  selectedChildId === child.id
                    ? "bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600/20"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200/80"
                }`}
              >
                <span>{child.full_name}</span>
                <span className={selectedChildId === child.id ? "text-indigo-200 text-[11px]" : "text-stone-400 text-[11px]"}>
                  ({child.class_name || "Student"})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Child Header */}
        {selectedChild && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-heading font-bold text-stone-900">{selectedChild.full_name}</h1>
              <p className="text-sm text-stone-500">
                {selectedChild.class_name || schoolClass?.name || "Class"} {selectedChild.section || section?.name ? `(${selectedChild.section || section?.name})` : ""} * Adm No. {selectedChild.admission_number || "-"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleDownloadReportCard} disabled={results.length === 0}>
              <FileDown className="w-4 h-4 mr-1.5" /> Official Report Card
            </Button>
          </div>
        )}

        {/* KPI Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Overall Average" value={`${avgPercentage}%`} icon={Award} accent="text-indigo-600" />
          <StatCard label="Top Score" value={`${Math.round(bestScore)}%`} icon={Trophy} accent="text-amber-500" />
          <StatCard label="Attendance Rate" value={`${attendanceMetrics.rate}%`} icon={CalendarCheck} accent="text-emerald-600" />
          <StatCard label="Coursework Due" value={courseworkDueCount} icon={FileText} accent="text-purple-600" />
        </div>

        {/* Child Profile & Academics Tabs */}
        <Tabs defaultValue="progress" className="space-y-4">
          <TabsList className="bg-white border border-stone-200 p-1 rounded-xl flex-wrap">
            <TabsTrigger value="progress" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <Trophy className="w-3.5 h-3.5 mr-1" /> Academic Progress ({results.length})
            </TabsTrigger>
            <TabsTrigger value="attendance" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <CalendarCheck className="w-3.5 h-3.5 mr-1" /> Attendance ({attendanceMetrics.rate}%)
            </TabsTrigger>
            <TabsTrigger value="timetable" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <Clock className="w-3.5 h-3.5 mr-1" /> My Exam Schedule
            </TabsTrigger>
            <TabsTrigger value="assignments" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <FileText className="w-3.5 h-3.5 mr-1" /> Coursework ({coursework.length})
            </TabsTrigger>
            <TabsTrigger value="identity" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <User className="w-3.5 h-3.5 mr-1" /> Child Profile
            </TabsTrigger>
            <TabsTrigger value="courses" className="rounded-lg text-xs font-semibold px-3 py-1.5">
              <BookOpen className="w-3.5 h-3.5 mr-1" /> Subjects & Faculty ({subjects.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: ACADEMIC PROGRESS */}
          <TabsContent value="progress" className="space-y-6">
            {results.length > 0 ? (
              <>
                <PerformanceTrend data={trendData} />
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
                    <h3 className="font-heading font-semibold text-stone-900">Examination Results</h3>
                    <span className="text-xs text-stone-500 font-medium">{results.length} published record{results.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                        <tr>
                          <th scope="col" className="text-left px-5 py-3">Examination</th>
                          <th scope="col" className="text-left px-5 py-3">Date</th>
                          <th scope="col" className="text-left px-5 py-3">Marks</th>
                          <th scope="col" className="text-left px-5 py-3">%</th>
                          <th scope="col" className="text-left px-5 py-3">Grade</th>
                          <th scope="col" className="text-right px-5 py-3">Report</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r) => (
                          <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50/50">
                            <td className="px-5 py-3 font-medium text-stone-900">
                              {exams[r.examination_id]?.name || exams[r.examination_id]?.title || "Exam"}
                            </td>
                            <td className="px-5 py-3 text-stone-500">
                              {exams[r.examination_id]?.exam_date ? moment(exams[r.examination_id].exam_date).format("DD MMM YYYY") : "-"}
                            </td>
                            <td className="px-5 py-3">{r.total_marks || r.marks} / {exams[r.examination_id]?.max_marks || "-"}</td>
                            <td className="px-5 py-3 font-semibold text-indigo-600">{r.percentage?.toFixed(1)}%</td>
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
                description="Your child's examination scores and report cards will appear here once published."
              />
            )}
          </TabsContent>

          {/* TAB 2: ATTENDANCE */}
          <TabsContent value="attendance" className="space-y-4">
            <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading font-semibold text-stone-900">Daily Attendance History</h3>
                  <p className="text-xs text-stone-500">Attendance records submitted by class faculty</p>
                </div>
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold">
                  {attendanceMetrics.rate}% Cumulative Attendance
                </Badge>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-2.5">Date</th>
                      <th className="text-left px-4 py-2.5">Status</th>
                      <th className="text-left px-4 py-2.5">Remarks</th>
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
                          No attendance records found for this student.
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
                  No examinations scheduled for this class yet.
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 4: COURSEWORK / ASSIGNMENTS */}
          <TabsContent value="assignments" className="space-y-4">
            <div className="divide-y divide-stone-100 bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              {coursework.map((asg) => {
                const sub = subjects.find((s) => s.id === asg.subject_id);
                const submission = submissions.find((sm) => sm.assignment_id === asg.id);
                const isSubmitted = Boolean(submission);
                const isGraded = submission?.status === "graded";

                return (
                  <div key={asg.id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-900 text-sm">{asg.title}</span>
                        {isGraded ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                            Graded: {submission.marks_obtained}/{asg.max_marks || 100}
                          </Badge>
                        ) : isSubmitted ? (
                          <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">Submitted</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Pending Submission</Badge>
                        )}
                      </div>
                      <span className="text-xs text-stone-400">Due: {moment(asg.due_date).format("MMM D, YYYY")}</span>
                    </div>

                    <p className="text-xs text-stone-500">{asg.description}</p>

                    <div className="text-xs text-stone-400">Subject: {sub?.name || "Academic"}</div>

                    {isGraded && submission.teacher_feedback && (
                      <div className="mt-2 p-2.5 bg-emerald-50/60 rounded-lg text-xs text-emerald-800 border border-emerald-100">
                        <span className="font-semibold block mb-0.5">Teacher Feedback:</span>
                        <p>{submission.teacher_feedback}</p>
                      </div>
                    )}
                  </div>
                );
              })}
              {coursework.length === 0 && (
                <div className="p-10 text-center text-stone-400 text-xs">
                  No active coursework assignments published for this class.
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 5: CHILD PROFILE */}
          <TabsContent value="identity" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
                <h3 className="font-heading font-semibold text-stone-900">Student Profile Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Full Name" value={selectedChild.full_name} />
                  <InfoRow label="Admission Number" value={selectedChild.admission_number} />
                  <InfoRow label="Roll Number" value={selectedChild.roll_number} />
                  <InfoRow label="Class" value={selectedChild.class_name || schoolClass?.name} />
                  <InfoRow label="Section" value={selectedChild.section || section?.name} />
                  <InfoRow label="Date of Birth" value={selectedChild.date_of_birth || selectedChild.dob} />
                  <InfoRow label="Blood Group" value={selectedChild.blood_group} />
                  <InfoRow label="Status" value={selectedChild.status || "active"} />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
                <h3 className="font-heading font-semibold text-stone-900">Institutional & Contact Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Student Email" value={selectedChild.student_email} />
                  <InfoRow label="Primary Parent Email" value={selectedChild.parent_email || user.email} />
                  <InfoRow label="Emergency Phone" value={selectedChild.emergency_contact || selectedChild.parent_phone} />
                  <InfoRow label="Homeroom Location" value={section?.room_number || "Main Campus"} />
                  <div className="col-span-2">
                    <InfoRow label="Registered Residence" value={selectedChild.address} />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 6: COURSES */}
          <TabsContent value="courses" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {subjects.map((sub) => {
                const subAssigns = assignments.filter((a) => a.subject_id === sub.id);
                const subTeacherIds = new Set(subAssigns.map((a) => a.teacher_id));
                const subTeachers = teachers.filter((t) => subTeacherIds.has(t.id));
                return (
                  <div key={sub.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-heading font-bold text-stone-900 text-base">{sub.name}</h4>
                        <p className="text-xs text-stone-400">Code: {sub.code || "N/A"}</p>
                      </div>
                      <Badge variant="outline">{sub.category || "Core"}</Badge>
                    </div>
                    <div className="pt-2 border-t border-stone-100 text-xs text-stone-500">
                      <p>Faculty: {subTeachers.map((t) => t.full_name).join(", ") || "Academic Faculty"}</p>
                    </div>
                  </div>
                );
              })}
              {subjects.length === 0 && (
                <div className="col-span-full bg-white border border-dashed border-stone-200 rounded-2xl p-8 text-center text-stone-400 text-sm">
                  No courses currently configured for this child's class.
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

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
