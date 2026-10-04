import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import { portalUrl } from "@/lib/utils";
import { startImpersonation } from "@/lib/impersonation";
import { hasAnyRole, APP_ROLES } from "@/lib/roles";
import { useToast } from "@/components/ui/use-toast";
import { StatusBadge } from "@/lib/statusTokens";
import CustomDomainStatus from "@/components/branding/CustomDomainStatus";

import PageHeader from "@/components/shared/PageHeader";
import ListPagination from "@/components/shared/ListPagination";
import { ErrorCard } from "@/components/shared/Skeletons";

import TenantFormDialog from "@/components/tenants/TenantFormDialog";
import CreateAdminDialog from "@/components/tenants/CreateAdminDialog";
import ConfirmStatusDialog from "@/components/tenants/ConfirmStatusDialog";
import InstitutionDetailDrawer from "@/components/tenants/InstitutionDetailDrawer";
import InstitutionCard from "@/components/tenants/InstitutionCard";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2,
  Plus,
  Pencil,
  Ban,
  CheckCircle2,
  LogIn,
  UserPlus,
  Search,
  Globe,
  LayoutGrid,
  List,
  Download,
  RefreshCw,
  X,
  Sparkles,
  MoreVertical,
  Eye,
  CreditCard,
  Check,
  Copy,
  ExternalLink,
  Users,
  GraduationCap,
} from "lucide-react";

