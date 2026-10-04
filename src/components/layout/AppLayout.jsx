import React, { useEffect, useState } from "react";
import { Link, useLocation, Navigate, useOutlet } from "react-router-dom";
import useCurrentUser from "@/hooks/useCurrentUser";
import usePlatformBranding from "@/hooks/usePlatformBranding";
import { appClient } from "@/api/appClient";
import ImpersonationBanner from "@/components/shared/ImpersonationBanner";
import { APP_ROLES, getAppRole, getAppRoles, isPlatformRole, roleLabels } from "@/lib/roles";
import { NAV, STANDALONE_PATHS } from "@/lib/nav";
import { stopImpersonation } from "@/lib/impersonation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isDarkColor } from "@/lib/color";
import { AnimatePresence, motion } from "framer-motion";
import BottomTabBar from "@/components/layout/BottomTabBar";
import MobileHeader from "@/components/layout/MobileHeader";
import DeleteAccountDialog from "@/components/shared/DeleteAccountDialog";
import CommandPalette from "@/components/shared/CommandPalette";
import {
  LayoutDashboard, Building2, CreditCard, Users, GraduationCap, BookOpenCheck,
  ShieldCheck, Palette, LogOut, UserCog, Inbox, TrendingUp, Trash2, BookOpen, BarChart3, Wallet,
  CalendarCheck, Clock, FileText, Layers, Search, KeyRound, Megaphone, Home, Handshake,
  ArrowRightLeft
} from "lucide-react";

// NAV lives in src/lib/nav.js as pure data with string icon keys, so the role-to-
// destination mapping can be asserted by `node --test` without a bundler. This is the
// only place those keys become components.
//
// The resolution happens into a local object rather than by rewriting the imported
// NAV in place: nav.js is shared with the command palette and the parity test, and
// mutating an import would hand every later consumer the components instead of the
// keys.
const ICONS = {
  LayoutDashboard, Building2, CreditCard, Users, GraduationCap, BookOpenCheck,
  ShieldCheck, Palette, UserCog, Inbox, TrendingUp, BookOpen, BarChart3, Wallet,
  CalendarCheck, Clock, FileText, Layers, Megaphone, Home, Handshake, ArrowRightLeft,
};

const NAV_ITEMS = Object.fromEntries(
  Object.entries(NAV).map(([role, items]) => [
    role,
    items.map((item) => ({ ...item, icon: ICONS[item.icon] || FileText })),
  ])
);

