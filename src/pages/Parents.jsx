import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  Users, Plus, Pencil, Trash2, Link2, Search, GraduationCap, X, AlertTriangle,
  Phone, Mail, ExternalLink, RotateCcw
} from "lucide-react";
import { StatusBadge } from "@/lib/statusTokens";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

export default function Parents() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const isManageAllowed = can(user, "manage_crm");

  const [parents, setParents] = useState([]);
  const [links, setLinks] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & View Mode
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [viewMode, setViewMode] = useState("parents"); // "parents" | "students"

  // Modals
  const [parentDialogOpen, setParentDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingParent, setEditingParent] = useState(null);
  const [selectedParentForLink, setSelectedParentForLink] = useState(null);
  const [selectedStudentForLink, setSelectedStudentForLink] = useState(null);

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const requestDelete = ({ title, description, confirmLabel, action }) => {
    setDeleteConfirm({
      title,
      description,
      confirmLabel,
      onConfirm: async () => {
        try {
          await action();
        } catch (err) {
          toast({ title: "Operation failed", description: err.message, variant: "destructive" });
        } finally {
          setDeleteConfirm(null);
        }
      },
    });
  };

  // Parent form state
  const [parentForm, setParentForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    relationship_type: "parent",
    is_primary: true,
    address: "",
    occupation: "",
    status: "active",
  });

  // Link child/parent form state
  const [linkForm, setLinkForm] = useState({
    parent_id: "",
    student_id: "",
    relationship: "mother",
    is_primary: true,
    is_emergency_contact: true,
    can_pickup: true,
  });

  const load = async () => {
    if (!user?.tenant_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pList, lList, sList] = await Promise.all([
        appClient.entities.Parent.filter({ tenant_id: user.tenant_id }, "-created_date").catch(() => []),
        appClient.entities.ParentStudent.filter({ tenant_id: user.tenant_id }).catch(() => []),
        appClient.entities.Student.filter({ tenant_id: user.tenant_id }, "full_name").catch(() => []),
      ]);
      setParents(pList || []);
      setLinks(lList || []);
      setStudents(sList || []);
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load parents", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.tenant_id]);

  // Lookup maps for instant association
  const parentMap = useMemo(() => Object.fromEntries(parents.map((p) => [p.id, p])), [parents]);
  const studentMap = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s])), [students]);

  const linksByParent = useMemo(() => {
    const map = {};
    for (const p of parents) map[p.id] = [];
    for (const l of links) {
      if (!map[l.parent_id]) map[l.parent_id] = [];
      map[l.parent_id].push(l);
    }
    return map;
  }, [parents, links]);

  const linksByStudent = useMemo(() => {
    const map = {};
    for (const s of students) map[s.id] = [];
    for (const l of links) {
      if (!map[l.student_id]) map[l.student_id] = [];
      map[l.student_id].push(l);
    }
    return map;
  }, [students, links]);

  // Extract all distinct configured classes
  const availableClasses = useMemo(() => {
    const set = new Set();
    students.forEach((s) => {
      if (s.class_name) set.add(s.class_name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  // Operational metrics
  const linkedStudentCount = useMemo(() => {
    const set = new Set(links.map((l) => l.student_id).filter(Boolean));
    return set.size;
  }, [links]);

  const unparentedStudentCount = useMemo(() => {
    return Math.max(0, students.length - linkedStudentCount);
  }, [students.length, linkedStudentCount]);

  // Universal Filter for Parents:
  // Matches parent fields OR any linked student's name, roll no, admission no, or class/section
  const filteredParents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parents.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;

      const pLinks = linksByParent[p.id] || [];
      const linkedStudents = pLinks.map((l) => studentMap[l.student_id]).filter(Boolean);

      if (classFilter !== "all") {
        if (classFilter === "__unassigned__") {
          if (linkedStudents.length > 0) return false;
        } else {
          const inClass = linkedStudents.some((s) => s.class_name === classFilter);
          if (!inClass) return false;
        }
      }

      if (!q) return true;

      // 1. Parent properties
      const parentMatch =
        (p.full_name || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.phone || "").toLowerCase().includes(q) ||
        (p.occupation || "").toLowerCase().includes(q) ||
        (p.relationship_type || "").toLowerCase().includes(q);

      if (parentMatch) return true;

      // 2. Linked student properties
      return linkedStudents.some((s) =>
        (s.full_name || "").toLowerCase().includes(q) ||
        (s.admission_number || "").toLowerCase().includes(q) ||
        (s.roll_number || "").toLowerCase().includes(q) ||
        (s.class_name || "").toLowerCase().includes(q) ||
        (s.section || "").toLowerCase().includes(q)
      );
    });
  }, [parents, linksByParent, studentMap, search, statusFilter, classFilter]);

  // Universal Filter for Students (for 'By Student' view):
  // Matches student fields OR any linked parent's name, email, or phone
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter !== "all") {
        if (classFilter === "__unassigned__") {
          if (s.class_name) return false;
        } else if (s.class_name !== classFilter) {
          return false;
        }
      }

      const sLinks = linksByStudent[s.id] || [];
      const linkedParents = sLinks.map((l) => parentMap[l.parent_id]).filter(Boolean);

      if (statusFilter !== "all") {
        if (linkedParents.length === 0) return false;
        if (!linkedParents.some((p) => p.status === statusFilter)) return false;
      }

      if (!q) return true;

      // 1. Student properties
      const studentMatch =
        (s.full_name || "").toLowerCase().includes(q) ||
        (s.admission_number || "").toLowerCase().includes(q) ||
        (s.roll_number || "").toLowerCase().includes(q) ||
        (s.class_name || "").toLowerCase().includes(q) ||
        (s.section || "").toLowerCase().includes(q);

      if (studentMatch) return true;

      // 2. Linked parent properties
      return linkedParents.some((p) =>
        (p.full_name || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.phone || "").toLowerCase().includes(q) ||
        (p.relationship_type || "").toLowerCase().includes(q)
      );
    });
  }, [students, linksByStudent, parentMap, search, statusFilter, classFilter]);

  // Group parents by the class of their linked children
  const parentGroups = useMemo(() => {
    const map = {};
    for (const p of filteredParents) {
      const ownedLinks = linksByParent[p.id] || [];
      const childStudents = ownedLinks
        .map((l) => studentMap[l.student_id])
        .filter(Boolean);
      const classNames = [...new Set(childStudents.map((c) => c.class_name).filter(Boolean))];
      if (classNames.length === 0) {
        if (!map.__unassigned__) map.__unassigned__ = [];
        map.__unassigned__.push({ parent: p, children: childStudents, ownedLinks });
        continue;
      }
      for (const className of classNames) {
        if (!map[className]) map[className] = [];
        const already = map[className].some((entry) => entry.parent.id === p.id);
        if (!already) {
          const childrenInClass = childStudents.filter((c) => c.class_name === className);
          map[className].push({ parent: p, children: childrenInClass, ownedLinks });
        }
      }
    }
    const classNames = Object.keys(map).filter((k) => k !== "__unassigned__").sort((a, b) => a.localeCompare(b));
    return {
      unassigned: map.__unassigned__ || [],
      byClass: classNames.map((name) => ({ className: name, entries: map[name] })),
    };
  }, [filteredParents, linksByParent, studentMap]);

  // Group students by class for 'By Student' view
  const studentGroupsByClass = useMemo(() => {
    const map = {};
    for (const s of filteredStudents) {
      const cls = s.class_name || "Unassigned";
      if (!map[cls]) map[cls] = [];
      map[cls].push(s);
    }
    const classNames = Object.keys(map).sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });
    return classNames.map((className) => ({
      className,
      students: map[className],
    }));
  }, [filteredStudents]);

  // Open Add/Edit Parent Dialog
  const handleOpenParentDialog = (p = null) => {
    if (p) {
      setEditingParent(p);
      setParentForm({
        full_name: p.full_name || "",
        email: p.email || "",
        phone: p.phone || "",
        relationship_type: p.relationship_type || "parent",
        is_primary: p.is_primary !== false,
        address: p.address || "",
        occupation: p.occupation || "",
        status: p.status || "active",
      });
    } else {
      setEditingParent(null);
      setParentForm({
        full_name: "",
        email: "",
        phone: "",
        relationship_type: "parent",
        is_primary: true,
        address: "",
        occupation: "",
        status: "active",
      });
    }
    setParentDialogOpen(true);
  };

  const handleSaveParent = async (e) => {
    e.preventDefault();
    if (!parentForm.full_name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      if (editingParent) {
        await appClient.entities.Parent.update(editingParent.id, parentForm);
        await logAudit({ user, action: "update", entity_type: "Parent", entity_id: editingParent.id, details: parentForm.full_name });
        toast({ title: "Parent updated successfully" });
      } else {
        const created = await appClient.entities.Parent.create({ ...parentForm, tenant_id: user.tenant_id });
        await logAudit({ user, action: "create", entity_type: "Parent", entity_id: created.id, details: parentForm.full_name });
        toast({ title: "Parent created successfully" });
      }
      setParentDialogOpen(false);
      load();
    } catch (err) {
      toast({ title: "Failed to save parent", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteParent = (p) => {
    requestDelete({
      title: "Delete parent profile?",
      description: `Delete ${p.full_name}? Any linked student connections will be removed.`,
      confirmLabel: "Delete",
      action: async () => {
        const parentLinks = links.filter((l) => l.parent_id === p.id);
        for (const l of parentLinks) {
          await appClient.entities.ParentStudent.delete(l.id).catch(() => {});
        }
        await appClient.entities.Parent.delete(p.id);
        await logAudit({ user, action: "delete", entity_type: "Parent", entity_id: p.id, details: p.full_name });
        toast({ title: "Parent deleted" });
        load();
      },
    });
  };

  // Open Link Dialog from a Parent Row
  const handleOpenLinkDialog = (parent) => {
    setSelectedParentForLink(parent);
    setSelectedStudentForLink(null);
    setLinkForm({
      parent_id: parent.id,
      student_id: "",
      relationship: parent.relationship_type || "mother",
      is_primary: true,
      is_emergency_contact: true,
      can_pickup: true,
    });
    setLinkDialogOpen(true);
  };

  // Open Link Dialog from a Student Row
  const handleOpenLinkFromStudent = (student) => {
    setSelectedStudentForLink(student);
    setSelectedParentForLink(null);
    setLinkForm({
      parent_id: "",
      student_id: student.id,
      relationship: "mother",
      is_primary: true,
      is_emergency_contact: true,
      can_pickup: true,
    });
    setLinkDialogOpen(true);
  };

  const handleSaveLink = async (e) => {
    e.preventDefault();
    const studentId = linkForm.student_id || selectedStudentForLink?.id;
    const parentId = linkForm.parent_id || selectedParentForLink?.id;

    if (!studentId) {
      toast({ title: "Please select a student", variant: "destructive" });
      return;
    }
    if (!parentId) {
      toast({ title: "Please select a parent", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        tenant_id: user.tenant_id,
        parent_id: parentId,
        student_id: studentId,
        relationship: linkForm.relationship,
        is_primary: Boolean(linkForm.is_primary),
        is_emergency_contact: Boolean(linkForm.is_emergency_contact),
        can_pickup: Boolean(linkForm.can_pickup),
      };
      const created = await appClient.entities.ParentStudent.create(payload);
      const studentObj = students.find((s) => s.id === studentId);
      const parentObj = parents.find((p) => p.id === parentId);
      await logAudit({
        user,
        action: "create",
        entity_type: "ParentStudent",
        entity_id: created.id,
        details: `Linked ${parentObj?.full_name || parentId} -> ${studentObj?.full_name || studentId}`,
      });
      toast({ title: "Relationship linked successfully" });
      setLinkDialogOpen(false);
      setSelectedParentForLink(null);
      setSelectedStudentForLink(null);
      load();
    } catch (err) {
      toast({ title: "Failed to link relationship", description: err.message, variant: "destructive" });
    }
  };

  const handleUnlinkChild = (linkId, studentName, parentName) => {
    requestDelete({
      title: "Unlink child?",
      description: `Unlink ${studentName} from ${parentName}? The parent link will be removed.`,
      confirmLabel: "Unlink",
      action: async () => {
        await appClient.entities.ParentStudent.delete(linkId);
        await logAudit({
          user,
          action: "delete",
          entity_type: "ParentStudent",
          entity_id: linkId,
          details: `Unlinked ${studentName} from ${parentName}`,
        });
        toast({ title: "Link removed" });
        load();
      },
    });
  };

  const handleResetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setClassFilter("all");
  };

  // Render a Parent Row
  const renderParentRow = ({ parent, ownedLinks }) => {
    const rowLinks = ownedLinks || linksByParent[parent.id] || [];
    const q = search.trim().toLowerCase();

    return (
      <div key={parent.id} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white hover:bg-stone-50/60 transition-colors">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-900">{parent.full_name}</span>
            <Badge variant="outline" className="text-[11px] capitalize bg-stone-50">{parent.relationship_type || "Parent"}</Badge>
          </div>
          {parent.occupation && <p className="text-xs text-stone-500 mt-0.5">{parent.occupation}</p>}
        </div>

        <div className="w-56 text-sm">
          {parent.phone ? (
            <a href={`tel:${parent.phone}`} className="inline-flex items-center gap-1.5 text-stone-800 hover:text-indigo-600 font-medium">
              <Phone className="w-3.5 h-3.5 text-stone-400" />
              <span>{parent.phone}</span>
            </a>
          ) : (
            <span className="text-xs text-stone-400 italic">No phone</span>
          )}
          {parent.email ? (
            <p className="text-xs text-stone-500 truncate flex items-center gap-1 mt-0.5">
              <Mail className="w-3 h-3 text-stone-400 shrink-0" />
              <span className="truncate">{parent.email}</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5 max-w-md">
          {rowLinks.length === 0 && (
            <span className="text-xs text-stone-400 italic flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" /> No children linked
            </span>
          )}
          {rowLinks.map((l) => {
            const child = studentMap[l.student_id];
            const isMatch = q && child && (
              (child.full_name || "").toLowerCase().includes(q) ||
              (child.roll_number || "").toLowerCase().includes(q) ||
              (child.admission_number || "").toLowerCase().includes(q)
            );

            return (
              <span
                key={l.id}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition ${
                  isMatch
                    ? "bg-amber-100 text-amber-950 border-amber-300 font-semibold ring-1 ring-amber-400/50"
                    : "bg-indigo-50 text-indigo-700 border-indigo-200"
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                <Link to={`/students/${child?.id}`} className="hover:underline font-medium">
                  {child?.full_name || "Student"}
                </Link>
                {child?.section && <span className="text-stone-500">· Sec {child.section}</span>}
                {child?.roll_number && <span className="text-stone-500 font-mono">· Roll {child.roll_number}</span>}
                <span className="text-[11px] text-stone-500 capitalize">({l.relationship || "child"})</span>
                {isManageAllowed && (
                  <button
                    onClick={() => handleUnlinkChild(l.id, child?.full_name || "Student", parent.full_name)}
                    className="ml-1 text-stone-400 hover:text-red-600 transition"
                    title="Unlink child"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>

        <StatusBadge status={parent.status || "active"} type="tenant" />

        {isManageAllowed && (
          <div className="flex items-center gap-1 ml-auto">
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => handleOpenLinkDialog(parent)} title="Link child">
              <Link2 className="w-3.5 h-3.5 mr-1 text-indigo-600" /> Link
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleOpenParentDialog(parent)} title="Edit profile">
              <Pencil className="w-3.5 h-3.5 text-stone-600" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600 hover:bg-red-50" onClick={() => handleDeleteParent(parent)} title="Delete parent">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Render a Student Row (for 'By Student' View)
  const renderStudentRow = (student) => {
    const sLinks = linksByStudent[student.id] || [];
    const primaryLink = sLinks.find((l) => l.is_primary) || sLinks[0];
    const primaryParent = primaryLink ? parentMap[primaryLink.parent_id] : null;

    return (
      <div key={student.id} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white hover:bg-stone-50/60 transition-colors">
        {/* Student Details */}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <Link
              to={`/students/${student.id}`}
              className="text-sm font-semibold text-stone-900 hover:text-indigo-600 transition"
            >
              {student.full_name}
            </Link>
            <Badge variant="outline" className="text-[11px] bg-stone-50 text-stone-700">
              {student.class_name ? `Class ${student.class_name}` : "Unassigned"}
              {student.section ? ` · Sec ${student.section}` : ""}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-stone-500 font-mono">
            {student.roll_number && <span>Roll: {student.roll_number}</span>}
            {student.roll_number && student.admission_number && <span>·</span>}
            {student.admission_number && <span>Adm: {student.admission_number}</span>}
          </div>
        </div>

        {/* Linked Guardians */}
        <div className="flex-1 min-w-[240px] flex flex-wrap gap-1.5 items-center">
          {sLinks.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              No guardian linked
            </span>
          ) : (
            sLinks.map((l) => {
              const parent = parentMap[l.parent_id];
              if (!parent) return null;
              return (
                <span
                  key={l.id}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition ${
                    l.is_primary
                      ? "bg-indigo-50 text-indigo-900 border-indigo-200 font-medium"
                      : "bg-stone-50 text-stone-800 border-stone-200"
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>{parent.full_name}</span>
                  <span className="text-[11px] text-stone-500 capitalize">
                    ({l.relationship || parent.relationship_type || "Guardian"})
                  </span>
                  {l.is_primary && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-200/80 text-indigo-800 font-semibold uppercase">
                      Primary
                    </span>
                  )}
                  {isManageAllowed && (
                    <button
                      onClick={() => handleUnlinkChild(l.id, student.full_name, parent.full_name)}
                      className="ml-1 text-stone-400 hover:text-red-600 transition"
                      title={`Unlink ${parent.full_name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            })
          )}
        </div>

        {/* Primary Contact (Phone & Email) */}
        <div className="w-56 text-xs">
          {primaryParent ? (
            <div className="space-y-0.5">
              {primaryParent.phone ? (
                <a
                  href={`tel:${primaryParent.phone}`}
                  className="inline-flex items-center gap-1.5 text-stone-800 hover:text-indigo-600 font-medium"
                >
                  <Phone className="w-3.5 h-3.5 text-stone-400" />
                  <span>{primaryParent.phone}</span>
                </a>
              ) : (
                <span className="text-stone-400 italic">No phone</span>
              )}
              {primaryParent.email ? (
                <p className="text-stone-500 truncate flex items-center gap-1">
                  <Mail className="w-3 h-3 text-stone-400 shrink-0" />
                  <span className="truncate">{primaryParent.email}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-stone-400 italic">No contact available</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 ml-auto">
          {isManageAllowed && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={() => handleOpenLinkFromStudent(student)}
              title="Link Parent to this student"
            >
              <Plus className="w-3.5 h-3.5 mr-1 text-indigo-600" /> Link Parent
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" asChild title="View Student Detail">
            <Link to={`/students/${student.id}`}>
              <ExternalLink className="w-3.5 h-3.5 text-stone-500" />
            </Link>
          </Button>
        </div>
      </div>
    );
  };

  const isFilterActive = Boolean(search.trim() || statusFilter !== "all" || classFilter !== "all");

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Parents & Guardians"
        description="Search, manage and link student guardians, emergency contacts and pickup authorizations."
        actions={
          isManageAllowed ? (
            <Button onClick={() => handleOpenParentDialog(null)}>
              <Plus className="w-4 h-4 mr-2" /> Add Parent
            </Button>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Oversight (View-Only)
            </Badge>
          )
        }
      />

      {/* Operational KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Parents" value={parents.length} icon={Users} accent="text-indigo-600" />
        <StatCard label="Linked Students" value={linkedStudentCount} icon={GraduationCap} accent="text-emerald-600" subtext={`${students.length} total enrolled`} />
        <StatCard
          label="Unparented Students"
          value={unparentedStudentCount}
          icon={AlertTriangle}
          accent={unparentedStudentCount > 0 ? "text-amber-600" : "text-stone-600"}
          subtext={unparentedStudentCount > 0 ? "Missing guardian link" : "All students linked"}
        />
        <StatCard label="Guardian Links" value={links.length} icon={Link2} accent="text-purple-600" subtext="Active relationships" />
      </div>

      {/* Universal Search, Class Filter & View Switcher Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Input with Clear Button */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input
              placeholder="Search by parent, student, roll no, admission no..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8 h-9 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filters & View Switcher Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Class Filter */}
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {availableClasses.map((c) => (
                  <SelectItem key={c} value={c}>Class {c}</SelectItem>
                ))}
                <SelectItem value="__unassigned__">Unassigned (No Class)</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-28 h-9 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>

            {isFilterActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-9 px-2 text-xs text-stone-500 hover:text-stone-900"
                title="Reset filters"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
              </Button>
            )}

            {/* View Mode Toggle Switch */}
            <div className="inline-flex items-center rounded-lg border border-stone-200 bg-stone-100 p-0.5 ml-auto">
              <button
                type="button"
                onClick={() => setViewMode("parents")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  viewMode === "parents"
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                <Users className="w-3.5 h-3.5 inline mr-1.5" />
                By Parent ({filteredParents.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode("students")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  viewMode === "students"
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                <GraduationCap className="w-3.5 h-3.5 inline mr-1.5" />
                By Student ({filteredStudents.length})
              </button>
            </div>
          </div>
        </div>

        {/* Search match hint */}
        {search && (
          <div className="flex items-center gap-2 pt-2 border-t border-stone-100 text-xs text-stone-500">
            <span>Showing results matching <strong>"{search}"</strong> across parent and linked student records.</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="text-center py-16 text-stone-400 bg-white rounded-2xl border border-stone-200 shadow-sm">
          <Users className="w-10 h-10 mx-auto mb-2 text-stone-300 animate-pulse" />
          <p className="text-sm font-medium">Loading parents and student links...</p>
        </div>
      ) : error ? (
        <div className="text-center py-16 text-red-500 bg-white rounded-2xl border border-stone-200 shadow-sm">
          <p className="text-sm font-medium">{error.message || "Failed to load parents"}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>Retry</Button>
        </div>
      ) : viewMode === "parents" ? (
        /* ==================== BY PARENT VIEW ==================== */
        filteredParents.length === 0 ? (
          <div className="text-center py-16 text-stone-400 bg-white rounded-2xl border border-stone-200 shadow-sm space-y-3">
            <Users className="w-10 h-10 mx-auto text-stone-300" />
            <p className="text-sm font-medium text-stone-700">No parents matched your search or filters.</p>
            {isFilterActive && (
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                Clear Search & Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {parentGroups.unassigned.length > 0 && (
              <section>
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 bg-stone-50/50">
                    <h3 className="text-sm font-semibold text-stone-800">Unassigned</h3>
                    <Badge variant="outline" className="text-[11px] text-amber-700 bg-amber-50 border-amber-200">
                      No linked children
                    </Badge>
                    <span className="text-xs text-stone-400">{parentGroups.unassigned.length} parent{parentGroups.unassigned.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-amber-100 bg-amber-50/40">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <p className="text-xs text-amber-800">Link these parents to a student using the "Link" button.</p>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {parentGroups.unassigned.map(renderParentRow)}
                  </div>
                </div>
              </section>
            )}

            {parentGroups.byClass.map(({ className, entries }) => (
              <section key={className}>
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 bg-stone-50/50">
                    <h3 className="text-sm font-semibold text-stone-800">Class {className}</h3>
                    <Badge variant="outline" className="text-[11px] bg-indigo-50 text-indigo-700 border-indigo-200">
                      {entries.length} parent{entries.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {entries.map(renderParentRow)}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        /* ==================== BY STUDENT VIEW ==================== */
        filteredStudents.length === 0 ? (
          <div className="text-center py-16 text-stone-400 bg-white rounded-2xl border border-stone-200 shadow-sm space-y-3">
            <GraduationCap className="w-10 h-10 mx-auto text-stone-300" />
            <p className="text-sm font-medium text-stone-700">No students matched your search or filters.</p>
            {isFilterActive && (
              <Button variant="outline" size="sm" onClick={handleResetFilters}>
                Clear Search & Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {studentGroupsByClass.map(({ className, students: classStudents }) => (
              <section key={className}>
                <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100 bg-stone-50/50">
                    <h3 className="text-sm font-semibold text-stone-800">
                      {className === "Unassigned" ? "Unassigned Class" : `Class ${className}`}
                    </h3>
                    <Badge variant="outline" className="text-[11px] bg-indigo-50 text-indigo-700 border-indigo-200">
                      {classStudents.length} student{classStudents.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {classStudents.map(renderStudentRow)}
                  </div>
                </div>
              </section>
            ))}
          </div>
        )
      )}

      {/* Add / Edit Parent Modal */}
      <Dialog open={parentDialogOpen} onOpenChange={setParentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingParent ? "Edit Parent Profile" : "Register Parent"}</DialogTitle>
          </DialogHeader>
          <form id="parent-form" onSubmit={handleSaveParent} className="space-y-4">
            <div>
              <Label htmlFor="parent-name">Full Name *</Label>
              <Input
                id="parent-name"
                value={parentForm.full_name}
                onChange={(e) => setParentForm({ ...parentForm, full_name: e.target.value })}
                placeholder="Parent/Guardian Full Name"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="parent-phone">Phone Number</Label>
                <Input
                  id="parent-phone"
                  value={parentForm.phone}
                  onChange={(e) => setParentForm({ ...parentForm, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div>
                <Label htmlFor="parent-email">Email Address</Label>
                <Input
                  id="parent-email"
                  type="email"
                  value={parentForm.email}
                  onChange={(e) => setParentForm({ ...parentForm, email: e.target.value })}
                  placeholder="parent@example.com"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="parent-rel">Default Relationship</Label>
                <Select
                  value={parentForm.relationship_type}
                  onValueChange={(val) => setParentForm({ ...parentForm, relationship_type: val })}
                >
                  <SelectTrigger id="parent-rel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="father">Father</SelectItem>
                    <SelectItem value="mother">Mother</SelectItem>
                    <SelectItem value="guardian">Legal Guardian</SelectItem>
                    <SelectItem value="parent">Parent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="parent-status">Account Status</Label>
                <Select
                  value={parentForm.status}
                  onValueChange={(val) => setParentForm({ ...parentForm, status: val })}
                >
                  <SelectTrigger id="parent-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="parent-occ">Occupation</Label>
              <Input
                id="parent-occ"
                value={parentForm.occupation}
                onChange={(e) => setParentForm({ ...parentForm, occupation: e.target.value })}
                placeholder="e.g. Software Engineer, Doctor, Business"
              />
            </div>
            <div>
              <Label htmlFor="parent-addr">Residential Address</Label>
              <Input
                id="parent-addr"
                value={parentForm.address}
                onChange={(e) => setParentForm({ ...parentForm, address: e.target.value })}
                placeholder="Street address, City, PIN"
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setParentDialogOpen(false)}>Cancel</Button>
            <Button type="submit" form="parent-form">{editingParent ? "Update Parent" : "Register Parent"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Relationship Dialog (Supports both Parent -> Student and Student -> Parent) */}
      <Dialog open={linkDialogOpen} onOpenChange={(open) => {
        setLinkDialogOpen(open);
        if (!open) {
          setSelectedParentForLink(null);
          setSelectedStudentForLink(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedParentForLink
                ? `Link Student to ${selectedParentForLink.full_name}`
                : selectedStudentForLink
                ? `Link Guardian to ${selectedStudentForLink.full_name}`
                : "Create Parent-Student Relationship"}
            </DialogTitle>
          </DialogHeader>
          <form id="link-form" onSubmit={handleSaveLink} className="space-y-4">
            {selectedParentForLink ? (
              <div>
                <Label htmlFor="link-student">Select Student *</Label>
                <Select
                  value={linkForm.student_id}
                  onValueChange={(val) => setLinkForm({ ...linkForm, student_id: val })}
                >
                  <SelectTrigger id="link-student">
                    <SelectValue placeholder="Choose a student..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name} ({s.class_name ? `Class ${s.class_name}` : "Unassigned"}{s.section ? ` · Sec ${s.section}` : ""}{s.roll_number ? ` · Roll ${s.roll_number}` : ""})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : selectedStudentForLink ? (
              <div>
                <Label htmlFor="link-parent">Select Parent / Guardian *</Label>
                <Select
                  value={linkForm.parent_id}
                  onValueChange={(val) => setLinkForm({ ...linkForm, parent_id: val })}
                >
                  <SelectTrigger id="link-parent">
                    <SelectValue placeholder="Choose a parent/guardian..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {parents.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name} ({p.relationship_type || "Parent"}{p.phone ? ` · ${p.phone}` : ""})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div>
              <Label htmlFor="link-rel">Relationship</Label>
              <Select
                value={linkForm.relationship}
                onValueChange={(val) => setLinkForm({ ...linkForm, relationship: val })}
              >
                <SelectTrigger id="link-rel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="father">Father</SelectItem>
                  <SelectItem value="mother">Mother</SelectItem>
                  <SelectItem value="guardian">Legal Guardian</SelectItem>
                  <SelectItem value="relative">Relative</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 pt-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="link-is-primary"
                  checked={linkForm.is_primary}
                  onCheckedChange={(c) => setLinkForm({ ...linkForm, is_primary: Boolean(c) })}
                />
                <Label htmlFor="link-is-primary" className="text-sm font-normal">Primary guardian for this student</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="link-is-emergency"
                  checked={linkForm.is_emergency_contact}
                  onCheckedChange={(c) => setLinkForm({ ...linkForm, is_emergency_contact: Boolean(c) })}
                />
                <Label htmlFor="link-is-emergency" className="text-sm font-normal">Emergency contact person</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="link-can-pickup"
                  checked={linkForm.can_pickup}
                  onCheckedChange={(c) => setLinkForm({ ...linkForm, can_pickup: Boolean(c) })}
                />
                <Label htmlFor="link-can-pickup" className="text-sm font-normal">Authorized for school pickup</Label>
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              form="link-form"
              disabled={
                (!linkForm.student_id && !selectedStudentForLink) ||
                (!linkForm.parent_id && !selectedParentForLink)
              }
            >
              Confirm Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => !v && setDeleteConfirm(null)}
        title={deleteConfirm?.title}
        description={deleteConfirm?.description}
        confirmLabel={deleteConfirm?.confirmLabel}
        onConfirm={deleteConfirm?.onConfirm}
      />
    </div>
  );
}