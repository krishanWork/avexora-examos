import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { hasAnyRole, APP_ROLES } from "@/lib/roles";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import PlanChangeRequestDialog from "@/components/billing/PlanChangeRequestDialog";
import StudentFormDialog from "@/components/students/StudentFormDialog";
import StudentImportDialog from "@/components/students/StudentImportDialog";
import CredentialRevealModal from "@/components/students/CredentialRevealModal";
import PortalLoginSettingsDialog from "@/components/students/PortalLoginSettingsDialog";
import PullToRefresh from "@/components/shared/PullToRefresh";
import BulkActionsBar from "@/components/students/BulkActionsBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { GraduationCap, Plus, Pencil, UploadCloud, Search, Download, ArrowLeft, ChevronRight, Users, AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { StatusBadge } from "@/lib/statusTokens";

const STAGE_ORDER = ["pre_primary", "primary", "middle", "secondary", "senior_secondary"];

const STAGE_LABELS = {
  pre_primary: "Pre-Primary",
  primary: "Primary",
  middle: "Middle",
  secondary: "Secondary",
  senior_secondary: "Senior Secondary",
};

const STAGE_BADGES = {
  pre_primary: "bg-emerald-50 text-emerald-700 border-emerald-200",
  primary: "bg-emerald-50 text-emerald-700 border-emerald-200",
  middle: "bg-amber-50 text-amber-700 border-amber-200",
  secondary: "bg-indigo-50 text-indigo-700 border-indigo-200",
  senior_secondary: "bg-purple-50 text-purple-700 border-purple-200",
};

// How many students one server call may touch. The server accepts more, but each
// one costs a bcrypt hash, so a whole-tenant backfill is chunked to keep the
// request bounded and to give the button something to report progress against.
const PROVISION_CHUNK_SIZE = 100;

// Map a server `_provisioned` payload into reveal-modal rows.
const credentialRowsFromProvisioned = (provisioned, fallback = {}) => {
  const reused = new Set(provisioned?.reused || []);
  const rows = [];
  if (provisioned?.student?.email) {
    rows.push({
      type: "student",
      name: provisioned.student.full_name || fallback.full_name || "",
      email: provisioned.student.email,
      reused: reused.has(provisioned.student.email),
    });
  }
  if (provisioned?.parent?.email) {
    rows.push({
      type: "parent",
      name: provisioned.parent.full_name || fallback.parent_name || "",
      email: provisioned.parent.email,
      reused: reused.has(provisioned.parent.email),
    });
  }
  return rows;
};