export default function Tenants() {
  const { user } = useOutletContext() || {};
  // Union: the platform owner is whoever holds super_admin, whether or not it is
  // also their primary role. Seven call sites below branch on this to expose
  // cross-tenant actions, so it must not miss an account that merely carries the
  // role second.
  const isPlatformOwner = hasAnyRole(user, [APP_ROLES.SUPER_ADMIN]);
  const { toast } = useToast();

  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filtering
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'active' | 'suspended'
  const [planFilter, setPlanFilter] = useState("all");
  const [featureFilter, setFeatureFilter] = useState("all"); // 'all' | 'custom_domain' | 'white_label'
  const [sortBy, setSortBy] = useState("newest"); // 'newest' | 'oldest' | 'name-asc' | 'name-desc'
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'table'

  // Pagination
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  // Dialog & Drawer States
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);

  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [adminTargetTenant, setAdminTargetTenant] = useState(null);

  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);
  const [statusTargetTenant, setStatusTargetTenant] = useState(null);
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);

  const [activatingId, setActivatingId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Load Data
  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [tList, pList] = await Promise.all([
        appClient.entities.Tenant.list("-created_date"),
        appClient.entities.SubscriptionPlan.list(),
      ]);
      setTenants(tList || []);
      setPlans(pList || []);
      if (isManualRefresh) {
        toast({ title: "Institutions refreshed successfully" });
      }
    } catch (err) {
      setError(err);
      toast({
        title: "Failed to load institutions",
        description: "Please check network connection and try again.",
        variant: "destructive",
      });
      console.error("Error loading institutions:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Save Tenant (Create or Edit)
  const handleSaveTenant = async (data) => {
    try {
      const payload = { ...data };
      delete payload._id;
      delete payload.id;

      if (editingTenant) {
        await appClient.entities.Tenant.update(editingTenant.id, payload);
        await logAudit({
          user,
          action: "update",
          entity_type: "Tenant",
          entity_id: editingTenant.id,
          details: payload.name,
        });
        toast({ title: "Institution updated successfully" });
      } else {
        const created = await appClient.entities.Tenant.create(payload);
        await logAudit({
          user,
          action: "create",
          entity_type: "Tenant",
          entity_id: created.id,
          details: payload.name,
        });
        toast({
          title: "Institution onboarded successfully",
          description: `${payload.name} is now registered on ExamOS.`,
        });
      }
      setFormDialogOpen(false);
      setEditingTenant(null);
      loadData();
    } catch (err) {
      toast({
        title: "Failed to save institution",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  // Toggle Institution Status
  const handlePromptToggleStatus = (tenant) => {
    setStatusTargetTenant(tenant);
    setConfirmStatusOpen(true);
  };

  const handleConfirmStatus = async (tenant) => {
    if (!tenant) return;
    setStatusSubmitting(true);
    const newStatus = tenant.status === "active" ? "suspended" : "active";

    try {
      await appClient.entities.Tenant.update(tenant.id, { status: newStatus });
      await logAudit({
        user,
        action: newStatus === "suspended" ? "suspend" : "activate",
        entity_type: "Tenant",
        entity_id: tenant.id,
        details: tenant.name,
      });

      toast({
        title:
          newStatus === "suspended"
            ? "Institution suspended"
            : "Institution activated",
        description: `${tenant.name} is now ${newStatus}.`,
      });

      setConfirmStatusOpen(false);
      setStatusTargetTenant(null);
      loadData();
    } catch (err) {
      toast({
        title: "Failed to update institution status",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setStatusSubmitting(false);
    }
  };

  // Activate Custom Domain
  const activateCustomDomain = async (tenant) => {
    setActivatingId(tenant.id);
    try {
      const { data } = await appClient.functions.invoke("manageCustomDomain", {
        action: "activate",
        tenant_id: tenant.id,
      });

      toast({
        title: data?.live ? "Custom domain activated" : "Activation failed",
        description: data?.message,
        variant: data?.live ? undefined : "destructive",
      });

      await logAudit({
        user,
        action: data?.live
          ? "activate_custom_domain"
          : "activate_custom_domain_failed",
        entity_type: "Tenant",
        entity_id: tenant.id,
        details: tenant.custom_domain,
      });

      loadData();
    } catch (err) {
      toast({
        title: "Failed to activate domain",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setActivatingId(null);
    }
  };

  // Portal Impersonation (Super Admin convenience)
  const handleImpersonate = async (tenant, portal) => {
    try {
      if (portal === "school_admin") {
        startImpersonation({
          app_role: "school_admin",
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          portal_label: "School Admin",
        });
        window.location.href = "/dashboard";
        return;
      }

      if (portal === "teacher") {
        const teachers = await appClient.entities.Teacher.filter(
          { tenant_id: tenant.id, status: "active" },
          "full_name",
          1
        ).catch(() => []);

        if (teachers.length === 0) {
          toast({
            title: "No active teachers found",
            description: "This institution has no teachers registered yet.",
            variant: "destructive",
          });
          return;
        }

        startImpersonation({
          app_role: "teacher",
          tenant_id: tenant.id,
          tenant_name: tenant.name,
          email: teachers[0].email,
          full_name: teachers[0].full_name,
          portal_label: "Teacher",
        });
        window.location.href = "/teacher-portal";
        return;
      }

      const students = await appClient.entities.Student.filter(
        { tenant_id: tenant.id, status: "active" },
        "roll_number",
        1
      ).catch(() => []);

      if (students.length === 0) {
        toast({
          title: "No active students found",
          description: "This institution has no students registered yet.",
          variant: "destructive",
        });
        return;
      }

      startImpersonation({
        app_role: portal,
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        linked_student_id: students[0].id,
        student_name: students[0].full_name,
        portal_label: portal === "student" ? "Student" : "Parent",
      });
      window.location.href =
        portal === "student" ? "/student-portal" : "/parent-portal";
    } catch (err) {
      toast({
        title: "Portal access failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (tenants.length === 0) {
      toast({ title: "No institutions to export" });
      return;
    }

    const headers = [
      "Name",
      "Subdomain",
      "Portal URL",
      "Custom Domain",
      "Domain Status",
      "Status",
      "Board",
      "Subscription Plan",
      "White Label Enabled",
      "Contact Email",
      "Contact Phone",
      "Address",
      "Created Date",
    ];

    const rows = tenants.map((t) => {
      const plan = plans.find((p) => p.id === t.subscription_plan_id);
      return [
        `"${(t.name || "").replace(/"/g, '""')}"`,
        `"${t.subdomain || ""}"`,
        `"${portalUrl(t.subdomain)}"`,
        `"${t.custom_domain || ""}"`,
        `"${t.custom_domain_status || ""}"`,
        `"${t.status || "active"}"`,
        `"${t.board_type || ""}"`,
        `"${(plan?.name || t.plan_name || "").replace(/"/g, '""')}"`,
        `"${t.white_label_enabled ? "Yes" : "No"}"`,
        `"${t.contact_email || ""}"`,
        `"${t.contact_phone || ""}"`,
        `"${(t.address || "").replace(/"/g, '""')}"`,
        `"${t.created_date ? new Date(t.created_date).toISOString() : ""}"`,
      ];
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `examos_institutions_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: "Institutions exported as CSV" });
  };

  // Helper map for plan name
  const planMap = useMemo(() => {
    const map = new Map();
    plans.forEach((p) => map.set(p.id, p));
    return map;
  }, [plans]);

  // Executive Metric Calculations
  const stats = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter((t) => t.status === "active").length;
    const suspended = total - active;
    const withDomain = tenants.filter((t) => Boolean(t.custom_domain)).length;
    const whiteLabel = tenants.filter((t) => Boolean(t.white_label_enabled)).length;

    const estimatedMRR = tenants.reduce((acc, t) => {
      const p = planMap.get(t.subscription_plan_id);
      return acc + (p?.price || 0);
    }, 0);

    return { total, active, suspended, withDomain, whiteLabel, estimatedMRR };
  }, [tenants, planMap]);

  // Filtering & Sorting Pipeline
  const filtered = useMemo(() => {
    return tenants
      .filter((t) => {
        // Search Term
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchName = t.name?.toLowerCase().includes(q);
          const matchSub = t.subdomain?.toLowerCase().includes(q);
          const matchDom = t.custom_domain?.toLowerCase().includes(q);
          const matchMail = t.contact_email?.toLowerCase().includes(q);
          const matchBoard = t.board_type?.toLowerCase().includes(q);
          if (!matchName && !matchSub && !matchDom && !matchMail && !matchBoard) {
            return false;
          }
        }

        // Status Filter
        if (statusFilter !== "all") {
          const isAct = t.status === "active";
          if (statusFilter === "active" && !isAct) return false;
          if (statusFilter === "suspended" && isAct) return false;
        }

        // Plan Filter
        if (planFilter !== "all") {
          if (t.subscription_plan_id !== planFilter) return false;
        }

        // Feature Filter
        if (featureFilter === "custom_domain" && !t.custom_domain) return false;
        if (featureFilter === "white_label" && !t.white_label_enabled) return false;

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name-asc") return (a.name || "").localeCompare(b.name || "");
        if (sortBy === "name-desc") return (b.name || "").localeCompare(a.name || "");
        if (sortBy === "oldest") {
          return new Date(a.created_date || 0) - new Date(b.created_date || 0);
        }
        // newest (default)
        return new Date(b.created_date || 0) - new Date(a.created_date || 0);
      });
  }, [tenants, searchTerm, statusFilter, planFilter, featureFilter, sortBy]);

  // Paginated Slices
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, planFilter, featureFilter, sortBy]);

  const hasActiveFilters =
    Boolean(searchTerm) ||
    statusFilter !== "all" ||
    planFilter !== "all" ||
    featureFilter !== "all";

  const clearAllFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setPlanFilter("all");
    setFeatureFilter("all");
    setSortBy("newest");
  };

  const handleCopySubdomain = (tenant, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(portalUrl(tenant.subdomain));
    setCopiedId(tenant.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Portal URL copied to clipboard!" });
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-7">
      {/* Header */}
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span>Institutions</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80">
              {stats.total} {stats.total === 1 ? "School" : "Schools"}
            </span>
          </div>
        }
        description={
          isPlatformOwner
            ? "Enterprise multi-tenant directory. Onboard, configure, monitor, and provision school portals across the ExamOS network."
            : "Assigned institutional partners and customer support directory."
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="h-9 text-xs font-medium bg-white"
              title="Refresh list"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin text-indigo-600" : "text-stone-500"}`}
              />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="h-9 text-xs font-medium bg-white"
              title="Export all institutions as CSV"
            >
              <Download className="w-3.5 h-3.5 mr-1.5 text-stone-500" />
              Export CSV
            </Button>

            {isPlatformOwner && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingTenant(null);
                  setFormDialogOpen(true);
                }}
                className="h-9 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white shadow-sm"
              >
                <Plus className="w-4 h-4 mr-1.5" /> Onboard Institution
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Institutions */}
        <div
          onClick={() => setStatusFilter("all")}
          className={`p-5 rounded-2xl border transition-all cursor-pointer shadow-sm ${
            statusFilter === "all"
              ? "bg-white border-indigo-300 ring-2 ring-indigo-500/20 shadow-md"
              : "bg-white border-stone-200/80 hover:border-stone-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Total Network
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-heading font-bold text-stone-900 mt-2">
            {stats.total}
          </p>
          <div className="flex items-center gap-2 mt-2 text-xs text-stone-500 font-medium">
            <span className="text-emerald-600 font-semibold">{stats.active} Active</span>
            <span>·</span>
            <span className="text-stone-400">{stats.suspended} Suspended</span>
          </div>
        </div>

        {/* Active Operations */}
        <div
          onClick={() => setStatusFilter("active")}
          className={`p-5 rounded-2xl border transition-all cursor-pointer shadow-sm ${
            statusFilter === "active"
              ? "bg-white border-emerald-300 ring-2 ring-emerald-500/20 shadow-md"
              : "bg-white border-stone-200/80 hover:border-stone-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Active Operations
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <p className="text-3xl font-heading font-bold text-stone-900">
              {stats.active}
            </p>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
            </span>
          </div>
          <p className="text-xs text-stone-400 mt-2">
            Operational portals running live examinations
          </p>
        </div>

        {/* Custom Domains & White-label */}
        <div
          onClick={() => setFeatureFilter("custom_domain")}
          className={`p-5 rounded-2xl border transition-all cursor-pointer shadow-sm ${
            featureFilter === "custom_domain"
              ? "bg-white border-violet-300 ring-2 ring-violet-500/20 shadow-md"
              : "bg-white border-stone-200/80 hover:border-stone-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Branded Domains
            </span>
            <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-heading font-bold text-stone-900 mt-2">
            {stats.withDomain}
          </p>
          <p className="text-xs text-stone-500 mt-2 font-medium">
            <span className="text-violet-600 font-semibold">{stats.whiteLabel} White-Label</span>{" "}
            portals configured
          </p>
        </div>

        {/* Estimated MRR / Tier Mix */}
        <div className="p-5 rounded-2xl border border-stone-200/80 bg-white shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Estimated Monthly ARR/MRR
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-heading font-bold text-stone-900 mt-2">
            ₹{stats.estimatedMRR > 0 ? stats.estimatedMRR.toLocaleString() : "—"}
          </p>
          <p className="text-xs text-stone-400 mt-2 truncate">
            Based on active plan tiers across institutions
          </p>
        </div>
      </div>

      {/* Search, Filter Toolbar & View Toggle */}
      <div className="space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-stone-200/80 shadow-sm">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <Input
              placeholder="Search school name, subdomain, domain, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-8 h-10 bg-stone-50/70 border-stone-200 text-sm focus:bg-white"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filter Pills & Selects */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Pills */}
            <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200/80 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  statusFilter === "all"
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                All ({stats.total})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  statusFilter === "active"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                Active ({stats.active})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("suspended")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                  statusFilter === "suspended"
                    ? "bg-white text-red-700 shadow-sm"
                    : "text-stone-500 hover:text-stone-900"
                }`}
              >
                Suspended ({stats.suspended})
              </button>
            </div>

            {/* Plan Filter */}
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="h-10 text-xs w-[145px] bg-white border-stone-200">
                <SelectValue placeholder="All Plans" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plans</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Feature Filter */}
            <Select value={featureFilter} onValueChange={setFeatureFilter}>
              <SelectTrigger className="h-10 text-xs w-[145px] bg-white border-stone-200">
                <SelectValue placeholder="All Features" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Features</SelectItem>
                <SelectItem value="custom_domain">Custom Domain</SelectItem>
                <SelectItem value="white_label">White Label</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort Dropdown */}
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-10 text-xs w-[130px] bg-white border-stone-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Recently Added</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="name-asc">Name (A-Z)</SelectItem>
                <SelectItem value="name-desc">Name (Z-A)</SelectItem>
              </SelectContent>
            </Select>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200/80 ml-auto">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === "grid"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-stone-400 hover:text-stone-700"
                }`}
                title="Grid Card View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === "table"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-stone-400 hover:text-stone-700"
                }`}
                title="Table View"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Active Filters Pill Bar */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 px-1 flex-wrap text-xs text-stone-600">
            <span className="font-semibold text-stone-400">Active Filters:</span>
            {searchTerm && (
              <span className="inline-flex items-center gap-1 bg-stone-200/80 px-2.5 py-1 rounded-lg">
                Query: "{searchTerm}"
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="hover:text-stone-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {statusFilter !== "all" && (
              <span className="inline-flex items-center gap-1 bg-stone-200/80 px-2.5 py-1 rounded-lg capitalize">
                Status: {statusFilter}
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className="hover:text-stone-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {planFilter !== "all" && (
              <span className="inline-flex items-center gap-1 bg-stone-200/80 px-2.5 py-1 rounded-lg">
                Plan: {plans.find((p) => p.id === planFilter)?.name || planFilter}
                <button
                  type="button"
                  onClick={() => setPlanFilter("all")}
                  className="hover:text-stone-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {featureFilter !== "all" && (
              <span className="inline-flex items-center gap-1 bg-stone-200/80 px-2.5 py-1 rounded-lg">
                Feature:{" "}
                {featureFilter === "custom_domain"
                  ? "Custom Domain"
                  : "White Label"}
                <button
                  type="button"
                  onClick={() => setFeatureFilter("all")}
                  className="hover:text-stone-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2 ml-1"
            >
              Reset all
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-stone-200" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-stone-200 rounded w-3/4" />
                  <div className="h-3 bg-stone-100 rounded w-1/2" />
                </div>
              </div>
              <div className="h-10 bg-stone-100 rounded-xl" />
              <div className="h-8 bg-stone-50 rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorCard onRetry={() => loadData()} />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-stone-900 font-heading">
              {hasActiveFilters
                ? "No institutions match the active filters"
                : "No institutions onboarded yet"}
            </h3>
            <p className="text-sm text-stone-500 max-w-md mx-auto mt-1">
              {hasActiveFilters
                ? "Try clearing the search query or adjusting your filters to see more results."
                : "Get started by onboarding your first school tenant to issue branded portals and configure curricula."}
            </p>
          </div>
          {hasActiveFilters ? (
            <Button variant="outline" onClick={clearAllFilters} className="text-xs">
              Clear All Filters
            </Button>
          ) : isPlatformOwner ? (
            <Button
              onClick={() => {
                setEditingTenant(null);
                setFormDialogOpen(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
            >
              <Plus className="w-4 h-4 mr-2" /> Onboard First Institution
            </Button>
          ) : null}
        </div>
      ) : viewMode === "grid" ? (
        /* Grid Card View */
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {paginated.map((tenant) => (
              <InstitutionCard
                key={tenant.id}
                tenant={tenant}
                plan={planMap.get(tenant.subscription_plan_id)}
                isPlatformOwner={isPlatformOwner}
                onViewDetails={(t) => {
                  setSelectedTenant(t);
                  setDetailDrawerOpen(true);
                }}
                onEdit={(t) => {
                  setEditingTenant(t);
                  setFormDialogOpen(true);
                }}
                onToggleStatus={handlePromptToggleStatus}
                onCreateAdmin={(t) => {
                  setAdminTargetTenant(t);
                  setAdminDialogOpen(true);
                }}
                onActivateDomain={activateCustomDomain}
                activatingId={activatingId}
                onImpersonate={handleImpersonate}
              />
            ))}
          </div>

          <ListPagination
            page={page}
            totalItems={filtered.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      ) : (
        /* Table View */
        <div className="bg-white rounded-2xl border border-stone-200/90 overflow-hidden shadow-sm space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50/80 text-stone-600 text-xs font-semibold uppercase tracking-wider border-b border-stone-200 select-none">
                <tr>
                  <th className="px-5 py-3.5 text-left">Institution</th>
                  <th className="px-4 py-3.5 text-left">Plan & Tier</th>
                  <th className="px-4 py-3.5 text-left">Custom Domain</th>
                  <th className="px-4 py-3.5 text-left">Contact Info</th>
                  <th className="px-4 py-3.5 text-left">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginated.map((tenant) => {
                  const plan = planMap.get(tenant.subscription_plan_id);
                  const brandColor = tenant.primary_color || "#4F46E5";
                  const isActive = tenant.status === "active";
                  const isCopied = copiedId === tenant.id;

                  return (
                    <tr
                      key={tenant.id}
                      onClick={() => {
                        setSelectedTenant(tenant);
                        setDetailDrawerOpen(true);
                      }}
                      className="hover:bg-stone-50/70 transition-colors cursor-pointer"
                    >
                      {/* Institution Column */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm overflow-hidden"
                            style={{ backgroundColor: brandColor }}
                          >
                            {tenant.logo_url ? (
                              <img
                                src={tenant.logo_url}
                                alt={tenant.name}
                                className="w-full h-full object-contain p-0.5"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              (tenant.name || "School")
                                .split(" ")
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-stone-900 truncate">
                              {tenant.name}
                            </p>
                            <div className="flex items-center gap-1.5 text-xs text-stone-400 mt-0.5">
                              <button
                                type="button"
                                onClick={(e) => handleCopySubdomain(tenant, e)}
                                className="font-mono text-stone-500 hover:text-indigo-600 inline-flex items-center gap-1 text-[11px] bg-stone-100 px-1 rounded"
                                title="Click to copy portal URL"
                              >
                                {tenant.subdomain || "no-slug"}
                                {isCopied ? (
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-2.5 h-2.5 text-stone-400" />
                                )}
                              </button>
                              {tenant.board_type && (
                                <span className="text-[10px] text-stone-500 bg-stone-50 border border-stone-200 px-1 rounded">
                                  {tenant.board_type}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Plan Column */}
                      <td className="px-4 py-3.5">
                        <div className="space-y-1">
                          <p className="font-medium text-stone-800 text-xs">
                            {plan?.name || tenant.plan_name || "Standard Plan"}
                          </p>
                          {tenant.white_label_enabled ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-medium">
                              <Sparkles className="w-2.5 h-2.5 mr-1 text-emerald-600" /> White Label
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-stone-400">Standard</span>
                          )}
                        </div>
                      </td>

                      {/* Custom Domain Column */}
                      <td className="px-4 py-3.5">
                        {tenant.custom_domain ? (
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs text-stone-700 font-medium">
                              {tenant.custom_domain}
                            </span>
                            <CustomDomainStatus
                              status={tenant.custom_domain_status}
                              verified={tenant.custom_domain_verified}
                              className="w-fit"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">—</span>
                        )}
                      </td>

                      {/* Contact Column */}
                      <td className="px-4 py-3.5 text-xs text-stone-600">
                        {tenant.contact_email ? (
                          <div className="truncate max-w-[180px]">
                            {tenant.contact_email}
                          </div>
                        ) : (
                          <span className="text-stone-400">No email</span>
                        )}
                        {tenant.contact_phone && (
                          <div className="text-stone-400 text-[11px]">
                            {tenant.contact_phone}
                          </div>
                        )}
                      </td>

                      {/* Status Column */}
                      <td className="px-4 py-3.5">
                        <StatusBadge status={tenant.status} type="tenant" />
                      </td>

                      {/* Actions Column */}
                      <td
                        className="px-5 py-3.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-semibold"
                            onClick={() => handleImpersonate(tenant, "school_admin")}
                            title="Launch School Admin Dashboard"
                          >
                            <LogIn className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
                            Portal
                          </Button>

                          {isPlatformOwner && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs font-medium"
                              onClick={() => {
                                setAdminTargetTenant(tenant);
                                setAdminDialogOpen(true);
                              }}
                              title="Create School Admin"
                            >
                              <UserPlus className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Admin
                            </Button>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-stone-400 hover:text-stone-700"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 text-xs">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedTenant(tenant);
                                  setDetailDrawerOpen(true);
                                }}
                              >
                                <Eye className="w-3.5 h-3.5 mr-2 text-stone-500" /> View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleImpersonate(tenant, "school_admin")}
                              >
                                <LogIn className="w-3.5 h-3.5 mr-2 text-indigo-600" /> Impersonate Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleImpersonate(tenant, "teacher")}
                              >
                                <Users className="w-3.5 h-3.5 mr-2 text-violet-600" /> Impersonate Teacher
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleImpersonate(tenant, "student")}
                              >
                                <GraduationCap className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Impersonate Student
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  window.location.href = `/s/${tenant.subdomain || ""}`;
                                }}
                              >
                                <ExternalLink className="w-3.5 h-3.5 mr-2 text-stone-500" /> Open School Login
                              </DropdownMenuItem>
                              {isPlatformOwner && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditingTenant(tenant);
                                      setFormDialogOpen(true);
                                    }}
                                  >
                                    <Pencil className="w-3.5 h-3.5 mr-2 text-stone-600" /> Edit Institution
                                  </DropdownMenuItem>
                                  {tenant.custom_domain &&
                                    tenant.custom_domain_status === "verified" && (
                                      <DropdownMenuItem
                                        onClick={() => activateCustomDomain(tenant)}
                                      >
                                        <Globe className="w-3.5 h-3.5 mr-2 text-emerald-600" /> Activate Domain
                                      </DropdownMenuItem>
                                    )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handlePromptToggleStatus(tenant)}
                                    className={isActive ? "text-red-600" : "text-emerald-600"}
                                  >
                                    {isActive ? (
                                      <>
                                        <Ban className="w-3.5 h-3.5 mr-2" /> Suspend Institution
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Reactivate Institution
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-stone-100">
            <ListPagination
              page={page}
              totalItems={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}

      {/* Slide-over Institution Detail Drawer */}
      <InstitutionDetailDrawer
        open={detailDrawerOpen}
        onOpenChange={setDetailDrawerOpen}
        tenant={selectedTenant}
        plan={selectedTenant ? planMap.get(selectedTenant.subscription_plan_id) : null}
        isPlatformOwner={isPlatformOwner}
        onEdit={(t) => {
          setEditingTenant(t);
          setFormDialogOpen(true);
        }}
        onToggleStatus={handlePromptToggleStatus}
        onCreateAdmin={(t) => {
          setAdminTargetTenant(t);
          setAdminDialogOpen(true);
        }}
        onActivateDomain={activateCustomDomain}
        activatingId={activatingId}
        onImpersonate={handleImpersonate}
      />

      {/* Onboard / Edit Institution Dialog */}
      <TenantFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        tenant={editingTenant}
        plans={plans}
        onSave={handleSaveTenant}
      />

      {/* Create School Admin Modal */}
      <CreateAdminDialog
        open={adminDialogOpen}
        onOpenChange={setAdminDialogOpen}
        tenant={adminTargetTenant}
        onSuccess={() => {}}
      />

      {/* Confirm Suspend / Reactivate Dialog */}
      <ConfirmStatusDialog
        open={confirmStatusOpen}
        onOpenChange={setConfirmStatusOpen}
        tenant={statusTargetTenant}
        onConfirm={handleConfirmStatus}
        submitting={statusSubmitting}
      />
    </div>
  );
}
