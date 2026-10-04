import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { canSeeRoute, visibleDestinations } from "@/lib/nav";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  CalendarCheck,
  Clock,
  BookOpenCheck,
  GraduationCap,
  Users,
  BookOpen,
  Layers,
  TrendingUp,
  BarChart3,
  UserCog,
  Wallet,
  Palette,
  ShieldCheck,
  Inbox,
  PlusCircle,
  FileSpreadsheet,
  Search,
} from "lucide-react";

// Module scope, not inside the component: these are static lists, and rebuilding
// them per render would give `useMemo` a new array identity every time. Both are
// filtered per user by ROUTE_ACCESS before render — see visibleDestinations below.
const ALL_NAV_ITEMS = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, keywords: ["home", "stats", "kpi"] },
  { label: "Attendance Register", to: "/attendance", icon: CalendarCheck, keywords: ["daily", "present", "absent"] },
  { label: "Exam Date Sheet & Schedule", to: "/timetable", icon: Clock, keywords: ["datesheet", "calendar", "collision", "conflict"] },
  { label: "Examinations & OMR Processing", to: "/examinations", icon: BookOpenCheck, keywords: ["exam", "scan", "answer key", "upload"] },
  { label: "Students Directory", to: "/students", icon: GraduationCap, keywords: ["pupil", "admission", "roster"] },
  { label: "Parents & Guardians", to: "/parents", icon: Users, keywords: ["family", "emergency", "contact"] },
  { label: "Enrollments & Bulk Promotion", to: "/enrollments", icon: BookOpen, keywords: ["cohort", "promote", "academic year", "advancement"] },
  { label: "Teachers & Faculty", to: "/teachers", icon: Users, keywords: ["staff", "educators", "instructor"] },
  { label: "Academic Setup (Classes & Sections)", to: "/academic-setup", icon: Layers, keywords: ["years", "grades", "curriculum"] },
  { label: "Student Performance Analytics", to: "/performance", icon: TrendingUp, keywords: ["grades", "marks", "report card"] },
  { label: "Executive Analytics & Trends", to: "/analytics", icon: BarChart3, keywords: ["reports", "charts", "metrics"] },
  { label: "Staff & User Roles", to: "/staff", icon: UserCog, keywords: ["permissions", "users", "admin"] },
  { label: "Billing & Subscription Usage", to: "/billing", icon: Wallet, keywords: ["plan", "invoices", "payment", "credits"] },
  { label: "White Label Branding", to: "/white-label", icon: Palette, keywords: ["logo", "domain", "colors"] },
  { label: "CRM Leads & Admissions", to: "/leads", icon: Inbox, keywords: ["inquiry", "prospect", "pipeline"] },
  { label: "System Audit Logs", to: "/audit-logs", icon: ShieldCheck, keywords: ["security", "history", "activity"] },
];

const QUICK_ACTIONS = [
  { label: "Create New Examination", to: "/examinations", icon: PlusCircle },
  { label: "Enroll New Student", to: "/students", icon: PlusCircle },
  { label: "Bulk Promote Cohort", to: "/enrollments", icon: BookOpen },
  { label: "Inspect Schedule Conflicts", to: "/timetable", icon: FileSpreadsheet },
];

