import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import StatCard from "@/components/shared/StatCard";
import { DataTableSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { hasAnyRole, APP_ROLES } from "@/lib/roles";
import {
  FileText, Plus, BookOpen, Users, CheckCircle2,
  Clock, RefreshCw
} from "lucide-react";
import moment from "moment";

export default function Assignments() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  // Union: an account that is a teacher alongside any other role may still
  // create assignments, because the teacher role is what authorizes it.
  const canCreate = hasAnyRole(user, [APP_ROLES.SUPER_ADMIN, APP_ROLES.SCHOOL_ADMIN, APP_ROLES.TEACHER]);

  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [grading, setGrading] = useState(false);

  // Grading form state: { [submissionId]: { marks_obtained: 0, teacher_feedback: "" } }
  const [gradeState, setGradeState] = useState({});

  // Create form state
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    school_class_id: "",
    section_id: "",
    subject_id: "",
    due_date: moment().add(7, "days").format("YYYY-MM-DDTHH:mm"),
    max_marks: 100,
    status: "published",
  });

  const loadData = async () => {
    if (!user?.tenant_id) return;
    try {
      setLoading(true);
      const tid = user.tenant_id;
      const [allAssignments, allClasses, allSections, allSubjects, allSubs, allStudents] = await Promise.all([
        appClient.entities.Assignment.filter({ tenant_id: tid }, "-created_date").catch(() => []),
        appClient.entities.SchoolClass.filter({ tenant_id: tid }, "name").catch(() => []),
        appClient.entities.Section.filter({ tenant_id: tid }, "name").catch(() => []),
        appClient.entities.Subject.filter({ tenant_id: tid }, "name").catch(() => []),
        appClient.entities.AssignmentSubmission.filter({ tenant_id: tid }, "-created_date").catch(() => []),
        appClient.entities.Student.filter({ tenant_id: tid }, "full_name").catch(() => []),
      ]);

      setAssignments(allAssignments);
      setClasses(allClasses);
      setSections(allSections);
      setSubjects(allSubjects);
      setSubmissions(allSubs);
      setStudents(allStudents);

      if (allClasses.length > 0 && !formData.school_class_id) {
        setFormData((prev) => ({ ...prev, school_class_id: allClasses[0].id }));
      }
    } catch (err) {
      console.error("Failed to load assignments:", err);
      toast({ title: "Failed to load assignments", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user?.tenant_id]);

  const handleOpenCreate = () => {
    setFormData({
      title: "",
      description: "",
      school_class_id: classes[0]?.id || "",
      section_id: "",
      subject_id: subjects[0]?.id || "",
      due_date: moment().add(7, "days").format("YYYY-MM-DDTHH:mm"),
      max_marks: 100,
      status: "published",
    });
    setCreateDialogOpen(true);
  };

  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    if (!formData.title || !formData.school_class_id) {
      toast({ title: "Validation Error", description: "Title and Class are required.", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const payload = {
        title: formData.title,
        description: formData.description,
        school_class_id: formData.school_class_id,
        section_id: formData.section_id || null,
        subject_id: formData.subject_id || null,
        due_date: formData.due_date,
        max_marks: Number(formData.max_marks) || 100,
        status: formData.status,
      };

      await appClient.entities.Assignment.create(payload);
      toast({ title: "Assignment Created", description: `"${formData.title}" published successfully.` });
      setCreateDialogOpen(false);
      await loadData();
    } catch (err) {
      console.error("Create assignment error:", err);
      toast({ title: "Failed to create", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenReview = (asg) => {
    setSelectedAssignment(asg);
    // Find submissions for this assignment
    const asgSubs = submissions.filter((s) => s.assignment_id === asg.id);
    const initialGrades = {};
    asgSubs.forEach((sub) => {
      initialGrades[sub.id] = {
        marks_obtained: sub.marks_obtained !== undefined ? sub.marks_obtained : "",
        teacher_feedback: sub.teacher_feedback || "",
      };
    });
    setGradeState(initialGrades);
    setReviewDialogOpen(true);
  };

  const handleSaveGrade = async (submissionId) => {
    const data = gradeState[submissionId];
    if (!data) return;
    try {
      setGrading(true);
      const payload = {
        marks_obtained: Number(data.marks_obtained),
        teacher_feedback: data.teacher_feedback,
        status: "graded",
      };
      await appClient.entities.AssignmentSubmission.update(submissionId, payload);
      toast({ title: "Grade Saved", description: "Student submission evaluated successfully." });
      await loadData();
    } catch (err) {
      toast({ title: "Grading Failed", description: err.message, variant: "destructive" });
    } finally {
      setGrading(false);
    }
  };

  // Stats calculation
  const stats = useMemo(() => {
    const totalAsg = assignments.length;
    const totalSubs = submissions.length;
    const graded = submissions.filter((s) => s.status === "graded").length;
    const pending = totalSubs - graded;
    return { totalAsg, totalSubs, graded, pending };
  }, [assignments, submissions]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Assignments & Coursework"
        description="Create coursework, monitor student submissions, and provide marks & feedback."
        icon={FileText}
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              className="gap-2 text-stone-700"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {canCreate && (
              <Button
                size="sm"
                onClick={handleOpenCreate}
                className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm"
              >
                <Plus className="w-4 h-4" /> New Assignment
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Assignments"
          value={stats.totalAsg}
          icon={FileText}
          subtext="Active coursework"
        />
        <StatCard
          label="Total Submissions"
          value={stats.totalSubs}
          icon={Users}
          accent="text-indigo-600"
          subtext="Submitted by students"
        />
        <StatCard
          label="Graded"
          value={stats.graded}
          icon={CheckCircle2}
          accent="text-emerald-600"
          subtext="Evaluated with feedback"
        />
        <StatCard
          label="Pending Grading"
          value={stats.pending}
          icon={Clock}
          accent="text-amber-600"
          subtext="Awaiting review"
        />
      </div>

      {/* Assignments List */}
      <div className="bg-white rounded-md border border-stone-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6">
            <DataTableSkeleton rows={4} cols={3} />
          </div>
        ) : assignments.length === 0 ? (
          <div className="p-12 text-center">
            <EmptyState
              icon={FileText}
              title="No assignments yet"
              description="Create your first assignment to begin tracking coursework."
            />
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {assignments.map((asg) => {
              const cls = classes.find((c) => c.id === asg.school_class_id);
              const sub = subjects.find((s) => s.id === asg.subject_id);
              const sec = sections.find((s) => s.id === asg.section_id);
              const asgSubs = submissions.filter((s) => s.assignment_id === asg.id);
              const gradedCount = asgSubs.filter((s) => s.status === "graded").length;
              const isPastDue = asg.due_date && moment(asg.due_date).isBefore(moment());

              return (
                <div key={asg.id} className="p-5 hover:bg-stone-50/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-stone-900 text-base">{asg.title}</span>
                      <Badge
                        variant="outline"
                        className={
                          asg.status === "published"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-xs"
                            : "bg-stone-50 text-stone-600 border-stone-200 text-xs"
                        }
                      >
                        {asg.status || "published"}
                      </Badge>
                      {isPastDue && (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[11px]">
                          Past Due
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-stone-500 line-clamp-2 max-w-2xl">
                      {asg.description || "No description provided."}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-stone-500 pt-1">
                      <span className="flex items-center gap-1 font-medium text-stone-700">
                        <BookOpen className="w-3.5 h-3.5 text-stone-400" />
                        {cls?.name || "Class"} {sec ? `Sec ${sec.name}` : ""}
                      </span>
                      {sub && (
                        <span className="text-stone-600">
                          {sub.name}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-stone-500">
                        <Clock className="w-3.5 h-3.5 text-stone-400" />
                        Due {moment(asg.due_date).format("MMM D, YYYY [at] h:mm A")}
                      </span>
                      <span className="font-medium text-stone-600">
                        Max Marks: {asg.max_marks || 100}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs pr-2 hidden sm:block">
                      <div className="font-semibold text-stone-800">
                        {asgSubs.length} Submissions
                      </div>
                      <div className="text-stone-400">
                        {gradedCount} graded
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleOpenReview(asg)}
                      className="gap-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 border border-indigo-200 shadow-none"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Review Submissions
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Assignment Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Assignment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateAssignment} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Title</label>
              <Input
                placeholder="e.g. Chapter 4 Quadratic Equations"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-stone-600 block mb-1">Description / Instructions</label>
              <Textarea
                placeholder="Specify questions, required format, or submission guidelines..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-stone-600 block mb-1">Target Class</label>
                <Select
                  value={formData.school_class_id}
                  onValueChange={(v) => setFormData({ ...formData, school_class_id: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select Class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-stone-600 block mb-1">Subject</label>
                <Select
                  value={formData.subject_id}
                  onValueChange={(v) => setFormData({ ...formData, subject_id: v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-stone-600 block mb-1">Due Date & Time</label>
                <Input
                  type="datetime-local"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="h-9"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-600 block mb-1">Max Marks</label>
                <Input
                  type="number"
                  min="1"
                  max="1000"
                  value={formData.max_marks}
                  onChange={(e) => setFormData({ ...formData, max_marks: e.target.value })}
                  className="h-9"
                  required
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {saving ? "Publishing..." : "Publish Assignment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Review Submissions Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submissions: {selectedAssignment?.title}</DialogTitle>
          </DialogHeader>

          {(() => {
            const asgSubs = submissions.filter((s) => s.assignment_id === selectedAssignment?.id);
            if (asgSubs.length === 0) {
              return (
                <div className="py-12 text-center text-stone-400">
                  <EmptyState
                    icon={Users}
                    title="No submissions yet"
                    description="Students have not submitted solutions for this assignment yet."
                  />
                </div>
              );
            }

            return (
              <div className="space-y-4 pt-2 divide-y divide-stone-100">
                {asgSubs.map((sub) => {
                  const student = students.find((st) => st.id === sub.student_id);
                  const state = gradeState[sub.id] || {};
                  return (
                    <div key={sub.id} className="pt-4 first:pt-0 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-stone-900 text-sm">
                            {student?.full_name || "Unknown Student"}
                          </div>
                          <div className="text-xs text-stone-400">
                            Submitted {moment(sub.created_date).format("MMM D, YYYY [at] h:mm A")}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            sub.status === "graded"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }
                        >
                          {sub.status === "graded" ? `Graded (${sub.marks_obtained}/${selectedAssignment?.max_marks || 100})` : "Pending Review"}
                        </Badge>
                      </div>

                      {/* Submission text */}
                      <div className="p-3 bg-stone-50 rounded-lg text-xs text-stone-700 border border-stone-100">
                        <span className="font-semibold text-stone-500 block mb-1">Student Answer:</span>
                        <p className="whitespace-pre-wrap">{sub.submission_text || "No written response provided."}</p>
                      </div>

                      {/* Grading inputs */}
                      <div className="grid grid-cols-3 gap-3 items-end">
                        <div>
                          <label className="text-xs font-medium text-stone-600 block mb-1">
                            Marks (out of {selectedAssignment?.max_marks || 100})
                          </label>
                          <Input
                            type="number"
                            min="0"
                            max={selectedAssignment?.max_marks || 100}
                            value={state.marks_obtained ?? ""}
                            onChange={(e) =>
                              setGradeState({
                                ...gradeState,
                                [sub.id]: { ...state, marks_obtained: e.target.value },
                              })
                            }
                            className="h-8 text-xs"
                            placeholder="0"
                          />
                        </div>
                        <div className="col-span-2 flex items-center gap-2">
                          <div className="flex-1">
                            <label className="text-xs font-medium text-stone-600 block mb-1">Feedback</label>
                            <Input
                              value={state.teacher_feedback || ""}
                              onChange={(e) =>
                                setGradeState({
                                  ...gradeState,
                                  [sub.id]: { ...state, teacher_feedback: e.target.value },
                                })
                              }
                              className="h-8 text-xs"
                              placeholder="Great effort, review question 3..."
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSaveGrade(sub.id)}
                            disabled={grading || state.marks_obtained === ""}
                            className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white text-xs shrink-0"
                          >
                            Save Grade
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <DialogFooter className="pt-4 border-t border-stone-100">
            <Button variant="outline" size="sm" onClick={() => setReviewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
