import React from "react";
import StatCard from "@/components/shared/StatCard";
import { Building2, Inbox, IndianRupee } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const ChartCard = ({ title, children }) => (
  <div className="bg-white rounded-xl border border-stone-200 p-6">
    <h3 className="font-semibold text-stone-800 mb-4">{title}</h3>
    <div className="h-64">{children}</div>
  </div>
);

export default function InsightsCharts({ data }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Active Schools" value={data?.totals?.activeSchools ?? 0} icon={Building2} />
        <StatCard label="Pending Demo Requests" value={data?.totals?.pendingDemos ?? 0} icon={Inbox} />
        <StatCard label="Total Revenue" value={`₹${(data?.totals?.totalRevenue ?? 0).toLocaleString("en-IN")}`} icon={IndianRupee} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Active Schools Growth">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.activeSchools}>
              <defs>
                <linearGradient id="schoolsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Area type="monotone" dataKey="schools" name="Active Schools" stroke="#8B5CF6" strokeWidth={2} fill="url(#schoolsFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Demo Requests per Month">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.demosByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="requests" name="Demo Requests" fill="#4F46E5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Monthly Subscription Revenue (₹)">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.revenue}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${v.toLocaleString("en-IN")}`} width={80} />
            <Tooltip formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, "Revenue"]} />
            <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2.5} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}