export default function CommandPalette({ open, onOpenChange, user }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();

  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loadingEntities, setLoadingEntities] = useState(false);

  // Which entity groups this account may search AND navigate into. Each result is a
  // link into a role-gated page, so a role that cannot reach the page must not be
  // offered the result — the same rule the destination list below follows.
  const maySearchStudents = canSeeRoute(user, "/students");
  const maySearchExams = canSeeRoute(user, "/examinations");
  const maySearchTeachers = canSeeRoute(user, "/teachers");
  const maySearchAny = maySearchStudents || maySearchExams || maySearchTeachers;

  // Search entities when open and query length >= 2
  useEffect(() => {
    if (!open || !user?.tenant_id || !maySearchAny || query.trim().length < 2) {
      setStudents([]);
      setExams([]);
      setTeachers([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingEntities(true);
      try {
        const q = query.trim().toLowerCase();
        const [studentRes, examRes, teacherRes] = await Promise.all([
          maySearchStudents
            ? appClient.entities.Student.find({
                tenant_id: user.tenant_id,
                $or: [
                  { full_name: { $regex: q, $options: "i" } },
                  { admission_number: { $regex: q, $options: "i" } },
                  { class_name: { $regex: q, $options: "i" } },
                ],
              }, { limit: 5 })
            : [],
          maySearchExams
            ? appClient.entities.Examination.find({
                tenant_id: user.tenant_id,
                $or: [
                  { name: { $regex: q, $options: "i" } },
                  { subject: { $regex: q, $options: "i" } },
                ],
              }, { limit: 5 })
            : [],
          maySearchTeachers
            ? appClient.entities.Teacher.find({
                tenant_id: user.tenant_id,
                $or: [
                  { full_name: { $regex: q, $options: "i" } },
                  { email: { $regex: q, $options: "i" } },
                ],
              }, { limit: 5 })
            : [],
        ]);

        startTransition(() => {
          setStudents(Array.isArray(studentRes) ? studentRes : studentRes?.data || []);
          setExams(Array.isArray(examRes) ? examRes : examRes?.data || []);
          setTeachers(Array.isArray(teacherRes) ? teacherRes : teacherRes?.data || []);
        });
      } catch (err) {
        console.warn("Command palette entity search failed:", err);
      } finally {
        setLoadingEntities(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [open, query, user?.tenant_id, maySearchAny, maySearchStudents, maySearchExams, maySearchTeachers]);

  const handleSelect = (callback) => {
    onOpenChange(false);
    callback();
  };

  // Filtered by the same ROUTE_ACCESS table RoleGuard reads, so this palette offers
  // exactly the destinations the account can actually reach. Unfiltered, it listed
  // every page for everyone — a teacher was offered Billing, White Label and CRM
  // Leads, and each click bounced to /home. The backend enforced the action either
  // way; the cost was a control the user was invited to press and could not use.
  const navItems = useMemo(() => visibleDestinations(user, ALL_NAV_ITEMS), [user]);

  // Quick actions navigate rather than read, so each is gated on its destination.
  const quickActions = useMemo(
    () => QUICK_ACTIONS.filter((action) => canSeeRoute(user, action.to)),
    [user]
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command, search modules, students, or exams..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found for &ldquo;{query}&rdquo;</CommandEmpty>

        {/* Quick Actions */}
        {quickActions.length > 0 && (
          <CommandGroup heading="Quick Actions">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <CommandItem
                  key={action.to + action.label}
                  onSelect={() => handleSelect(() => navigate(action.to))}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Icon className="w-4 h-4 text-stone-400" />
                  <span>{action.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* Live Entity Results */}
        {students.length > 0 && (
          <CommandGroup heading="Students">
            {students.map((st) => (
              <CommandItem
                key={st._id || st.id}
                onSelect={() =>
                  handleSelect(() =>
                    navigate(`/students?search=${encodeURIComponent(st.admission_number || st.full_name)}`)
                  )
                }
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-stone-500" />
                  <span className="font-medium">{st.full_name}</span>
                  <span className="text-xs text-stone-400">
                    {st.class_name ? `Class ${st.class_name}` : ""} {st.section ? `(${st.section})` : ""}
                  </span>
                </div>
                <span className="text-xs font-mono text-stone-400">{st.admission_number || "—"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {exams.length > 0 && (
          <CommandGroup heading="Examinations">
            {exams.map((ex) => (
              <CommandItem
                key={ex._id || ex.id}
                onSelect={() => handleSelect(() => navigate(`/examinations/${ex._id || ex.id}`))}
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BookOpenCheck className="w-4 h-4 text-indigo-600" />
                  <span className="font-medium">{ex.name}</span>
                  <span className="text-xs text-stone-400">{ex.subject || ""}</span>
                </div>
                <span className="text-xs text-stone-400">{ex.status || "draft"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {teachers.length > 0 && (
          <CommandGroup heading="Faculty & Teachers">
            {teachers.map((tc) => (
              <CommandItem
                key={tc._id || tc.id}
                onSelect={() =>
                  handleSelect(() =>
                    navigate(`/teachers?search=${encodeURIComponent(tc.full_name)}`)
                  )
                }
                className="flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span className="font-medium">{tc.full_name}</span>
                </div>
                <span className="text-xs text-stone-400">{tc.email || tc.designation || ""}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {loadingEntities && (
          <div className="py-2 text-center text-xs text-stone-400 flex items-center justify-center gap-2">
            <Search className="w-3.5 h-3.5 animate-spin" /> Searching entities...
          </div>
        )}

        <CommandSeparator />

        {/* Application Navigation */}
        <CommandGroup heading="Application Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.to}
                onSelect={() => handleSelect(() => navigate(item.to))}
                keywords={item.keywords}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Icon className="w-4 h-4 text-stone-400" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
