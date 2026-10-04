import React, { useEffect, useState, useCallback } from "react";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import InsightsCharts from "@/components/insights/InsightsCharts";
import { DashboardSkeleton, ErrorCard } from "@/components/shared/Skeletons";
import { format, subMonths, startOfMonth } from "date-fns";

const monthKey = (d) => format(startOfMonth(new Date(d)), "MMM yyyy");

export default function PlatformInsights() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenants, leads, payments] = await Promise.all([
        appClient.entities.Tenant.list("-created_date", 500),
        appClient.entities.Lead.list("-created_date", 500),
        appClient.entities.Payment.list("-created_date", 500),
      ]);

      // Last 6 months buckets
      const months = Array.from({ length: 6 }, (_, i) =>
        format(startOfMonth(subMonths(new Date(), 5 - i)), "MMM yyyy")
      );

      // cumulative active schools: count tenants created on or before each month
      let running = tenants.filter((t) => t.status === "active" && !months.includes(monthKey(t.created_date))).length;
      const activeSchools = months.map((m) => {
        running += tenants.filter((t) => t.status === "active" && monthKey(t.created_date) === m).length;
        return { month: m, schools: running };
      });

      const revenue = months.map((m) => ({
        month: m,
        revenue: payments
          .filter((p) => p.status === "paid" && monthKey(p.created_date) === m)
          .reduce((sum, p) => sum + (p.amount || 0), 0),
      }));

      const pendingDemos = leads.filter((l) => l.type === "demo" && l.status === "new");
      const demosByMonth = months.map((m) => ({
        month: m,
        requests: leads.filter((l) => l.type === "demo" && monthKey(l.created_date) === m).length,
      }));

      setData({
        activeSchools,
        revenue,
        demosByMonth,
        totals: {
          activeSchools: tenants.filter((t) => t.status === "active").length,
          pendingDemos: pendingDemos.length,
          totalRevenue: payments.filter((p) => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0),
        },
      });
    } catch (err) {
      console.error("Failed to load platform insights:", err);
      setError("Failed to load platform growth insights. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Platform Insights"
        description="Active schools, demo pipeline and subscription revenue growth"
      />
      {error ? (
        <ErrorCard message={error} onRetry={load} />
      ) : data ? (
        <InsightsCharts data={data} />
      ) : null}
    </div>
  );
}