export default function Students() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [drillClass, setDrillClass] = useState(null);
  const [sectionFilter, setSectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [plans, setPlans] = useState([]);
  const [credRows, setCredRows] = useState([]);
  const [credDefaultPassword, setCredDefaultPassword] = useState("");
  const [provisioningId, setProvisioningId] = useState(null);
  const [provisionPreview, setProvisionPreview] = useState(null);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState({ done: 0, total: 0 });

  // A single student, through the same server capability the bulk button uses.
  // The row action used to be a no-op Student update, which bought the
  // provisioning side effect but also wrote a pointless updated_date and
  // re-synced the parent records every time it was pressed.
  const provisionCreds = async (row) => {
    setProvisioningId(row.id);
    try {
      const res = await appClient.functions.invoke("provisionStudentLogins", { student_ids: [row.id] });
      const result = res.data || {};
      const rows = result.rows || [];
      if (rows.length) {
        setCredDefaultPassword(result.default_password || "");
        setCredRows(rows);
        toast({ title: "Credentials created", description: "Portal logins created/linked for student and parent." });
      } else {
        toast({ title: "Already provisioned", description: "This student and parent already have portal logins." });
      }
    } catch (e) {
      toast({ title: "Failed to create credentials", description: e.message, variant: "destructive" });
    } finally {
      setProvisioningId(null);
    }
  };

  // Dry run first: the server reports which students have no login at all, so
  // the confirmation states a real number instead of "all of them". Nothing is
  // written on this pass.
  const startProvisionAll = async () => {
    if (!user?.tenant_id) return;
    const scope = selectedIds.length ? selectedIds : students.map((s) => s.id);
    if (!scope.length) {
      toast({ title: "Nothing to do", description: "There are no students in scope.", variant: "destructive" });
      return;
    }
    try {
      const res = await appClient.functions.invoke("provisionStudentLogins", { student_ids: scope, dry_run: true });
      const result = res.data || {};
      if (!result.missing_count) {
        toast({ title: "Nothing to create", description: `All ${result.scanned ?? scope.length} students in scope already have portal logins.` });
        return;
      }
      setProvisionPreview(result);
    } catch (e) {
      toast({ title: "Failed to check portal logins", description: e.message, variant: "destructive" });
    }
  };

  const runProvisionAll = async () => {
    const ids = provisionPreview?.missing_ids || [];
    setProvisionPreview(null);
    if (!ids.length) return;
    setProvisionBusy(true);
    setCredRows([]);
    setCredDefaultPassword("");
    setProvisionProgress({ done: 0, total: ids.length });
    try {
      const collected = [];
      let defaultPassword = "";
      let created = 0;
      let reused = 0;
      const failures = [];
      for (let i = 0; i < ids.length; i += PROVISION_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + PROVISION_CHUNK_SIZE);
        const res = await appClient.functions.invoke("provisionStudentLogins", { student_ids: chunk });
        const result = res.data || {};
        if (Array.isArray(result.rows)) collected.push(...result.rows);
        if (result.default_password && !defaultPassword) defaultPassword = result.default_password;
        created += result.created_count || 0;
        reused += result.reused_count || 0;
        if (result.skipped?.length) failures.push(...result.skipped);
        setProvisionProgress({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
      }
      if (defaultPassword) setCredDefaultPassword(defaultPassword);
      if (collected.length) setCredRows(collected);
      toast({
        title: "Portal logins created",
        description: `${created} new login${created === 1 ? "" : "s"} across ${ids.length} student${ids.length === 1 ? "" : "s"}${reused ? `, ${reused} existing account${reused === 1 ? "" : "s"} reused` : ""}.`,
      });
      if (failures.length) {
        toast({ title: "Some students were skipped", description: failures.map((f) => f.full_name || f.id).join(", "), variant: "destructive" });
      }
      load();
    } catch (e) {
      toast({ title: "Failed to create portal logins", description: e.message, variant: "destructive" });
    } finally {
      setProvisionBusy(false);
      setProvisionProgress({ done: 0, total: 0 });
    }
  };

  useEffect(() => {
    if (!user?.tenant_id) return;
    appClient.functions.invoke("getMyTenant", { tenant_id: user.tenant_id })
      .then((res) => setTenant(res.data?.tenant || null))
      .catch(() => {});
  }, [user?.tenant_id]);

  const load = async () => {
    if (!user?.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const [studentList, classList] = await Promise.all([
        appClient.entities.Student.filter({ tenant_id: user.tenant_id }, "-created_date"),
        appClient.entities.SchoolClass.filter({ tenant_id: user.tenant_id }, "order").catch(() => []),
      ]);
      setStudents(studentList);
      setClasses(classList);
      setSections(await appClient.entities.Section.filter({ tenant_id: user.tenant_id }).catch(() => []));
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load students", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.tenant_id]);

  const handleSave = async (data) => {
    const norm = (v) => String(v || "").trim().toLowerCase();
    const isDuplicate = (s) =>
      (data.admission_number && norm(s.admission_number) === norm(data.admission_number)) ||
      (norm(s.full_name) === norm(data.full_name) && norm(s.class_name) === norm(data.class_name) && norm(s.section) === norm(data.section));
    if (editing) {
      const dup = students.find((s) => s.id !== editing.id && isDuplicate(s));
      if (dup) {
        toast({ title: "Duplicate student", description: `Another student already exists with this admission number or name in the same class.`, variant: "destructive" });
        return;
      }
      try {
        const updated = await appClient.entities.Student.update(editing.id, data);
        await logAudit({ user, action: "update", entity_type: "Student", entity_id: editing.id, details: data.full_name });
        if (updated?._syncWarnings?.length) {
          toast({ title: "Student updated with warnings", description: updated._syncWarnings.join(" "), variant: "destructive" });
        }
        if (updated?._provisioned) {
          const provisioned = updated._provisioned;
          setCredDefaultPassword(provisioned.default_password || "");
          setCredRows(credentialRowsFromProvisioned(provisioned, data));
        }
      } catch (err) {
        toast({ title: "Failed to update student", description: err.message, variant: "destructive" });
        return;
      }
    } else {
      if (atStudentLimit) {
        limitToast();
        return;
      }
      const dup = students.find(isDuplicate);
      if (dup) {
        toast({ title: "Duplicate student", description: `${data.full_name} already exists (same admission number or same name in ${data.class_name || "this class"}). Edit the existing record instead.`, variant: "destructive" });
        return;
      }
      try {
        const created = await appClient.entities.Student.create({ ...data, tenant_id: user.tenant_id });
        await logAudit({ user, action: "create", entity_type: "Student", entity_id: created.id, details: data.full_name });
        if (created?._syncWarnings?.length) {
          toast({ title: "Student added with warnings", description: created._syncWarnings.join(" "), variant: "destructive" });
        }
        if (created?._provisioned) {
          const provisioned = created._provisioned;
          setCredDefaultPassword(provisioned.default_password || "");
          setCredRows(credentialRowsFromProvisioned(provisioned, data));
        }
      } catch (err) {
        toast({ title: "Failed to create student", description: err.message, variant: "destructive" });
        return;
      }
    }
    toast({ title: editing ? "Student updated" : "Student added" });
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  const activeStudents = students.filter((s) => s.status === "active").length;
  const atStudentLimit = !!tenant?.student_limit && activeStudents >= tenant.student_limit;
  // This used to be a toast whose only content was "Upgrade your plan", with no way
  // to act on it. It now opens the request dialog — but only for a role that may
  // actually raise one, since a principal or coordinator hitting the limit is told
  // to contact the administrator rather than shown a control that would be refused.
  const openPlanUpgrade = async () => {
    toast({
      title: "Student limit reached",
      description: `Your plan allows ${tenant.student_limit} students (${activeStudents} active).`,
      variant: "destructive",
    });
    if (!can(user, "submit_plan_change")) return;
    setPlanDialogOpen(true);
    if (plans.length) return;
    const catalogue = await appClient.entities.SubscriptionPlan.list().catch(() => []);
    setPlans(catalogue);
  };
  const limitToast = openPlanUpgrade;

  const classesByStage = useMemo(() => {
    const groups = {};
    for (const c of classes) {
      const stage = c.stage || "general";
      if (!groups[stage]) groups[stage] = [];
      groups[stage].push(c);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || "").localeCompare(b.name || ""));
    }
    const ordered = STAGE_ORDER.filter((s) => groups[s]).map((s) => ({ stage: s, items: groups[s] }));
    if (groups.general) ordered.push({ stage: "general", items: groups.general });
    return ordered;
  }, [classes]);

  const classIdByName = useMemo(() => {
    const map = {};
    for (const c of classes) map[c.name] = c.id;
    return map;
  }, [classes]);

  const sectionsByClass = useMemo(() => {
    const map = {};
    for (const s of sections) {
      if (!map[s.school_class_id]) map[s.school_class_id] = [];
      map[s.school_class_id].push(s);
    }
    for (const key of Object.keys(map)) map[key].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return map;
  }, [sections]);

  const scopedFiltered = useMemo(() =>
    students.filter((s) =>
      s.full_name?.toLowerCase().includes(search.toLowerCase()) &&
      (statusFilter === "all" || s.status === statusFilter)
    ), [students, search, statusFilter]);

  const isUnassigned = (s) => !s.class_name || !classIdByName[s.class_name];
  const unassignedStudents = scopedFiltered.filter(isUnassigned);

  const countForClass = (className) => scopedFiltered.filter((s) => s.class_name === className).length;
  const countForSection = (className, sectionName) => scopedFiltered.filter((s) => s.class_name === className && s.section === sectionName).length;

  const filtered = useMemo(() => {
    if (!drillClass) return scopedFiltered;
    if (drillClass === "__unassigned__") {
      return scopedFiltered.filter(isUnassigned);
    }
    return scopedFiltered.filter((s) =>
      s.class_name === drillClass &&
      (sectionFilter === "all" || s.section === sectionFilter)
    );
  }, [scopedFiltered, drillClass, sectionFilter]);

  useEffect(() => { setPage(1); setSelectedIds([]); }, [search, drillClass, sectionFilter, statusFilter]);
  const PAGE_SIZE = 20;

  const toggleSelect = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const allPageSelected = filtered.length > 0 && filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).every((s) => selectedIds.includes(s.id));
  const toggleSelectAll = () => {
    const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    setSelectedIds((prev) =>
      allPageSelected
        ? prev.filter((id) => !pageItems.some((s) => s.id === id))
        : [...new Set([...prev, ...pageItems.map((s) => s.id)])]
    );
  };

  const bulkSetStatus = async (status) => {
    setBulkBusy(true);
    try {
      await appClient.entities.Student.bulkUpdate(selectedIds.map((id) => ({ id, status })));
      await logAudit({ user, action: "bulk_update_status", entity_type: "Student", details: `${selectedIds.length} students set to ${status}` });
      toast({ title: "Status updated", description: `${selectedIds.length} student(s) set to ${status}.` });
      setSelectedIds([]);
    } catch (err) {
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
      load();
    }
  };

  const bulkDelete = async () => {
    if (!can(user, "delete_students")) {
      toast({ title: "Not allowed", description: "Only school administrators can delete students.", variant: "destructive" });
      return;
    }
    setBulkBusy(true);
    try {
      await appClient.entities.Student.deleteMany({ id: { $in: selectedIds }, tenant_id: user.tenant_id });
      await logAudit({ user, action: "bulk_delete", entity_type: "Student", details: `${selectedIds.length} students deleted` });
      toast({ title: "Students deleted", description: `${selectedIds.length} student(s) removed.` });
      setSelectedIds([]);
    } catch (err) {
      toast({ title: "Failed to delete students", description: err.message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
      load();
    }
  };

  const handleExport = () => {
    const cols = ["full_name", "admission_number", "roll_number", "class_name", "section", "batch", "gender", "dob", "student_email", "student_phone", "parent_name", "parent_email", "parent_phone", "status"];
    const headers = ["Name", "Admission No", "Roll No", "Class", "Section", "Batch", "Gender", "DOB", "Student Email", "Student Phone", "Parent Name", "Parent Email", "Parent Phone", "Status"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers.join(","), ...filtered.map((s) => cols.map((c) => escape(s[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "students.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const drillInto = (className) => {
    setDrillClass(className);
    setSectionFilter("all");
    setPage(1);
  };

  const columns = [
    {
      key: "full_name",
      header: "Name",
      cell: (row) => (
        <Link to={`/students/${row.id}`} className="font-medium text-stone-900 hover:text-indigo-600 hover:underline">{row.full_name}</Link>
      ),
    },
    { key: "admission_number", header: "Admission No.", cell: (row) => row.admission_number || "-" },
    ...(drillClass
      ? []
      : [{ key: "class_section", header: "Class", cell: (row) => `${row.class_name} ${row.section}` }]),
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} type="student" />,
    },
  ];

  const renderClassCards = () => (
    <div className="space-y-6">
      {unassignedStudents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-stone-800">Unassigned</h3>
            <Badge variant="outline" className="text-[11px] text-amber-700 bg-amber-50 border-amber-200">No resolvable class</Badge>
          </div>
          <button
            onClick={() => drillInto("__unassigned__")}
            className="w-full flex items-center justify-between bg-white border border-dashed border-amber-300 hover:border-amber-500 hover:shadow-sm transition-all rounded-xl p-4 text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-stone-800">{unassignedStudents.length} student{unassignedStudents.length > 1 ? "s" : ""}</div>
                <div className="text-xs text-stone-500">No matching class in the academic structure</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-stone-400 group-hover:text-stone-600 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {classesByStage.map(({ stage, items }) => {
        const stageCount = items.reduce((acc, c) => acc + countForClass(c.name), 0);
        if (stageCount === 0) return null;
        return (
          <div key={stage}>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={`text-[11px] capitalize ${STAGE_BADGES[stage] || ""}`}>
                {STAGE_LABELS[stage] || stage.replace("_", " ")}
              </Badge>
              <span className="text-xs text-stone-400">{stageCount} student{stageCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((c) => {
                const count = countForClass(c.name);
                const classSections = sectionsByClass[c.id] || [];
                const presentSections = classSections.filter((s) => countForSection(c.name, s.name) > 0);
                return (
                  <button
                    key={c.id || c.name}
                    onClick={() => drillInto(c.name)}
                    disabled={count === 0}
                    className={`text-left bg-white border rounded-xl p-4 transition-all group ${
                      count === 0
                        ? "border-stone-200 opacity-50 cursor-not-allowed"
                        : "border-stone-200 hover:border-indigo-400 hover:shadow-sm cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-stone-900">{c.name}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-stone-500">{count}</span>
                        <Users className="w-3.5 h-3.5 text-stone-400" />
                      </div>
                    </div>
                    {presentSections.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {presentSections.map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-stone-50 border border-stone-200 text-stone-600">
                            {s.name}
                            <span className="text-stone-400">·</span>
                            <span className="font-semibold">{countForSection(c.name, s.name)}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">No sections populated yet</span>
                    )}
                    <div className="flex items-center gap-1 mt-3 text-xs text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      View students <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {scopedFiltered.length === 0 && (
        <div className="text-center py-16 text-stone-400">
          <GraduationCap className="w-10 h-10 mx-auto mb-2 text-stone-300" />
          <p className="text-sm">No students match the current filters.</p>
        </div>
      )}
    </div>
  );

  const drillSections = drillClass && drillClass !== "__unassigned__" ? sectionsByClass[classIdByName[drillClass]] || [] : [];
  const drillTitle = drillClass === "__unassigned__" ? "Unassigned Students" : drillClass || "";

  return (
    <PullToRefresh onRefresh={load}>
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Students"
        description="Manage your institution's student roster."
        actions={
          <>
            <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="w-4 h-4 mr-2" /> Export
            </Button>
            {can(user, "manage_students") ? (
              <>
                <Button variant="outline" onClick={() => (atStudentLimit ? limitToast() : setImportOpen(true))}>
                  <UploadCloud className="w-4 h-4 mr-2" /> Bulk Import
                </Button>
                {hasAnyRole(user, [APP_ROLES.SCHOOL_ADMIN, APP_ROLES.SUPER_ADMIN]) && (
                  <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                    <KeyRound className="w-4 h-4 mr-2" /> Login Settings
                  </Button>
                )}
                {can(user, "provision_student_logins") && (
                  <Button
                    variant="outline"
                    onClick={startProvisionAll}
                    disabled={provisionBusy || students.length === 0}
                    title={
                      selectedIds.length
                        ? `Create portal logins for ${selectedIds.length} selected student(s)`
                        : "Create portal logins for every student in the institution"
                    }
                  >
                    {provisionBusy ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4 mr-2" />
                    )}
                    {provisionBusy
                      ? `Creating logins ${provisionProgress.done}/${provisionProgress.total}`
                      : "Create Portal Logins"}
                  </Button>
                )}
                <Button onClick={() => { if (atStudentLimit) { limitToast(); return; } setEditing(null); setDialogOpen(true); }}>
                  <Plus className="w-4 h-4 mr-2" /> Add Student
                </Button>
              </>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                Principal Oversight (View-Only)
              </Badge>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {drillClass && (
          <Button variant="outline" size="sm" className="text-xs" onClick={() => { setDrillClass(null); setSectionFilter("all"); }}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> All Classes
          </Button>
        )}
        <div className="relative max-w-xs w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input className="pl-9" placeholder="Search students..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {drillSections.length > 1 && (
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sections</SelectItem>
              {drillSections.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-stone-400 ml-auto">
          {drillClass ? `${filtered.length} of ${scopedFiltered.length} students in ${drillTitle}` : `${scopedFiltered.length} students`}
        </span>
      </div>

      <BulkActionsBar
        count={selectedIds.length}
        busy={bulkBusy}
        onSetStatus={bulkSetStatus}
        onDelete={bulkDelete}
        onClear={() => setSelectedIds([])}
      />

      {loading ? (
        <DataTable columns={columns} data={[]} loading error={error} onRetry={load} emptyMessage="Loading..." emptyIcon={GraduationCap} />
      ) : drillClass ? (
        <DataTable
          columns={columns}
          data={filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
          loading={false}
          error={error}
          onRetry={load}
          emptyMessage={`No students found in ${drillTitle}`}
          emptyIcon={GraduationCap}
          pagination={{ page, totalItems: filtered.length, pageSize: PAGE_SIZE, onPageChange: setPage }}
          selectAllChecked={allPageSelected}
          onSelectAll={toggleSelectAll}
          selectedIds={selectedIds}
          onRowSelect={toggleSelect}
          getRowId={(row) => row.id}
          actions={(row) => (
            <>
              {can(user, "provision_student_logins") && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Create Portal Logins"
                  disabled={provisioningId === row.id || provisionBusy}
                  onClick={() => provisionCreds(row)}
                >
                  {provisioningId === row.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <KeyRound className="w-4 h-4" />
                  )}
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setDialogOpen(true); }}>
                <Pencil className="w-4 h-4" />
              </Button>
            </>
          )}
        />
      ) : (
        renderClassCards()
      )}

      <StudentFormDialog open={dialogOpen} onOpenChange={setDialogOpen} student={editing} onSave={handleSave} tenantId={user?.tenant_id} />
      {can(user, "submit_plan_change") && (
        <PlanChangeRequestDialog
          open={planDialogOpen}
          onOpenChange={setPlanDialogOpen}
          plans={plans}
          currentPlanId={tenant?.subscription_plan_id}
        />
      )}
      <PortalLoginSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tenant={tenant}
        onSaved={() => {
          if (!user?.tenant_id) return;
          appClient.functions.invoke("getMyTenant", { tenant_id: user.tenant_id })
            .then((res) => setTenant(res.data?.tenant || null))
            .catch(() => {});
        }}
      />
      <CredentialRevealModal
        open={credRows.length > 0}
        onOpenChange={(openState) => { if (!openState) { setCredRows([]); setCredDefaultPassword(""); } }}
        rows={credRows}
        defaultPassword={credDefaultPassword}
      />
      <StudentImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        tenantId={user?.tenant_id}
        onImported={({ created, updated, credentialRows = [], defaultPassword = "", syncWarnings = [] }) => {
          toast({ title: "Import complete", description: `${created} new student${created !== 1 ? "s" : ""} added, ${updated} existing updated${credentialRows.length ? `, ${credentialRows.length} portal login${credentialRows.length > 1 ? "s" : ""} generated` : ""}.` });
          if (syncWarnings.length) toast({ title: "Import warnings", description: syncWarnings.join(" "), variant: "destructive" });
          if (credentialRows.length) {
            setCredRows(credentialRows);
            setCredDefaultPassword(defaultPassword || "");
          }
          load();
        }}
      />

      <AlertDialog open={!!provisionPreview} onOpenChange={(open) => { if (!open) setProvisionPreview(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create portal logins</AlertDialogTitle>
            <AlertDialogDescription>
              {provisionPreview
                ? `${provisionPreview.missing_count} of ${provisionPreview.scanned} student${
                    provisionPreview.scanned === 1 ? "" : "s"
                  } in scope have no portal login yet. Checking them now will create the missing student and parent logins, all with the institution default password, which each user must change on first sign-in. Accounts that already exist are reused and their passwords are left untouched.`
                : ""}
              {provisionPreview?.emails_to_generate
                ? ` ${provisionPreview.emails_to_generate} of those have no email address yet, so one will be generated and saved on the student record.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {provisionPreview?.sample?.length ? (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-stone-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-stone-50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-stone-600">Student</th>
                    <th className="px-3 py-2 font-semibold text-stone-600">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {provisionPreview.sample.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-stone-800">{s.full_name || "—"}</td>
                      <td className="px-3 py-2 font-mono text-stone-600">{s.student_email || <span className="text-amber-600">will be generated</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {provisionPreview.missing_count > provisionPreview.sample.length && (
                <p className="border-t border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
                  +{provisionPreview.missing_count - provisionPreview.sample.length} more
                </p>
              )}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runProvisionAll}>Create logins</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PullToRefresh>
  );
}