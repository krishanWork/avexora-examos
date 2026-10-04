import React, { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import { ErrorCard, DetailSkeleton } from "@/components/shared/Skeletons";
import StudentResultsChart from "@/components/students/StudentResultsChart";
import ExamDetailedReport from "@/components/portal/ExamDetailedReport";
import { generateReportCardPDF } from "@/lib/generateReportCardPDF";
import { getAppRole, APP_ROLES } from "@/lib/roles";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/statusTokens";
import {
  ArrowLeft, GraduationCap, Eye, FileDown, User,
  Calendar, Users, Award, Phone
} from "lucide-react";
import moment from "moment";

const InfoRow = ({ label, value }) => (
  <div>
    <p className="text-xs text-stone-400 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-medium text-stone-800 mt-0.5">{value || "-"}</p>
  </div>
);

export default function StudentDetail() {
  const { id } = useParams();
  const { user } = useOutletContext() || {};
  const [student, setStudent] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [rows, setRows] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [parentLinks, setParentLinks] = useState([]);
  const [parents, setParents] = useState({});
  const [academicYears, setAcademicYears] = useState({});
  const [classes, setClasses] = useState({});
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  // A teacher sees the academic record only. Guardian identity and the
  // home/contact card are withheld: the server denies ParentStudent/Parent reads
  // for teachers (readScope falls through to deny), so querying them would only
  // render a false "no guardians linked" empty state.
  // The PRIMARY role, not "holds teacher". This flag is a scope decision: it
  // suppresses the guardian reads the server denies and picks where the Back link
  // goes. A teacher who is primarily an exam coordinator is not held to the
  // teacher read boundary, so they take the full record view.
  const isTeacher = getAppRole(user) === APP_ROLES.TEACHER;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await appClient.entities.Student.get(id);
      const [
        results,
        exams,
        t,
        enrollList,
        pLinks,
        allParents,
        allYears,
        allClasses,
        allSections,
      ] = await Promise.all([
        appClient.entities.Result.filter({ student_id: id }, "-created_date", 500).catch(() => []),
        appClient.entities.Examination.filter({ tenant_id: s.tenant_id }, "exam_date", 1000).catch(() => []),
        appClient.entities.Tenant.get(s.tenant_id).catch(() => null),
        appClient.entities.Enrollment.filter({ student_id: id }, "-enrollment_date").catch(() => []),
        isTeacher ? Promise.resolve([]) : appClient.entities.ParentStudent.filter({ student_id: id }).catch(() => []),
        isTeacher ? Promise.resolve([]) : appClient.entities.Parent.filter({ tenant_id: s.tenant_id }).catch(() => []),
        appClient.entities.AcademicYear.filter({ tenant_id: s.tenant_id }).catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: s.tenant_id }).catch(() => []),
        appClient.entities.Section.filter({ tenant_id: s.tenant_id }).catch(() => []),
      ]);

      setTenant(t);
      setStudent(s);
      setEnrollments(enrollList);
      setParentLinks(pLinks);
      setParents(Object.fromEntries(allParents.map((p) => [p.id, p])));
      setAcademicYears(Object.fromEntries(allYears.map((y) => [y.id, y])));
      setClasses(Object.fromEntries(allClasses.map((c) => [c.id, c])));
      setSections(Object.fromEntries(allSections.map((sec) => [sec.id, sec])));

      const examById = Object.fromEntries(exams.map((e) => [e.id, e]));
      const merged = results
        .map((r) => ({ ...r, exam: examById[r.examination_id] }))
        .filter((r) => r.exam)
        .sort((a, b) => new Date(a.exam.exam_date || a.exam.created_date) - new Date(b.exam.exam_date || b.exam.created_date));

      setRows(merged);
    } catch (err) {
      setError(err);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id, isTeacher]);

  // Teachers cannot reach /students (the roster admin page is gated to
  // manage_students roles), so send them back to their own portal instead.
  const backTo = isTeacher ? "/teacher-portal" : "/students";
  const backLabel = isTeacher ? "Back to My Portal" : "Back to Students";

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <DetailSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-8">
        <ErrorCard message={error.message || "Failed to load student"} onRetry={load} />
        <Link to={backTo} className="text-indigo-600 text-sm">← {backLabel}</Link>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-stone-500">Student not found.</p>
        <Link to={backTo} className="text-indigo-600 text-sm">← {backLabel}</Link>
      </div>
    );
  }

  const chartData = rows.map((r) => ({ name: r.exam.name, percentage: Math.round(r.percentage ?? 0) }));
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + (r.percentage || 0), 0) / rows.length) : null;
  const best = rows.length ? Math.max(...rows.map((r) => r.percentage || 0)) : null;

  const prevFor = (r) => {
    const i = rows.findIndex((x) => x.id === r.id);
    const p = i > 0 ? rows[i - 1] : null;
    return p ? { ...p, examName: p.exam.name } : null;
  };

  const handleDownload = async () => {
    const url = await generateReportCardPDF({
      tenant,
      student,
      results: [...rows].reverse().map((r) => ({ ...r, examName: r.exam.name })),
    });
    window.open(url, "_blank");
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800">
        <ArrowLeft className="w-4 h-4" /> {backLabel}
      </Link>

      <PageHeader
        title={student.full_name}
        description={`${student.class_name || ""} ${student.section ? `(${student.section})` : ""} · Admission No. ${student.admission_number || "-"}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={student.status || "active"} type="student" />
          </div>
        }
      />

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="bg-stone-100 p-1 rounded-xl">
          <TabsTrigger value="profile" className="rounded-lg text-xs font-semibold px-4 py-2">
            <User className="w-3.5 h-3.5 mr-1.5" /> Profile & Identity
          </TabsTrigger>
          <TabsTrigger value="enrollment" className="rounded-lg text-xs font-semibold px-4 py-2">
            <Calendar className="w-3.5 h-3.5 mr-1.5" /> Enrollment History ({enrollments.length})
          </TabsTrigger>
          {!isTeacher && (
            <TabsTrigger value="parents" className="rounded-lg text-xs font-semibold px-4 py-2">
              <Users className="w-3.5 h-3.5 mr-1.5" /> Linked Parents ({parentLinks.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="exams" className="rounded-lg text-xs font-semibold px-4 py-2">
            <Award className="w-3.5 h-3.5 mr-1.5" /> Examinations & OMR ({rows.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: PROFILE / IDENTITY */}
        <TabsContent value="profile" className="space-y-6">
          <div className={`grid grid-cols-1 gap-6 ${isTeacher ? "" : "md:grid-cols-2"}`}>
            {/* Identity Card */}
            <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
              <h3 className="font-heading font-semibold text-stone-900 flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-indigo-600" /> Identity & Academic Info
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <InfoRow label="Full Name" value={student.full_name} />
                <InfoRow label="Admission Number" value={student.admission_number} />
                <InfoRow label="Current Roll No" value={student.roll_number} />
                <InfoRow label="Current Class" value={student.class_name} />
                <InfoRow label="Current Section" value={student.section} />
                <InfoRow label="Batch" value={student.batch} />
                <InfoRow label="Gender" value={student.gender} />
                <InfoRow label="Date of Birth" value={student.date_of_birth || (student.dob ? moment(student.dob).format("DD MMM YYYY") : null)} />
                {!isTeacher && <InfoRow label="Blood Group" value={student.blood_group} />}
                <InfoRow label="Category" value={student.category} />
              </div>
            </div>

            {/* Contact & Address Card — withheld from teachers: home address,
                guardian contacts and documents are not needed to teach. */}
            {!isTeacher && (
            <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
              <h3 className="font-heading font-semibold text-stone-900 flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-600" /> Contact & Emergency
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <InfoRow label="Student Email" value={student.student_email} />
                <InfoRow label="Student Phone" value={student.phone || student.student_phone} />
                <InfoRow label="Emergency Contact" value={student.emergency_contact || student.parent_phone} />
                <InfoRow label="Legacy Parent Contact" value={student.parent_name ? `${student.parent_name} (${student.parent_phone || ""})` : null} />
                <div className="col-span-2">
                  <InfoRow label="Residential Address" value={student.address} />
                </div>
                <div className="col-span-2">
                  <InfoRow label="Documents" value={student.documents ? JSON.stringify(student.documents) : "No attached documents"} />
                </div>
              </div>
            </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: ENROLLMENT HISTORY */}
        <TabsContent value="enrollment" className="space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <div>
                <h3 className="font-heading font-semibold text-stone-900">Academic Progression History</h3>
                <p className="text-xs text-stone-500">Historical records of academic years and section promotions.</p>
              </div>
              <Badge variant="outline" className="text-xs">{enrollments.length} Record{enrollments.length !== 1 ? "s" : ""}</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                  <tr>
                    <th scope="col" className="text-left px-5 py-3">Academic Year</th>
                    <th scope="col" className="text-left px-5 py-3">Class</th>
                    <th scope="col" className="text-left px-5 py-3">Section</th>
                    <th scope="col" className="text-left px-5 py-3">Roll Number</th>
                    <th scope="col" className="text-left px-5 py-3">Enrollment Date</th>
                    <th scope="col" className="text-left px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((en) => {
                    const yr = academicYears[en.academic_year_id];
                    const cls = classes[en.school_class_id];
                    const sec = sections[en.section_id];
                    return (
                      <tr key={en.id} className="border-t border-stone-100">
                        <td className="px-5 py-3 font-medium text-stone-900">
                          {yr?.name || "Academic Year"}
                          {yr?.is_current && <Badge className="ml-2 text-[11px] bg-indigo-100 text-indigo-700">Current</Badge>}
                        </td>
                        <td className="px-5 py-3">{cls?.name || en.school_class_id}</td>
                        <td className="px-5 py-3">{sec?.name ? `Section ${sec.name}` : "-"}</td>
                        <td className="px-5 py-3">{en.roll_number || "-"}</td>
                        <td className="px-5 py-3 text-stone-500">{en.enrollment_date || "-"}</td>
                        <td className="px-5 py-3">
                          <StatusBadge status={en.status || "enrolled"} type="enrollment" />
                        </td>
                      </tr>
                    );
                  })}
                  {enrollments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-stone-400">
                        No enrollment history found for this student.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: LINKED PARENTS — hidden for teachers (no server read grant) */}
        {!isTeacher && (
        <TabsContent value="parents" className="space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
              <div>
                <h3 className="font-heading font-semibold text-stone-900">Parents & Legal Guardians</h3>
                <p className="text-xs text-stone-500">Authorized guardians linked via canonical ParentStudent relationships.</p>
              </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {parentLinks.map((link) => {
                const parent = parents[link.parent_id];
                return (
                  <div key={link.id} className="p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-stone-900">{parent?.full_name || "Guardian"}</h4>
                        <p className="text-xs text-stone-500 capitalize">{link.relationship || "Guardian"}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {link.is_primary && (
                          <Badge className="bg-indigo-100 text-indigo-700 text-[11px]">Primary</Badge>
                        )}
                        {link.is_emergency_contact && (
                          <Badge className="bg-red-100 text-red-700 text-[11px]">Emergency</Badge>
                        )}
                      </div>
                    </div>

                    <div className="text-xs space-y-1 text-stone-600 pt-2 border-t border-stone-200">
                      <p><span className="text-stone-400">Email:</span> {parent?.email || "-"}</p>
                      <p><span className="text-stone-400">Phone:</span> {parent?.phone || "-"}</p>
                      <p><span className="text-stone-400">Pickup Authorized:</span> {link.can_pickup ? "Yes" : "No"}</p>
                    </div>
                  </div>
                );
              })}
              {parentLinks.length === 0 && (
                <div className="col-span-2 text-center py-8 text-stone-400 text-sm">
                  No registered parents or guardians linked to this student yet.
                </div>
              )}
            </div>
          </div>
        </TabsContent>
        )}

        {/* TAB 4: EXAMINATIONS & OMR */}
        <TabsContent value="exams" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
                <h3 className="font-heading font-semibold text-stone-900 mb-4">Performance Summary</h3>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-stone-50 rounded-xl p-3">
                    <p className="text-xl font-bold text-stone-900">{rows.length}</p>
                    <p className="text-[11px] text-stone-500">Exams</p>
                  </div>
                  <div className="bg-stone-50 rounded-xl p-3">
                    <p className="text-xl font-bold text-indigo-600">{avg != null ? `${avg}%` : "-"}</p>
                    <p className="text-[11px] text-stone-500">Average</p>
                  </div>
                  <div className="bg-stone-50 rounded-xl p-3">
                    <p className="text-xl font-bold text-emerald-600">{best != null ? `${Math.round(best)}%` : "-"}</p>
                    <p className="text-[11px] text-stone-500">Best</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <StudentResultsChart data={chartData} />
              <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
                <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                  <h3 className="font-heading font-semibold text-stone-900">Exam Results</h3>
                  <Button size="sm" variant="outline" onClick={handleDownload} disabled={rows.length === 0}>
                    <FileDown className="w-4 h-4 mr-2" /> Download Report Card
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                      <tr>
                        <th scope="col" className="text-left px-4 py-3">Examination</th>
                        <th scope="col" className="text-left px-4 py-3">Date</th>
                        <th scope="col" className="text-left px-4 py-3">Marks</th>
                        <th scope="col" className="text-left px-4 py-3">%</th>
                        <th scope="col" className="text-left px-4 py-3">Grade</th>
                        <th scope="col" className="text-left px-4 py-3">Rank</th>
                        <th scope="col" className="text-left px-4 py-3">Status</th>
                        <th scope="col" className="text-right px-4 py-3">Report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-stone-100">
                          <td className="px-4 py-3">
                            <p className="font-medium text-stone-900">{r.exam.name}</p>
                            <p className="text-xs text-stone-400">{r.exam.subject}</p>
                          </td>
                          <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{r.exam.exam_date ? moment(r.exam.exam_date).format("DD MMM YYYY") : "-"}</td>
                          <td className="px-4 py-3 font-mono">{r.total_marks} / {r.exam.max_marks}</td>
                          <td className="px-4 py-3 font-mono font-medium">{r.percentage?.toFixed(1)}%</td>
                          <td className="px-4 py-3 font-semibold">{r.grade || "-"}</td>
                          <td className="px-4 py-3 font-mono">{r.rank ? `#${r.rank}` : "-"}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={r.status} type="exam" />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="icon" variant="ghost" onClick={() => setDetail(r)} title="View detailed report">
                              <Eye className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">No exam results yet for this student.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ExamDetailedReport
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        result={detail}
        exam={detail?.exam}
        previousResult={detail ? prevFor(detail) : null}
        tenant={tenant}
      />
    </div>
  );
}