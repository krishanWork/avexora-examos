import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Sheet, SheetContent, SheetTrigger, SheetClose,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Menu, UserCircle, LogOut, Trash2, KeyRound } from "lucide-react";

export default function MobileHeader({ brandName, logoUrl, onLogout, onDeleteAccount, items = [], sidebarBg, darkSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSubPage = location.pathname.split("/").filter(Boolean).length > 1;
  const isActive = (to) => location.pathname === to || (to !== "/" && location.pathname.startsWith(to + "/"));

  const customSidebar = Boolean(sidebarBg);
  const dark = customSidebar && darkSidebar;
  const sb = customSidebar
    ? dark
      ? {
          border: "border-white/10",
          brandText: "text-white",
          chip: "bg-white/10 border-white/20",
          chipLetter: "text-white",
          navBase: "text-stone-200 hover:bg-white/10 hover:text-white",
          navActive: "bg-white/20 text-white",
          navIcon: "text-stone-200",
          navIconActive: "text-white",
          actionBtn: "text-stone-200 hover:bg-white/10",
          deleteBtn: "text-rose-300 hover:bg-rose-500/20",
        }
      : {
          border: "border-black/10",
          brandText: "text-stone-900",
          chip: "bg-black/5 border-black/10",
          chipLetter: "text-stone-900",
          navBase: "text-stone-700 hover:bg-black/10 hover:text-stone-900",
          navActive: "bg-black/10 text-stone-900",
          navIcon: "text-stone-500",
          navIconActive: "text-stone-900",
          actionBtn: "text-stone-600 hover:bg-black/10",
          deleteBtn: "text-rose-600 hover:bg-rose-100",
        }
    : {};

  return (
    <header
      className="md:hidden fixed top-0 inset-x-0 z-40 bg-white border-b border-stone-200 text-stone-900"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="h-14 flex items-center justify-between px-3">
        <div className="flex items-center gap-1 min-w-0">
          <Sheet>
            <SheetTrigger asChild>
              <button className="p-2 -ml-1 text-stone-500 hover:text-stone-900" aria-label="Open navigation menu">
                <Menu className="w-6 h-6" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className={`p-0 w-[320px] sm:max-w-[320px] bg-white text-stone-900`} style={{ backgroundColor: sidebarBg || undefined }}>
              <div className={`h-16 flex items-center gap-3 px-5 border-b ${sb.border || "border-stone-200"}`}>
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 overflow-hidden ${sb.chip || "bg-indigo-50 border-indigo-100"}`}>
                  {logoUrl ? (
                    <img src={logoUrl} alt="" className="w-9 h-9 object-contain" />
                  ) : (
                    <span className={`font-bold ${sb.chipLetter || "text-indigo-700"}`}>A</span>
                  )}
                </div>
                <span className={`font-semibold tracking-tight truncate text-sm ${sb.brandText || "text-stone-900"}`}>{brandName}</span>
              </div>
              <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.to);
                  return (
                    <SheetClose asChild key={item.to}>
                      <Link
                        to={item.to}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                          active ? sb.navActive || "bg-[#EEF2FF] text-indigo-700 font-semibold" : sb.navBase || "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${active ? sb.navIconActive || "text-indigo-600" : sb.navIcon || "text-stone-400"}`} /> {item.label}
                      </Link>
                    </SheetClose>
                  );
                })}
              </nav>
              <div className={`p-3 border-t flex flex-col gap-1 ${sb.border || "border-stone-200"}`}>
                <SheetClose asChild>
                  <Link
                    to="/change-password"
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full text-left ${sb.actionBtn || "text-stone-600 hover:bg-stone-100"}`}
                  >
                    <KeyRound className="w-4 h-4" /> Change Password
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <button
                    onClick={onLogout}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full text-left ${sb.actionBtn || "text-stone-600 hover:bg-stone-100"}`}
                  >
                    <LogOut className="w-4 h-4" /> Log Out
                  </button>
                </SheetClose>
                <SheetClose asChild>
                  <button
                    onClick={onDeleteAccount}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full text-left ${sb.deleteBtn || "text-rose-600 hover:bg-rose-50"}`}
                  >
                    <Trash2 className="w-4 h-4" /> Delete Account
                  </button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
          {isSubPage ? (
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-sm font-medium text-stone-700 py-2 pr-3"
            >
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg object-contain bg-indigo-50 p-0.5 border border-stone-200" />
              ) : (
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-xs">A</div>
              )}
              <span className="text-sm font-semibold text-stone-900 truncate">{brandName}</span>
            </div>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 text-stone-500 hover:text-stone-900" aria-label="Account menu">
              <UserCircle className="w-6 h-6" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link to="/change-password">
                <KeyRound className="w-4 h-4 mr-2" /> Change Password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="w-4 h-4 mr-2" /> Log Out
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDeleteAccount} className="text-destructive focus:text-destructive">
              <Trash2 className="w-4 h-4 mr-2" /> Delete Account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}