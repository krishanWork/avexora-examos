import React, { useEffect, useState } from "react";
import { useOutletContext, Link, useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import AnnouncementBanner from "@/components/announcements/AnnouncementBanner";
import AnnouncementsManager from "@/components/announcements/AnnouncementsManager";
import PullToRefresh from "@/components/shared/PullToRefresh";
import QuickNav from "@/components/shared/QuickNav";
import { DashboardSkeleton, ErrorCard } from "@/components/shared/Skeletons";
import ExamFormDialog from "@/components/exams/ExamFormDialog";
import StudentImportDialog from "@/components/students/StudentImportDialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  GraduationCap, Users, BookOpenCheck, ScanLine, Plus, UploadCloud,
  BookOpen, BarChart3, Palette, UserCog, Wallet, ArrowRight, CheckCircle2, AlertTriangle
} from "lucide-react";

import { StatusBadge } from "@/lib/statusTokens";
import { can } from "@/lib/permissions";

export default function SchoolDashboard() {
  const { user, tenant } = useOutletContext() || {};
  const { toast } = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    students: 0,
    teachers: 0,
    exams: 0,
    sheets: 0,
    avgScore: 0,
  });
  const [triageItems, setTriageItems] = useState({
    sheetsNeedingReview: [],
    examsWithoutKey: [],
    newLeads: [],
  });
  const [recentExams, setRecentExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [examDialogOpen, setExamDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    if (!user?.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const [studentsList, teachersList, examsList, sheetsList, classesList, resultsList, leadsList] = await Promise.all([
        appClient.entities.Student.filter({ tenant_id: user.tenant_id }).catch(() => []),
        appClient.entities.Teacher.filter({ tenant_id: user.tenant_id }).catch(() => []),
        appClient.entities.Examination.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
        appClient.entities.OMRSheet.filter({ tenant_id: user.tenant_id }).catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: user.tenant_id }).catch(() => []),
        appClient.entities.Result.filter({ tenant_id: user.tenant_id, status: "published" }).catch(() => []),
        appClient.entities.Lead.filter({ tenant_id: user.tenant_id }).catch(() => []),
      ]);

      const avg = resultsList.length > 0
        ? Math.round(resultsList.reduce((sum, r) => sum + (r.percentage || 0), 0) / resultsList.length)
        : 0;

      const sheetsNeedingReview = sheetsList.filter(
        (s) => s.status === "needs_review" || s.status === "failed" || s.flagged === true
      );
      const examsWithoutKey = examsList.filter((e) => {
        const keys = e.answer_keys || {};
        return Object.keys(keys).length === 0;
      });
      const newLeads = leadsList.filter((l) => l.status === "new");

      setTriageItems({
        sheetsNeedingReview,
        examsWithoutKey,
        newLeads,
      });

      setStats({
        students: studentsList.length,
        teachers: teachersList.length,
        exams: examsList.length,
        sheets: sheetsList.length,
        avgScore: avg,
      });

      setRecentExams(examsList.slice(0, 6));
      setClasses(classesList);
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load dashboard", description: "Please try again.", variant: "destructive" });
      console.error("SchoolDashboard load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.tenant_id]);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorCard onRetry={loadData} />;

  const handleCreateExam = async (data) => {
    try {
      const created = await appClient.entities.Examination.create({ ...data, tenant_id: user.tenant_id });
      toast({ title: "Examination created successfully" });
      setExamDialogOpen(false);
      navigate(`/examinations/${created.id}`);
    } catch (err) {
      toast({ title: "Error creating exam", description: err.message, variant: "destructive" });
    }
  };

  const totalTriageCount =
    triageItems.sheetsNeedingReview.length +
    triageItems.examsWithoutKey.length +
    triageItems.newLeads.length;

  return (
    <PullToRefresh onRefresh={loadData}>
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
        {/* Global & School Announcements */}
        <AnnouncementBanner userId={user?.id} />
        <AnnouncementBanner userId={user?.id} tenantId={user?.tenant_id} />

        {/* Page Header */}
        <PageHeader
          title={`Welcome${tenant?.name ? `, ${tenant.name}` : ""}`}
          description="Comprehensive institutional overview and OMR examination operations."
          actions={
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setExamDialogOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              >
                <Plus className="w-4 h-4 mr-2" /> New Examination
              </Button>
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <UploadCloud className="w-4 h-4 mr-2 text-indigo-600" /> Import Students
              </Button>
            </div>
          }
        />

        {/* Operational Action Required Banner */}
        {totalTriageCount > 0 && (
          <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-700">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-950 font-heading">
                    Operational Triage — {totalTriageCount} Item{totalTriageCount !== 1 ? "s" : ""} Requiring Attention
                  </h3>
                  <p className="text-xs text-amber-800/80">Pending administrative actions that may block grading or enrollment workflows.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {triageItems.sheetsNeedingReview.length > 0 && (
                <div className="bg-white p-3.5 rounded-xl border border-amber-200/80 flex items-start justify-between shadow-2xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                      <ScanLine className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>OMR Verification</span>
                    </div>
                    <p className="text-xs text-stone-500">
                      {triageItems.sheetsNeedingReview.length} sheet{triageItems.sheetsNeedingReview.length !== 1 ? "s" : ""} flagged for manual inspection
                    </p>
                  </div>
                  <Link
                    to="/examinations"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5 mt-0.5"
                  >
                    Review <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}

              {triageItems.examsWithoutKey.length > 0 && (
                <div className="bg-white p-3.5 rounded-xl border border-amber-200/80 flex items-start justify-between shadow-2xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                      <BookOpenCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span>Answer Keys Pending</span>
                    </div>
                    <p className="text-xs text-stone-500">
                      {triageItems.examsWithoutKey.length} exam{triageItems.examsWithoutKey.length !== 1 ? "s" : ""} missing master answer key
                    </p>
                  </div>
                  <Link
                    to={`/examinations/${triageItems.examsWithoutKey[0].id || triageItems.examsWithoutKey[0]._id}`}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5 mt-0.5"
                  >
                    Configure <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}

              {triageItems.newLeads.length > 0 && (
                <div className="bg-white p-3.5 rounded-xl border border-amber-200/80 flex items-start justify-between shadow-2xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-950">
                      <Users className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Admissions Inquiries</span>
                    </div>
                    <p className="text-xs text-stone-500">
                      {triageItems.newLeads.length} new lead{triageItems.newLeads.length !== 1 ? "s" : ""} awaiting contact
                    </p>
                  </div>
                  <Link
                    to="/leads"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5 mt-0.5"
                  >
                    Follow Up <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}


        {/* Core KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            label="Total Students"
            value={stats.students}
            subtext="Enrolled students"
            icon={GraduationCap}
            accent="text-indigo-600"
          />
          <StatCard
            label="Faculty Members"
            value={stats.teachers}
            subtext="Teaching staff"
            icon={Users}
            accent="text-emerald-600"
          />
          <StatCard
            label="Examinations"
            value={stats.exams}
            subtext="Created exams"
            icon={BookOpenCheck}
            accent="text-amber-600"
          />
          <StatCard
            label="OMR Scans Processed"
            value={stats.sheets}
            subtext="Evaluated sheets"
            icon={ScanLine}
            accent="text-purple-600"
          />
          <StatCard
            label="Average Performance"
            value={stats.avgScore > 0 ? `${stats.avgScore}%` : "—"}
            subtext="Published exams"
            icon={CheckCircle2}
            accent="text-teal-600"
          />
        </div>

        {/* Quick Operation Navigation Strip */}
        <QuickNav
          title="Academic Management"
          items={[
            { to: "/academic-setup", icon: BookOpen, color: "text-indigo-600", label: "Classes & Subjects" },
            { to: "/examinations", icon: BookOpenCheck, color: "text-indigo-600", label: "All Examinations" },
            { to: "/students", icon: GraduationCap, color: "text-emerald-600", label: "Students Directory" },
            { to: "/analytics", icon: BarChart3, color: "text-amber-600", label: "Analytics & Trends" },
            // /staff and /billing used to share one gate. They no longer have the same
            // audience: a principal may now manage staff (PAGE_ROLES.staffManagement,
            // mirrored server-side by canManageStaff), but billing stays
            // school-admin. Gating both on manage_staff would have handed every
            // principal a Plan & Usage link that dead-ends on a redirect to /home.
            // exam_coordinator and teacher reach this dashboard but neither page.
            ...(can(user, "manage_staff")
              ? [{ to: "/staff", icon: UserCog, color: "text-purple-600", label: "Staff Permissions" }]
              : []),
            ...(can(user, "manage_billing")
              ? [{ to: "/billing", icon: Wallet, color: "text-teal-600", label: "Plan & Usage" }]
              : []),
          ]}
        />

        {/* Examinations Pipeline & Action Hub */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Active Examinations Hub */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-heading font-bold text-stone-900 text-base">Examinations Hub</h3>
                  <p className="text-xs text-stone-500">Manage answer keys, upload OMR batches, and publish results</p>
                </div>
                <Link to="/examinations" className="text-xs font-semibold text-indigo-600 hover:underline">
                  View all exams →
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {recentExams.map((e) => {
                  return (
                    <div
                      key={e.id}
                      className="p-4 rounded-xl border border-stone-100 hover:border-indigo-200 bg-stone-50/50 hover:bg-white transition flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-semibold text-stone-900 text-sm leading-snug">{e.name}</h4>
                          <StatusBadge status={e.status} type="exam" />
                        </div>
                        <p className="text-xs text-stone-500 mb-1 font-medium">
                          {e.subject} · {e.class_name || "All Classes"}
                        </p>
                        <p className="text-[11px] text-stone-400">
                          {e.num_questions || 50} questions · {e.max_marks || 100} marks
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between">
                        <Link
                          to={`/examinations/${e.id}`}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          Open Exam Console <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}

                {recentExams.length === 0 && (
                  <div className="col-span-2 py-10 text-center text-stone-400">
                    <p className="text-sm">No examinations created yet.</p>
                    <Button
                      size="sm"
                      onClick={() => setExamDialogOpen(true)}
                      className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Create First Exam
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Classes & Academic Overview */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-heading font-bold text-stone-900 text-base">Academic Classes</h3>
                <Link to="/academic-setup" className="text-xs font-semibold text-indigo-600 hover:underline">
                  Manage setup →
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {classes.map((c) => (
                  <div key={c.id} className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                    <p className="font-bold text-sm text-stone-900">{c.name}</p>
                    <p className="text-xs text-stone-500 mt-0.5">
                      {(c.sections || []).length > 0 ? `Sec: ${c.sections.join(", ")}` : "All sections"}
                    </p>
                  </div>
                ))}
                {classes.length === 0 && (
                  <p className="col-span-4 text-xs text-stone-400 text-center py-4">
                    No classes set up yet. Configure classes in Academic Setup.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Col: Announcements & Quick Audit */}
          <div className="space-y-6">
            {/* Announcements Manager */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
              <AnnouncementsManager tenantId={user?.tenant_id} />
            </div>

            {/* School Branding / White Label Card */}
            <div className="bg-gradient-to-br from-stone-900 to-stone-800 rounded-2xl p-5 text-white shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Palette className="w-5 h-5 text-indigo-400" />
                <h4 className="font-heading font-bold text-sm">White Label & Branding</h4>
              </div>
              <p className="text-xs text-stone-300 mb-4 leading-relaxed">
                Customize your school logo, primary colors, portal domain, and PDF report card templates.
              </p>
              <Button asChild size="sm" variant="secondary" className="w-full text-xs font-medium">
                <Link to="/white-label">Configure School Branding</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Modals */}
        <ExamFormDialog
          open={examDialogOpen}
          onOpenChange={setExamDialogOpen}
          onSave={handleCreateExam}
          tenantId={user?.tenant_id}
        />

        <StudentImportDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          tenantId={user?.tenant_id}
          onImported={(summary) => {
            toast({
              title: "Students imported",
              description: `Created: ${summary.created}, Updated: ${summary.updated}, Invitations: ${summary.invited}`,
            });
            loadData();
          }}
        />
      </div>
    </PullToRefresh>
  );
}