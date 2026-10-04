import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { appClient } from "@/api/appClient";
import usePlatformBranding from "@/hooks/usePlatformBranding";
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { Menu } from "lucide-react";

const LINKS = [
  { to: "/pricing", label: "Pricing" },
  { to: "/book-demo", label: "Book a Demo" },
  { to: "/contact", label: "Contact" },
];

export default function MarketingNavbar() {
  const [authed, setAuthed] = useState(false);
  const branding = usePlatformBranding();

  useEffect(() => {
    appClient.auth.isAuthenticated().then(setAuthed).catch(() => setAuthed(false));
  }, []);

  return (
    <header className="fixed top-4 inset-x-0 z-50 px-4">
      <div className="max-w-5xl mx-auto flex items-center justify-between h-14 px-5 rounded-2xl bg-white/[0.06] backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <Link to="/" className="flex items-center gap-2.5">
          {branding?.header_logo_url ? (
            <img src={branding.header_logo_url} alt="Avexora ExamOS" className=" h-10 rounded-xl object-contain" />
          ) : (
             <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-violet-500/30">A</div>
          )}
         
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) =>
              `px-4 py-2 rounded-xl text-sm font-medium transition-colors ${isActive ? "text-white bg-white/10" : "text-stone-300 hover:text-white hover:bg-white/5"}`
            }>{l.label}</NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {authed ? (
            <Link to="/home" className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:opacity-90 transition-opacity">
              Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden sm:block px-4 py-2 rounded-xl text-sm font-medium text-stone-300 hover:text-white hover:bg-white/5 transition-colors">
                Log In
              </Link>
              <Link to="/register" className="px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:opacity-90 transition-opacity">
                Get Started
              </Link>
            </>
          )}
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <button className="md:hidden p-2 text-stone-200 hover:text-white transition-colors" aria-label="Open menu">
              <Menu className="w-6 h-6" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] sm:max-w-[300px] bg-[#12121F] border-white/10 text-white">
            <nav className="flex flex-col gap-1 pt-8">
              {LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `px-4 py-3 rounded-xl text-sm font-medium transition-colors ${isActive ? "text-white bg-white/10" : "text-stone-300 hover:text-white hover:bg-white/5"}`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-6 pt-6 border-t border-white/10 flex flex-col gap-3">
              {authed ? (
                <SheetClose asChild>
                  <Link to="/home" className="px-4 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 text-center">
                    Go to Dashboard
                  </Link>
                </SheetClose>
              ) : (
                <>
                  <SheetClose asChild>
                    <Link to="/login" className="px-4 py-3 rounded-xl text-sm font-medium text-stone-300 hover:text-white hover:bg-white/5 transition-colors text-center">
                      Log In
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link to="/register" className="px-4 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 text-center">
                      Get Started
                    </Link>
                  </SheetClose>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}