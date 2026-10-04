import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import StatCard from "@/components/shared/StatCard";
import TenantFormDialog from "@/components/tenants/TenantFormDialog";
import AnnouncementsManager from "@/components/announcements/AnnouncementsManager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { startImpersonation } from "@/lib/impersonation";
import { portalUrl } from "@/lib/utils";
import QuickNav from "@/components/shared/QuickNav";
import { DashboardSkeleton, ErrorCard } from "@/components/shared/Skeletons";
import { StatusBadge } from "@/lib/statusTokens";
import CustomDomainStatus from "@/components/branding/CustomDomainStatus";
import {
  Building2, CreditCard, GraduationCap, ScanLine, Inbox, Plus,
  Search, LogIn, LayoutDashboard, Users, ShieldCheck, Palette, TrendingUp, Sparkles, BookOpen, Globe, Rocket, RefreshCw, BellRing
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const [stats, setStats] = useState({
    tenants: 0,
    activeTenants: 0,
    students: 0,
    sheets: 0,
    leads: 0,
    revenue: 0,
  });
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [leads, setLeads] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activatingId, setActivatingId] = useState(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [testingAlert, setTestingAlert] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantsList, studentsList, sheetsList, plansList, leadsList, paymentsList] = await Promise.all([
        appClient.entities.Tenant.list("-created_date").catch(() => []),
        appClient.entities.Student.list().catch(() => []),
        appClient.entities.OMRSheet.list().catch(() => []),
        appClient.entities.SubscriptionPlan.list().catch(() => []),
        appClient.entities.Lead.list("-created_date").catch(() => []),
        appClient.entities.Payment.list("-created_date").catch(() => []),
      ]);

      const activeTenantsCount = tenantsList.filter((t) => t.status === "active").length;
      const totalRev = paymentsList
        .filter((p) => p.status === "paid")
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      // Estimated MRR calculation based on active plans
      const estimatedMrr = tenantsList.reduce((acc, t) => {
        const p = plansList.find((plan) => plan.id === t.subscription_plan_id);
        return acc + (p?.price || 0);
      }, 0);

      setStats({
        tenants: tenantsList.length,
        activeTenants: activeTenantsCount,
        students: studentsList.length,
        sheets: sheetsList.length,
        leads: leadsList.filter((l) => l.status === "new").length,
        revenue: totalRev > 0 ? totalRev : estimatedMrr,
      });

      setTenants(tenantsList);
      setPlans(plansList);
      setLeads(leadsList.slice(0, 5));
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load dashboard", description: "Please try again.", variant: "destructive" });
      console.error("SuperAdminDashboard load error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorCard onRetry={loadData} />;

  const handleSaveTenant = async (data) => {
    try {
      if (editingTenant) {
        await appClient.entities.Tenant.update(editingTenant.id, data);
        toast({ title: "Institution updated successfully" });
      } else {
        await appClient.entities.Tenant.create(data);
        toast({ title: "Institution onboarded successfully" });
      }
      setDialogOpen(false);
      setEditingTenant(null);
      loadData();
    } catch (err) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    }
  };

  const loginAs = async (tenant, portal) => {
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
            title: "No teachers found",
            description: "This institution has no active teachers to view the portal as.",
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
          title: "No students found",
          description: "This institution has no active students to view the portal as.",
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
      window.location.href = portal === "student" ? "/student-portal" : "/parent-portal";
    } catch (err) {
      toast({ title: "Portal access failed", description: err.message, variant: "destructive" });
    }
  };

  const filteredTenants = tenants.filter(
    (t) =>
      t.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.subdomain?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      loadData();
    } catch (err) {
      toast({ title: "Failed to activate domain", description: err.message, variant: "destructive" });
    } finally {
      setActivatingId(null);
    }
  };

  const customDomains = tenants
    .filter((t) => t.custom_domain)
    .map((t) => ({ ...t, _domain_status: t.custom_domain_status || (t.custom_domain_verified ? "verified" : "pending") }))
    .sort((a, b) => {
      const order = { live: 0, verified: 1, pending: 2 };
      return (order[a._domain_status] ?? 3) - (order[b._domain_status] ?? 3) || a.name?.localeCompare(b.name || "");
    });

  const recheckDomains = async () => {
    setCheckingAll(true);
    try {
      const { data } = await appClient.functions.invoke("runDomainMonitor", {});
      toast({
        title: data?.error ? "Domain re-check had errors" : "Domain re-check complete",
        description: data?.error
          ? data.error
          : `${data?.checked ?? 0} checked · ${data?.problems ?? 0} problem(s) · ${data?.alerts ?? 0} alert(s)`,
        variant: data?.error ? "destructive" : undefined,
      });
      loadData();
    } catch (err) {
      toast({ title: "Re-check failed", description: err.message, variant: "destructive" });
    } finally {
      setCheckingAll(false);
    }
  };

  const sendTestAlert = async () => {
    setTestingAlert(true);
    try {
      const { data } = await appClient.functions.invoke("sendTestDomainAlert", {});
      toast({
        title: data?.email_configured ? "Test alert sent" : "SMTP not configured",
        description: data?.email_configured
          ? `Delivered to ${data?.delivered ?? 0}/${data?.recipients ?? 0} recipient(s)`
          : "Configure SMTP in Connection Settings and try again.",
        variant: data?.email_configured ? undefined : "destructive",
      });
    } catch (err) {
      toast({ title: "Test alert failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingAlert(false);
    }
  };

  const planDistributionData = plans.map((p) => ({
    name: p.name,
    institutions: tenants.filter((t) => t.subscription_plan_id === p.id).length,
  }));

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <PageHeader
        title="Platform Command Center"
        description="Comprehensive real-time telemetry, institution operations, and platform management."
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setEditingTenant(null);
                setDialogOpen(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
            >
              <Plus className="w-4 h-4 mr-2" /> Onboard Institution
            </Button>
            <Button variant="outline" asChild>
              <Link to="/insights">
                <TrendingUp className="w-4 h-4 mr-2" /> Insights
              </Link>
            </Button>
          </div>
        }
      />

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Institutions"
          value={stats.tenants}
          subtext={`${stats.activeTenants} Active`}
          icon={Building2}
          accent="text-indigo-600"
        />
        <StatCard
          label="Estimated MRR"
          value={`₹${stats.revenue.toLocaleString()}`}
          subtext="Subscription revenue"
          icon={CreditCard}
          accent="text-emerald-600"
        />
        <StatCard
          label="Enrolled Students"
          value={stats.students.toLocaleString()}
          subtext="Across all schools"
          icon={GraduationCap}
          accent="text-indigo-600"
        />
        <StatCard
          label="OMR Scans Processed"
          value={stats.sheets.toLocaleString()}
          subtext="Evaluated sheets"
          icon={ScanLine}
          accent="text-purple-600"
        />
        <StatCard
          label="New Inbound Leads"
          value={stats.leads}
          subtext="Pending review"
          icon={Inbox}
          accent="text-amber-600"
        />
      </div>

      {/* Quick Action Navigation Strip */}
      <QuickNav
        title="Quick Navigation"
        items={[
          { to: "/institutions", icon: Building2, color: "text-indigo-600", label: "All Institutions" },
          { to: "/plans", icon: CreditCard, color: "text-emerald-600", label: "Pricing Plans" },
          { to: "/leads", icon: Inbox, color: "text-amber-600", label: "Inbound Leads" },
          { to: "/platform-branding", icon: Palette, color: "text-purple-600", label: "Branding & Theme" },
          { to: "/employees", icon: Users, color: "text-indigo-600", label: "Team Access" },
          { to: "/audit-logs", icon: ShieldCheck, color: "text-stone-600", label: "Audit Logs" },
        ]}
      />

      {/* Main Dual-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Institutions Overview & Search */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-heading font-bold text-stone-900 text-base">Institutions Directory</h3>
                <p className="text-xs text-stone-500">Monitor tenant health and simulate school portals in one click</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <Input
                  placeholder="Search institutions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-stone-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50/75 text-stone-500 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-4 py-3">Institution</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Quick Access</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filteredTenants.slice(0, 8).map((t) => {
                    const plan = plans.find((p) => p.id === t.subscription_plan_id);
                    return (
                      <tr key={t.id} className="hover:bg-stone-50/50 transition">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-stone-900">{t.name}</p>
                          <p className="text-stone-400 font-mono text-[11px]">{portalUrl(t.subdomain)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-stone-600 font-medium">{plan?.name || t.plan_name || "Standard"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} type="tenant" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline" className="h-8 text-xs font-medium">
                                <LogIn className="w-3.5 h-3.5 mr-1.5 text-indigo-600" /> Enter Portal
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => loginAs(t, "school_admin")}>
                                <LayoutDashboard className="w-4 h-4 mr-2 text-indigo-600" /> School Admin
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => loginAs(t, "teacher")}>
                                <BookOpen className="w-4 h-4 mr-2 text-emerald-600" /> Teacher Portal
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => loginAs(t, "student")}>
                                <GraduationCap className="w-4 h-4 mr-2 text-indigo-600" /> Student Portal
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => loginAs(t, "parent")}>
                                <Users className="w-4 h-4 mr-2 text-amber-600" /> Parent Portal
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTenants.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                        No institutions found. Click "Onboard Institution" above to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {tenants.length > 8 && (
              <div className="mt-3 text-right">
                <Link to="/institutions" className="text-xs font-semibold text-indigo-600 hover:underline">
                  View all {tenants.length} institutions →
                </Link>
              </div>
            )}
          </div>

          {/* Plan Distribution Chart */}
          {planDistributionData.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
              <h3 className="font-heading font-bold text-stone-900 text-base mb-1">Subscriptions by Plan Tier</h3>
              <p className="text-xs text-stone-500 mb-4">Adoption distribution across active tiers</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={planDistributionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="institutions" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Custom Domains */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-stone-900 text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-500" /> Custom Domains
              </h3>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={recheckDomains} disabled={checkingAll}>
                  {checkingAll ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  Re-check all
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={sendTestAlert} disabled={testingAlert}>
                  {testingAlert ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5 mr-1.5" />}
                  Send test alert
                </Button>
                <Link to="/institutions" className="text-xs font-semibold text-indigo-600 hover:underline">
                  Manage in Institutions →
                </Link>
              </div>
            </div>
            {customDomains.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-6">
                No custom domains configured yet. Institutions set their domain in Branding → Custom Domain.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-stone-100">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-50/75 text-stone-500 uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="px-4 py-3">Institution</th>
                      <th className="px-4 py-3">Custom Domain</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">DNS</th>
                      <th className="px-4 py-3">TLS</th>
                      <th className="px-4 py-3">Hosting</th>
                      <th className="px-4 py-3">Last Checked</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {customDomains.map((t) => (
                      <tr key={t.id} className="hover:bg-stone-50/50 transition">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-stone-900">{t.name}</p>
                          <p className="text-stone-400 font-mono text-[11px]">{portalUrl(t.subdomain)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-stone-700">{t.custom_domain}</span>
                          {t.domain_issues?.length > 0 && (
                            <span
                              title={t.domain_issues
                                .map((i) => `${i.human}${i.detected_at ? ` (${new Date(i.detected_at).toLocaleDateString()})` : ""}`)
                                .join("\n")}
                              className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold cursor-help"
                            >
                              {t.domain_issues.length} issue{t.domain_issues.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <CustomDomainStatus status={t.custom_domain_status} verified={t.custom_domain_verified} degraded={t.domain_degraded} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 font-medium ${
                              t.dns_status === "verified" ? "text-emerald-600" : t.dns_status === "failed" ? "text-rose-600" : "text-amber-600"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                t.dns_status === "verified" ? "bg-emerald-500" : t.dns_status === "failed" ? "bg-rose-500" : "bg-amber-500"
                              }`}
                            />
                            {t.dns_status || "pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 font-medium ${
                              t.tls_status === "ready" ? "text-emerald-600" : t.tls_status === "failed" ? "text-rose-600" : "text-stone-500"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                t.tls_status === "ready" ? "bg-emerald-500" : t.tls_status === "failed" ? "bg-rose-500" : "bg-stone-400"
                              }`}
                            />
                            {t.tls_status || "pending"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {t.hosting_status ? (
                            <span
                              className={`font-mono text-[11px] ${
                                t.hosting_status === "configured" ? "text-emerald-600" : t.hosting_status === "failed" ? "text-rose-600" : "text-amber-600"
                              }`}
                            >
                              {t.hosting_status}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-stone-500">
                          {t.custom_domain_checked_at
                            ? new Date(t.custom_domain_checked_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {t._domain_status === "verified" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs font-medium"
                              onClick={() => activateCustomDomain(t)}
                              disabled={activatingId === t.id}
                            >
                              {activatingId === t.id ? (
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <Rocket className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                              )}
                              Activate
                            </Button>
                          )}
                          {t._domain_status === "pending" && (
                            <span className="text-[11px] text-stone-400">Awaiting DNS verification</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Inbound Leads & Announcements */}
        <div className="space-y-6">
          {/* Demo Leads Widget */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-stone-900 text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" /> Recent Demo Leads
              </h3>
              <Link to="/leads" className="text-xs font-semibold text-indigo-600 hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {leads.map((l) => (
                <div key={l.id} className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-xs text-stone-900">{l.name || l.email}</p>
                      <p className="text-[11px] text-stone-500">{l.school_name || l.organization || "Independent School"}</p>
                    </div>
                    <Badge variant="secondary" className="text-[11px] capitalize">
                      {l.type || "Demo"}
                    </Badge>
                  </div>
                  {l.phone && <p className="text-[11px] text-stone-400 mt-1 font-mono">{l.phone}</p>}
                </div>
              ))}
              {leads.length === 0 && (
                <p className="text-xs text-stone-400 text-center py-6">No pending leads currently.</p>
              )}
            </div>
          </div>

          {/* Announcements Manager */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
            <AnnouncementsManager />
          </div>
        </div>
      </div>

      <TenantFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenant={editingTenant}
        plans={plans}
        onSave={handleSaveTenant}
      />
    </div>
  );
}