export default function AppLayout() {
  const { user } = useCurrentUser();
  const location = useLocation();
  const [tenant, setTenant] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const platformBrand = usePlatformBranding();
  const outlet = useOutlet({ user, tenant });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const loadTenant = async () => {
      if (user?.tenant_id) {
        try {
          const res = await appClient.functions.invoke("getMyTenant", { tenant_id: user.tenant_id });
          setTenant(res.data?.tenant || null);
        } catch {
          setTenant(null);
        }
      }
    };
    loadTenant();
  }, [user?.tenant_id]);

  const role = getAppRole(user);
  const roles = getAppRoles(user);

  // Students and parents use their dedicated portals, not the admin layout.
  // A small set of shared screens must stay reachable for them: the forced
  // password change, and the announcements page they are allowed to read.
  //
  // Keyed on the PRIMARY role, not on holding a family role. Role families are
  // mutually exclusive on the server, so a staff account can never hold student
  // or parent — but an account that is primarily a student and also a parent must
  // reach the student portal, and the wider-of-the-two rule that decides
  // permissions would otherwise send it to the parent's.
  const isSharedScreen = STANDALONE_PATHS.some((p) => location.pathname.startsWith(p));
  if (role === APP_ROLES.STUDENT && !isSharedScreen) return <Navigate to="/student-portal" replace />;
  if (role === APP_ROLES.PARENT && !isSharedScreen) return <Navigate to="/parent-portal" replace />;

  // The nav is the UNION of every held role's items, de-duplicated by route and
  // ordered by precedence. A teacher who is also an exam coordinator gets both
  // jobs' destinations — the exam console AND their own portal — which is the
  // point of holding two roles. Precedence decides the order, so the wider role's
  // items come first.
  //
  // A role with no entry (unknown, or missing) contributes nothing, and an account
  // with no roles gets none at all. Falling back to the school-admin menu would
  // hand the full admin sidebar to a read-only role.
  const seenRoutes = new Set();
  const items = roles.flatMap((held) => NAV_ITEMS[held] || []).filter((item) => {
    if (seenRoutes.has(item.to)) return false;
    seenRoutes.add(item.to);
    return true;
  });
  const isTenantUser = !isPlatformRole(user);
  const brandName = isTenantUser && tenant?.name ? tenant.name : (platformBrand?.platform_name || "Avexora ExamOS");
  const brandColor = isTenantUser ? tenant?.primary_color : null;
  const mobileLogoUrl = isTenantUser
    ? tenant?.logo_url || null
    : platformBrand?.header_logo_url || null;

  const customSidebarBg = isTenantUser
    ? tenant?.sidebar_use_secondary_color
      ? tenant?.secondary_color || null
      : null
    : platformBrand?.sidebar_use_color
      ? platformBrand?.sidebar_color || null
      : null;
  const customSidebar = Boolean(customSidebarBg);
  const darkSidebar = customSidebar && isDarkColor(customSidebarBg);

  const sb = customSidebar
    ? darkSidebar
      ? {
          border: "border-white/10",
          brandText: "text-white",
          chip: "bg-white/10 border-white/20",
          chipLetter: "text-white",
          command: "text-stone-200 bg-white/10 hover:bg-white/20 hover:text-white border-white/15",
          commandIcon: "text-stone-200 group-hover:text-white",
          commandKbd: "bg-white/15 text-stone-200 border-white/25",
          navBase: "text-stone-200 hover:bg-white/10 hover:text-white",
          navActive: "bg-white/20 text-white",
          navIcon: "text-stone-200 group-hover:text-white",
          navIconActive: "text-white",
          initials: "bg-white/15 text-white",
          name: "text-white",
          email: "text-stone-300",
          actionBtn: "text-stone-200 hover:bg-white/10 hover:text-white",
          deleteBtn: "text-stone-300 hover:bg-rose-500/20 hover:text-rose-200",
          footerText: "text-stone-300",
        }
      : {
          border: "border-black/10",
          brandText: "text-stone-900",
          chip: "bg-black/5 border-black/10",
          chipLetter: "text-stone-900",
          command: "text-stone-600 bg-black/5 hover:bg-black/10 hover:text-stone-900 border-black/15",
          commandIcon: "text-stone-500 group-hover:text-stone-900",
          commandKbd: "bg-white/60 text-stone-600 border-black/15",
          navBase: "text-stone-700 hover:bg-black/10 hover:text-stone-900",
          navActive: "bg-black/10 text-stone-900",
          navIcon: "text-stone-500 group-hover:text-stone-900",
          navIconActive: "text-stone-900",
          initials: "bg-black/10 text-stone-900",
          name: "text-stone-900",
          email: "text-stone-500",
          actionBtn: "text-stone-600 hover:bg-black/10 hover:text-stone-900",
          deleteBtn: "text-stone-500 hover:bg-rose-100 hover:text-rose-600",
          footerText: "text-stone-500",
        }
    : {};

  const handleLogout = () => {
    stopImpersonation();
    appClient.auth.logout("/login");
  };

  const initials = (user?.full_name || user?.email || "?")
    .split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  const isActive = (to) => location.pathname === to || (to !== "/" && location.pathname.startsWith(to + "/"));

  return (
    <div className="min-h-screen flex bg-stone-50">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex w-64 bg-white ${sb.border || "border-r border-stone-200"} text-stone-900 flex-col shrink-0 relative`}
        style={{ backgroundColor: customSidebarBg || undefined }}
      >
        {brandColor && <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: brandColor }} />}
        <div className={`h-16 flex items-center gap-3 px-5 border-b ${sb.border || "border-stone-200"}`}>
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 overflow-hidden ${sb.chip || "bg-indigo-50 border-indigo-100"}`}>
            {isTenantUser && tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="" className="w-9 h-9 object-cover" />
            ) : !isTenantUser && platformBrand?.header_logo_url ? (
              <img src={platformBrand.header_logo_url} alt="" className="h-7 object-contain" />
            ) : (
              <span className={`font-bold ${sb.chipLetter || "text-indigo-700"}`}>A</span>
            )}
          </div>
          <span className={`font-semibold tracking-tight truncate text-sm ${sb.brandText || "text-stone-900"}`}>{brandName}</span>
        </div>

        {/* Omnisearch Command Palette Shortcut */}
        <div className="px-4 pt-4 pb-1">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium border rounded-lg transition-colors group ${sb.command || "text-stone-500 bg-stone-100 hover:bg-stone-200 hover:text-stone-800 border-stone-200"}`}
          >
            <div className="flex items-center gap-2">
              <Search className={`w-3.5 h-3.5 transition-colors ${sb.commandIcon || "text-stone-400 group-hover:text-indigo-600"}`} />
              <span>Quick search...</span>
            </div>
            <kbd className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${sb.commandKbd || "bg-white text-stone-500 border-stone-200"}`}>⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 py-2 px-3 space-y-0.5 overflow-y-auto mt-1">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? sb.navActive || "bg-[#EEF2FF] text-indigo-700 font-semibold"
                    : sb.navBase || "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? sb.navIconActive || "text-indigo-600" : sb.navIcon || "text-stone-400 group-hover:text-stone-600"}`} /> {item.label}
              </Link>
            );
          })}
        </nav>

        {isTenantUser && tenant?.powered_by_avexora !== false && (
          <div className={`p-3 border-t ${sb.border || "border-stone-200"}`}>
            <p className={`px-2 text-[11px] ${sb.footerText || "text-stone-400"}`}>Powered by Avexora ExamOS</p>
          </div>
        )}
      </aside>

      {/* Mobile header */}
      <MobileHeader
        brandName={brandName}
        logoUrl={mobileLogoUrl}
        onLogout={handleLogout}
        onDeleteAccount={() => setDeleteOpen(true)}
        items={items}
        sidebarBg={customSidebarBg}
        darkSidebar={darkSidebar}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Desktop top bar */}
        <header className="hidden md:flex h-16 items-center justify-end px-6 shrink-0 bg-white border-b border-stone-200 sticky top-0 z-30">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-3 rounded-lg p-1.5 -mr-1.5 hover:bg-stone-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Account menu"
              >
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden lg:block text-left">
                  <span className="block text-sm font-medium leading-tight text-stone-900">{user?.full_name || user?.email}</span>
                  <span className="block text-xs leading-tight text-stone-500">{roleLabels(user).join(", ") || role}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal px-2 pt-2.5">
                <div className="text-sm font-semibold text-stone-900">{user?.full_name || user?.email}</div>
                <div className="text-xs text-stone-500 font-normal mt-0.5">{user?.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/change-password">
                  <KeyRound className="w-4 h-4 mr-2" /> Change Password
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" /> Log Out
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
                <Trash2 className="w-4 h-4 mr-2" /> Delete Account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden pt-14 pb-16 md:pt-0 md:pb-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <BottomTabBar items={items} />

      <ImpersonationBanner />
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} user={user} />
    </div>
  );
}