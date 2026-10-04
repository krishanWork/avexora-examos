import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Sheet, SheetContent, SheetTrigger, SheetClose,
} from "@/components/ui/sheet";
import { MoreHorizontal } from "lucide-react";

const VISIBLE = 4;

export default function BottomTabBar({ items }) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (to) => location.pathname === to || (to !== "/" && location.pathname.startsWith(to + "/"));
  const hasMore = items.length > VISIBLE;
  const tabs = items.slice(0, VISIBLE);
  const moreItems = items.slice(VISIBLE);

  if (items.length === 0) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-stone-200 flex"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors min-h-14 ${
              active ? "text-indigo-600" : "text-stone-500"
            }`}
          >
            <span className={`w-8 h-1 rounded-full ${active ? "bg-indigo-600" : "bg-transparent"}`} />
            <Icon className="w-5 h-5" />
            <span className="truncate max-w-full px-1">{item.label}</span>
          </Link>
        );
      })}

      {hasMore && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={`flex-1 flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors min-h-14 ${
                moreItems.some((i) => isActive(i.to)) ? "text-indigo-600" : "text-stone-500"
              }`}
            >
              <span className={`w-8 h-1 rounded-full ${moreItems.some((i) => isActive(i.to)) ? "bg-indigo-600" : "bg-transparent"}`} />
              <MoreHorizontal className="w-5 h-5" />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="p-0 pb-4">
            <div className="flex items-center justify-between px-5 h-12 border-b border-stone-200">
              <span className="text-sm font-semibold text-stone-900">All sections</span>
            </div>
            <div className="grid grid-cols-2 gap-1 p-4">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                return (
                  <SheetClose asChild key={item.to}>
                    <Link
                      to={item.to}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-colors ${
                        active ? "bg-[#EEF2FF] text-indigo-700 font-semibold" : "text-stone-600 hover:bg-stone-100"
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? "text-indigo-600" : "text-stone-400"}`} /> {item.label}
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </nav>
  );
}