import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpenCheck, Search, ArrowRight, Calendar } from "lucide-react";
import { StatusBadge } from "@/lib/statusTokens";
import moment from "moment";

export default function TeacherExamsList({ exams, onNewExam: _onNewExam }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = exams.filter((e) => {
    const matchesSearch =
      e.name?.toLowerCase().includes(search.toLowerCase()) ||
      e.subject?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <BookOpenCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-heading font-bold text-stone-900 text-base">My Examinations</h3>
            <p className="text-xs text-stone-500">{exams.length} examinations created for your classes</p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs font-semibold">
          {filtered.length} shown
        </Badge>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
          <Input
            placeholder="Search exams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs bg-stone-50 border-stone-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 text-xs bg-stone-50 border border-stone-200 rounded-md px-2 text-stone-700"
        >
          <option value="all">All Statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="omr_in_progress">OMR In Progress</option>
          <option value="evaluated">Evaluated</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* Exam Items */}
      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
        {filtered.map((e) => {
          const classStr = (e.class_names || [e.class_name]).filter(Boolean).join(", ");
          return (
            <Link
              key={e.id}
              to={`/examinations/${e.id}`}
              className="flex items-center justify-between p-3 rounded-xl border border-stone-100 hover:border-stone-200 hover:bg-stone-50/75 transition group"
            >
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs font-bold text-stone-900 truncate group-hover:text-indigo-600 transition">
                    {e.name}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                  <span className="font-semibold text-stone-600">{e.subject}</span>
                  <span>·</span>
                  <span>{classStr || "General"}</span>
                  {e.exam_date && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {moment(e.exam_date).format("DD MMM YYYY")}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>{e.max_marks || 100} Marks</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={e.status} type="exam" />
                <ArrowRight className="w-4 h-4 text-stone-300 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-stone-400 text-xs">
            No examinations matched your filters.
          </div>
        )}
      </div>
    </div>
  );
}