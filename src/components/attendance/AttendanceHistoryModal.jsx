import React, { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  Calendar as CalendarIcon,
  CalendarDays, TrendingUp, Users, ChevronRight, RefreshCw
} from "lucide-react";
import moment from "moment";

export default function AttendanceHistoryModal({
  open,
  onOpenChange,
  academicYear,
  selectedClass,
  selectedSection,
  onSelectDate,
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("all");

  const loadHistory = async () => {
    if (!academicYear?.id || !selectedClass?.id) return;
    try {
      setLoading(true);
      const payload = {
        academic_year_id: academicYear.id,
        school_class_id: selectedClass.id,
        section_id: selectedSection?.id || (selectedSection === "all" ? null : selectedSection),
        ...(selectedMonth !== "all" ? { month: selectedMonth } : {}),
      };

      const res = await appClient.functions.invoke("getAttendanceHistory", payload);
      setHistoryData(res.data || null);
    } catch (err) {
      console.error("Failed to load attendance history:", err);
      toast({
        title: "Failed to load history",
        description: err.message || "Could not retrieve historical attendance records.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open, academicYear?.id, selectedClass?.id, selectedSection, selectedMonth]);

  // Generate list of months spanning academic year
  const availableMonths = React.useMemo(() => {
    if (!academicYear?.start_date || !academicYear?.end_date) return [];
    const months = [];
    let curr = moment(academicYear.start_date).startOf("month");
    const end = moment(academicYear.end_date).startOf("month");
    while (curr.isSameOrBefore(end)) {
      months.push({
        value: curr.format("YYYY-MM"),
        label: curr.format("MMMM YYYY"),
      });
      curr.add(1, "month");
    }
    return months;
  }, [academicYear?.start_date, academicYear?.end_date]);

  const handleDayClick = (dateStr) => {
    if (onSelectDate) {
      onSelectDate(dateStr);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader className="pb-3 border-b border-stone-100">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-bold text-stone-900 flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-indigo-600" />
                Session Attendance History
              </DialogTitle>
              <DialogDescription className="text-xs text-stone-500 mt-0.5">
                Browse recorded attendance days, completion statuses, and rates for{" "}
                <span className="font-semibold text-stone-700">{selectedClass?.name || "Class"}</span>
                {selectedSection && selectedSection !== "all" && (
                  <span> &bull; Section {selectedSection.name || selectedSection}</span>
                )}{" "}
                &bull; Academic Year: <span className="font-semibold text-indigo-600">{academicYear?.name}</span>
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadHistory}
              disabled={loading}
              className="h-8 px-2 text-stone-500 hover:text-stone-900"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </DialogHeader>

        {/* Filter & Metric Banner */}
        <div className="py-3 flex flex-wrap items-center justify-between gap-3 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Filter Month:</span>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Session Months</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {historyData && (
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-stone-600">
                <CalendarIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span>Marked Days: <strong className="text-stone-900">{historyData.marked_days_count}</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-stone-600">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                <span>Avg Attendance: <strong className="text-emerald-700 font-bold">{historyData.overall_average_rate}%</strong></span>
              </div>
              <div className="flex items-center gap-1.5 text-stone-600">
                <Users className="w-3.5 h-3.5 text-stone-400" />
                <span>Enrolled: <strong className="text-stone-900">{historyData.total_enrolled}</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Calendar / Day History List */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2">
          {loading ? (
            <div className="py-16 text-center text-stone-400">
              <div className="w-8 h-8 border-3 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading session attendance records...</p>
            </div>
          ) : !historyData || historyData.history.length === 0 ? (
            <div className="py-16 text-center text-stone-400 space-y-2">
              <CalendarIcon className="w-10 h-10 text-stone-300 mx-auto stroke-1" />
              <p className="text-sm font-medium text-stone-600">No attendance marked yet</p>
              <p className="text-xs text-stone-400 max-w-sm mx-auto">
                No attendance records exist for this class/section in the selected session or month.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {historyData.history.map((day) => {
                const dateMoment = moment(day.date);
                const isPartiallyMarked = day.status === "partially_marked";

                return (
                  <div
                    key={day.date}
                    onClick={() => handleDayClick(day.date)}
                    className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                      isPartiallyMarked
                        ? "border-amber-200 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-300"
                        : day.rate_pct >= 90
                        ? "border-stone-200/80 bg-white hover:bg-stone-50/80 hover:border-emerald-300 hover:shadow-sm"
                        : day.rate_pct >= 75
                        ? "border-stone-200/80 bg-white hover:bg-stone-50/80 hover:border-amber-300 hover:shadow-sm"
                        : "border-stone-200/80 bg-white hover:bg-stone-50/80 hover:border-rose-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 text-center">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                          {dateMoment.format("ddd")}
                        </div>
                        <div className="text-base font-bold text-stone-800 leading-none mt-0.5">
                          {dateMoment.format("D")}
                        </div>
                        <div className="text-[9px] text-stone-400 uppercase">
                          {dateMoment.format("MMM")}
                        </div>
                      </div>

                      <div className="h-8 w-px bg-stone-200/70" />

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-stone-900">
                            {dateMoment.format("dddd, MMMM D, YYYY")}
                          </span>
                          {isPartiallyMarked ? (
                            <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[11px] px-1.5 py-0 font-medium">
                              Partially Marked ({day.marked_count}/{day.total_enrolled})
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] px-1.5 py-0 font-medium">
                              Marked ({day.marked_count}/{day.total_enrolled})
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-stone-500 mt-1">
                          <span className="text-emerald-700 font-medium">
                            {day.present_count} Present
                          </span>
                          &bull;
                          <span className="text-rose-700 font-medium">
                            {day.absent_count} Absent
                          </span>
                          {day.late_count > 0 && (
                            <>
                              &bull;
                              <span className="text-amber-700 font-medium">
                                {day.late_count} Late
                              </span>
                            </>
                          )}
                          {day.excused_count > 0 && (
                            <>
                              &bull;
                              <span className="text-stone-600 font-medium">
                                {day.excused_count} Excused
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold ${
                            day.rate_pct >= 90
                              ? "text-emerald-600"
                              : day.rate_pct >= 75
                              ? "text-amber-600"
                              : "text-rose-600"
                          }`}
                        >
                          {day.rate_pct}%
                        </div>
                        <div className="text-[11px] text-stone-400 uppercase tracking-wider">Attendance</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-stone-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
          <span>Click any date to inspect or modify the class roster for that day.</span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
