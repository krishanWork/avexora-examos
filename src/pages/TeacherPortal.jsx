import React, { useEffect, useState } from "react";
import { useOutletContext, Link, useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import EmptyState from "@/components/shared/EmptyState";
import AnnouncementBanner from "@/components/announcements/AnnouncementBanner";
import ExamFormDialog from "@/components/exams/ExamFormDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/lib/statusTokens";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { logAudit } from "@/lib/audit";
import {
  GraduationCap, BookOpenCheck, Layers, Plus, Search, Building, CalendarCheck,
  Clock, FileText, MapPin, AlertTriangle
} from "lucide-react";
import TeacherExamsList from "@/components/teacher/TeacherExamsList";
import { DashboardSkeleton } from "@/components/shared/Skeletons";
import moment from "moment";

export default function TeacherPortal() {
  const { user, tenant } = useOutletContext() || {};
  const { toast } = useToast();
  const navigate = useNavigate();
  const [teacher, setTeacher] = useState(null);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [coursework, setCoursework] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [examDialogOpen, setExamDialogOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");

  const normEmail = (v) => String(v || "").trim().toLowerCase();

  const load = async () => {
    if (!user?.tenant_id || !user?.email) return;
    try {
      setLoading(true);
      const userEmail = normEmail(user.email);
      const teachers = await appClient.entities.Teacher.filter({ tenant_id: user.tenant_id, status: "active" }, "-created_date").catch(() => []);
      const t = teachers.find((x) => normEmail(x.email) === userEmail) || null;
      setTeacher(t);

      if (!t) {
        setClasses([]);
        setSections([]);
        setStudents([]);
        setExams([]);
        setAttendance([]);
        setTimetable([]);
        setCoursework([]);
        setSubmissions([]);
        return;
      }

      // Query server-authorized data directly.
      // Server readScope() enforces relationship-level security server-side.
      const [allClasses, allSections, authStudents, allExams, allAtt, ttRes, allCourse, allSubs] = await Promise.all([
        appClient.entities.SchoolClass.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Section.filter({ tenant_id: user.tenant_id }, "name").catch(() => []),
        appClient.entities.Student.filter({ tenant_id: user.tenant_id, status: "active" }).catch(() => []),
        appClient.entities.Examination.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
        appClient.entities.Attendance.filter({ tenant_id: user.tenant_id }, "-date").catch(() => []),
        appClient.functions.invoke("getExamTimetable", {}).catch(() => ({ data: { date_sheet: [] } })),
        appClient.entities.Assignment.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
        appClient.entities.AssignmentSubmission.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
      ]);

      setClasses(allClasses);
      setSections(allSections);
      setStudents(authStudents);
      setExams(allExams);
      setAttendance(allAtt);
      setTimetable(ttRes?.data?.date_sheet || ttRes?.data || []);
      setCoursework(allCourse);
      setSubmissions(allSubs);
    } catch (err) {
      console.error("Error loading teacher portal data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.tenant_id, user?.email]);

  const handleCreateExam = async (data) => {
    try {
      const created = await appClient.entities.Examination.create({
        ...data,
        tenant_id: user.tenant_id,
        created_by_id: user.id,
        created_by_name: teacher?.full_name || user.full_name,
        status: "draft",
      });
      await logAudit({
        user,
        tenant_id: user.tenant_id,
        action: "create",
        entity_type: "Examination",
        entity_id: created.id,
        details: `Created by teacher ${teacher?.full_name || user.full_name}`,
      });
      toast({ title: "Examination created", description: "Created in draft mode." });
      setExamDialogOpen(false);
      navigate(`/examinations/${created.id}`);
    } catch (err) {
      toast({ title: "Failed to create exam", description: err.message, variant: "destructive" });
    }
  };

  // The server scopes everything on this page to the teacher's assigned
  // classes, so "0 students" is almost always a missing assignment rather than
  // an empty class. Detect that explicitly instead of showing a bare zero.
  const hasAssignedClasses = Boolean(
    teacher && (
      (Array.isArray(teacher.assigned_class_ids) && teacher.assigned_class_ids.length) ||
      (Array.isArray(teacher.assigned_classes) && teacher.assigned_classes.length) ||
      (Array.isArray(classes) && classes.length)
    )
  );

  const filteredStudents = students.filter(
    (s) =>
      !studentSearch ||
      s.full_name?.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.admission_number?.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.class_name?.toLowerCase().includes(studentSearch.toLowerCase())
  );

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!teacher) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-4">
        <AnnouncementBanner userId={user?.id} tenantId={user?.tenant_id} />
        <EmptyState
          icon={GraduationCap}
          title="Teacher profile not linked"
          description="Your login email is not linked to an active Teacher profile in this school. Please contact your school administrator to configure your teacher account and class assignments."
        />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <AnnouncementBanner userId={user?.id} tenantId={user?.tenant_id} />

      {!hasAssignedClasses && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">No classes are assigned to you yet</p>
            <p className="mt-0.5 text-amber-800">
              Your portal only shows students, attendance and exams for the classes assigned to your teacher
              profile — that is why every count below is 0. Ask your school administrator to set your assigned
              classes under Staff &rarr; Teachers.
            </p>
          </div>
        </div>
      )}

      <PageHeader
        title={`Welcome, ${teacher?.full_name || user?.full_name || "Teacher"}`}
        description={`${tenant?.name || "School"} Faculty Portal · Academic Operations & Instruction`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5">
              <Link to="/attendance">
                <CalendarCheck className="w-3.5 h-3.5" /> Mark Attendance
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="text-xs gap-1.5">
              <Link to="/timetable">
                <Clock className="w-3.5 h-3.5 text-indigo-600" /> Exam Schedule
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="text-xs gap-1.5">
              <Link to="/assignments">
                <FileText className="w-3.5 h-3.5 text-indigo-600" /> Coursework
              </Link>
            </Button>
            <Button onClick={() => setExamDialogOpen(true)} size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Create Exam
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Assigned Classes" value={classes.length} icon={Layers} accent="text-indigo-600" />
        <StatCard label="Assigned Sections" value={sections.length} icon={Building} accent="text-indigo-600" />
        <StatCard label="My Students" value={students.length} icon={GraduationCap} accent="text-emerald-600" />
        <StatCard label="Scheduled Exams" value={timetable.length} icon={Clock} accent="text-purple-600" />
        <StatCard label="Assignments" value={coursework.length} icon={FileText} accent="text-sky-600" />
        <StatCard label="Examinations" value={exams.length} icon={BookOpenCheck} accent="text-amber-600" />
      </div>

      <Tabs defaultValue="classes" className="space-y-4">
        <TabsList className="bg-stone-100 p-1 rounded-xl flex-wrap">
          <TabsTrigger value="classes" className="rounded-lg text-xs font-semibold px-3 py-1.5">
            <Layers className="w-3.5 h-3.5 mr-1" /> Classes ({classes.length})
          </TabsTrigger>
          <TabsTrigger value="students" className="rounded-lg text-xs font-semibold px-3 py-1.5">
            <GraduationCap className="w-3.5 h-3.5 mr-1" /> Students ({students.length})
          </TabsTrigger>
          <TabsTrigger value="attendance" className="rounded-lg text-xs font-semibold px-3 py-1.5">
            <CalendarCheck className="w-3.5 h-3.5 mr-1" /> Attendance ({attendance.length})
          </TabsTrigger>
          <TabsTrigger value="timetable" className="rounded-lg text-xs font-semibold px-3 py-1.5">
            <Clock className="w-3.5 h-3.5 mr-1" /> My Schedule ({timetable.length})
          </TabsTrigger>
          <TabsTrigger value="assignments" className="rounded-lg text-xs font-semibold px-3 py-1.5">
            <FileText className="w-3.5 h-3.5 mr-1" /> Assignments ({coursework.length})
          </TabsTrigger>
          <TabsTrigger value="exams" className="rounded-lg text-xs font-semibold px-3 py-1.5">
            <BookOpenCheck className="w-3.5 h-3.5 mr-1" /> Examinations ({exams.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: MY CLASSES */}
        <TabsContent value="classes" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => {
              const classSections = sections.filter((sec) => sec.school_class_id === cls.id);
              const classStudents = students.filter((s) => s.school_class_id === cls.id || s.class_name === cls.name);
              return (
                <div key={cls.id} className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-heading font-bold text-stone-900 text-lg">{cls.name}</h4>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {classStudents.length} Authorized Student{classStudents.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Badge className="bg-indigo-100 text-indigo-700">Assigned</Badge>
                  </div>

                  <div className="pt-2 border-t border-stone-100">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">Sections</p>
                    <div className="flex flex-wrap gap-1.5">
                      {classSections.map((sec) => {
                        const secCount = students.filter(
                          (s) => (s.section_id === sec.id || s.section === sec.name) && (s.school_class_id === cls.id || s.class_name === cls.name)
                        ).length;
                        return (
                          <span key={sec.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200 text-xs font-medium text-stone-800">
                            <span>Section {sec.name}</span>
                            <span className="text-stone-400">({secCount})</span>
                          </span>
                        );
                      })}
                      {classSections.length === 0 && (
                        <span className="text-xs text-stone-400 italic">No sections configured</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {classes.length === 0 && (
              <div className="col-span-full bg-white border border-dashed border-stone-200 rounded-2xl p-10 text-center text-stone-500">
                No classes currently assigned to your teacher profile.
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: MY STUDENTS */}
        <TabsContent value="students" className="space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-stone-100 flex items-center justify-between gap-4">
              <div className="relative max-w-sm w-full">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
                <Input
                  placeholder="Search students in assigned classes..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="pl-9 text-xs"
                />
              </div>
              <span className="text-xs text-stone-500 font-medium">
                {filteredStudents.length} server-authorized student{filteredStudents.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                  <tr>
                    <th scope="col" className="text-left px-5 py-3">Student</th>
                    <th scope="col" className="text-left px-5 py-3">Admission No.</th>
                    <th scope="col" className="text-left px-5 py-3">Class & Section</th>
                    <th scope="col" className="text-left px-5 py-3">Roll No.</th>
                    <th scope="col" className="text-left px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr key={s.id} className="border-t border-stone-100 hover:bg-stone-50/50">
                      <td className="px-5 py-3">
                        <Link to={`/students/${s.id}`} className="font-medium text-indigo-600 hover:underline">
                          {s.full_name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-stone-500">{s.admission_number || "-"}</td>
                      <td className="px-5 py-3">
                        {s.class_name || "-"} {s.section ? `(${s.section})` : ""}
                      </td>
                      <td className="px-5 py-3">{s.roll_number || "-"}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={s.status || "active"} type="student" />
                      </td>
                    </tr>
                  ))}
                  {filteredStudents.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-stone-400">
                        No server-authorized students match your query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: ATTENDANCE RECENT LOGS */}
        <TabsContent value="attendance" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500 font-medium">Recent attendance marked for your assigned classes</p>
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5">
              <Link to="/attendance">
                <CalendarCheck className="w-3.5 h-3.5" /> Full Attendance Roster
              </Link>
            </Button>
          </div>
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                  <tr>
                    <th scope="col" className="text-left px-5 py-3">Date</th>
                    <th scope="col" className="text-left px-5 py-3">Student</th>
                    <th scope="col" className="text-left px-5 py-3">Status</th>
                    <th scope="col" className="text-left px-5 py-3">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {attendance.slice(0, 10).map((att) => {
                    const student = students.find((st) => st.id === att.student_id);
                    return (
                      <tr key={att.id} className="hover:bg-stone-50/50">
                        <td className="px-5 py-3 text-stone-600 font-medium text-xs">{moment(att.date).format("MMM D, YYYY")}</td>
                        <td className="px-5 py-3 font-medium text-stone-900">{student?.full_name || att.student_name || "Student"}</td>
                        <td className="px-5 py-3">
                          <StatusBadge status={att.status} type="attendance" />
                        </td>
                        <td className="px-5 py-3 text-stone-500 text-xs">{att.remarks || "-"}</td>
                      </tr>
                    );
                  })}
                  {attendance.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-stone-400">
                        No attendance records recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 4: EXAM SCHEDULE */}
        <TabsContent value="timetable" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500 font-medium">Examination schedule for your assigned classes</p>
            <Button asChild size="sm" variant="outline" className="text-xs gap-1.5">
              <Link to="/timetable">
                <Clock className="w-3.5 h-3.5 text-indigo-600" /> Full Exam Date Sheet
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {timetable.map((exam) => (
              <div key={exam.id} className="p-4 bg-white rounded-xl border border-stone-200 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold">
                    {exam.exam_date ? moment(exam.exam_date).format("ddd, MMM D YYYY") : "Not scheduled"}
                  </Badge>
                  {exam.session_label && (
                    <span className="text-xs text-stone-400 capitalize">{exam.session_label}</span>
                  )}
                </div>
                <div className="font-semibold text-stone-900 text-sm">{exam.name}</div>
                <div className="text-xs text-stone-500">{exam.subject || ""}</div>
                <div className="flex items-center justify-between text-xs text-stone-500 pt-1 border-t border-stone-100">
                  <span>{exam.class_names.join(", ") || "Class"}</span>
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
                No examinations scheduled for your assigned classes.
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 5: ASSIGNMENTS */}
        <TabsContent value="assignments" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-stone-500 font-medium">Coursework & student submissions</p>
            <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5">
              <Link to="/assignments">
                <FileText className="w-3.5 h-3.5" /> Manage Assignments
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {coursework.map((asg) => {
              const cls = classes.find((c) => c.id === asg.school_class_id);
              const asgSubs = submissions.filter((s) => s.assignment_id === asg.id);
              return (
                <div key={asg.id} className="p-4 bg-white rounded-xl border border-stone-200 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-900 text-sm truncate">{asg.title}</span>
                    <Badge variant="outline" className="text-xs capitalize">{asg.status || "published"}</Badge>
                  </div>
                  <p className="text-xs text-stone-500 line-clamp-2">{asg.description || "No description."}</p>
                  <div className="flex items-center justify-between text-xs text-stone-400 pt-2 border-t border-stone-100">
                    <span>{cls?.name || "Class"}</span>
                    <span>{asgSubs.length} Submissions</span>
                  </div>
                </div>
              );
            })}
            {coursework.length === 0 && (
              <div className="col-span-full p-10 bg-white rounded-xl border border-dashed border-stone-200 text-center text-stone-400 text-xs">
                No assignments created yet.
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 6: EXAMINATIONS */}
        <TabsContent value="exams" className="space-y-4">
          <TeacherExamsList exams={exams} onNewExam={() => setExamDialogOpen(true)} />
        </TabsContent>
      </Tabs>

      <ExamFormDialog
        open={examDialogOpen}
        onOpenChange={setExamDialogOpen}
        onSave={handleCreateExam}
        exam={null}
        tenantId={user?.tenant_id}
      />
    </div>
  );
}