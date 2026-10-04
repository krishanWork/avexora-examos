import React, { useState, useEffect } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Mail,
  Lock,
  Loader2,
  Building2,
  GraduationCap,
  Eye,
  EyeOff,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import InstitutionLookupDialog from "@/components/auth/InstitutionLookupDialog";
import { stopImpersonation } from "@/lib/impersonation";
import { rolePortal } from "@/lib/roles";
import useTenantDomain from "@/hooks/useTenantDomain";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showLookupDialog, setShowLookupDialog] = useState(false);

  const { school: pathSchool } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const schoolParam = pathSchool || searchParams.get("school");
  const [queryBrand, setQueryBrand] = useState(null);
  const { branding: domainBrand } = useTenantDomain();

  // Picked tenant state (for manual platform lookup)
  const [picked, setPicked] = useState(null);

  // Custom domain branding or query param scoping
  const domainScope = domainBrand?.subdomain || domainBrand?.custom_domain;
  const resolvedSchool = schoolParam || domainScope || null;
  const brand = queryBrand || domainBrand;
  const scoped = Boolean(resolvedSchool);
  const scopedTenantId = brand?.id || brand?._id || null;
  const isDedicatedPortal = Boolean(pathSchool || domainScope);

  // Retrieve remembered email on initial mount
  useEffect(() => {
    try {
      const savedEmail = localStorage.getItem("examos_remember_email");
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  // Institution-branded login: /login?school=<subdomain or custom domain>
  useEffect(() => {
    if (!schoolParam) return;
    let active = true;
    appClient.functions
      .invoke("publicSite", { action: "branding", school: schoolParam })
      .then((res) => {
        if (active) setQueryBrand(res.data?.branding || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [schoolParam]);

  const clearInstitution = () => {
    setPicked(null);
    setQueryBrand(null);
    navigate("/login", { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const tenantId = picked?.id || scopedTenantId || undefined;
    const school = picked
      ? picked.subdomain || picked.custom_domain
      : schoolParam || domainScope || undefined;

    try {
      const res = await appClient.auth.loginViaEmailPassword(email, password, {
        tenant_id: tenantId,
        school,
      });

      // Handle "Remember Me" storage
      try {
        if (rememberMe && email) {
          localStorage.setItem("examos_remember_email", email);
        } else {
          localStorage.removeItem("examos_remember_email");
        }
      } catch {
        // Ignore storage write issues
      }

      stopImpersonation();
      const user = res.user || (await appClient.auth.me().catch(() => null));
      window.location.href = user?.must_change_password
        ? "/change-password"
        : rolePortal(user) || "/home";
    } catch (err) {
      setError(err.message || "Invalid email or password. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const activeInstitution = (scoped && brand) || picked;
  const institutionName = activeInstitution?.name;

  return (
    <AuthLayout
      icon={GraduationCap}
      brand={brand || picked}
      variant="split"
      title={institutionName ? `Sign in to ${institutionName}` : "Welcome back"}
      subtitle={
        institutionName
          ? "Enter your institutional credentials to access your portal"
          : "Sign in to manage exams, review scorecards, and access your portal"
      }
      footer={
        isDedicatedPortal ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Need portal access or password help? Please contact your campus administration.
          </p>
        ) : (
          <>
            Don't have an institution account?{" "}
            <Link to="/register" className="text-primary font-semibold hover:underline">
              Create an organization
            </Link>
          </>
        )
      }
    >
      {/* Active Institution Banner or Sleek Lookup Trigger */}
      {scoped ? (
        <div className="flex items-center justify-between p-3.5 rounded-2xl border border-primary/20 bg-primary/5 mb-6 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
              {brand?.logo_url ? (
                <img src={brand.logo_url} alt={brand.name} className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-5 h-5 text-primary" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-primary font-semibold block">
                {isDedicatedPortal ? "Official Campus Portal" : "Scoped Institution"}
              </span>
              <p className="text-sm font-semibold text-foreground truncate">
                {brand?.name || "Institution Login"}
              </p>
            </div>
          </div>
          {isDedicatedPortal ? (
            !domainScope && (
              <Link
                to="/login"
                className="text-xs text-muted-foreground hover:text-foreground h-8 px-2.5 flex items-center shrink-0"
                title="Return to global platform login"
              >
                Platform login
              </Link>
            )
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearInstitution}
              className="text-xs text-muted-foreground hover:text-foreground h-8 px-2.5 shrink-0"
            >
              Switch
            </Button>
          )}
        </div>
      ) : picked ? (
        <div className="flex items-center justify-between p-3.5 rounded-2xl border border-primary/20 bg-primary/5 mb-6 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
              {picked.logo_url ? (
                <img src={picked.logo_url} alt={picked.name} className="w-full h-full object-contain p-1" />
              ) : (
                <Building2 className="w-5 h-5 text-primary" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-primary font-semibold block">
                Selected Campus
              </span>
              <p className="text-sm font-semibold text-foreground truncate">{picked.name}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPicked(null)}
            className="text-xs text-muted-foreground hover:text-foreground h-8 px-2.5 shrink-0"
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowLookupDialog(true)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-dashed border-border hover:border-primary/50 bg-muted/30 hover:bg-muted/60 transition-all text-left group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Building2 className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground truncate">
                Logging in to a specific school or campus?
              </span>
            </div>
            <span className="text-xs font-medium text-primary shrink-0 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
              Select school <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </button>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-3 animate-in fade-in-50 duration-200">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs leading-relaxed">{error}</div>
          <button
            type="button"
            onClick={() => setError("")}
            className="text-destructive/70 hover:text-destructive text-xs font-bold leading-none p-1"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Primary Credentials Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-medium text-foreground">
            {isDedicatedPortal ? "Email, Roll Number, or Student ID" : "Email or School Account"}
          </Label>
          <div className="relative">
            <Mail
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="email"
              type="text"
              inputMode="text"
              autoComplete="username"
              autoFocus={!email}
              placeholder={
                isDedicatedPortal
                  ? `e.g. 2026-X-042 or you@${activeInstitution?.subdomain || "school"}.edu`
                  : institutionName
                    ? `name@${activeInstitution.subdomain || "institution"}.edu`
                    : "name@school.edu or admin@domain.com"
              }
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-11 text-sm rounded-xl border-border bg-card focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-medium text-foreground">
              Password
            </Label>
            <Link
              to="/forgot-password"
              className="text-xs text-primary font-medium hover:underline transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 pr-10 h-11 text-sm rounded-xl border-border bg-card focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Remember Me Checkbox */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(Boolean(checked))}
              className="rounded-md border-muted-foreground/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <label
              htmlFor="remember"
              className="text-xs text-muted-foreground font-medium leading-none cursor-pointer select-none"
            >
              Remember my email
            </label>
          </div>
        </div>

        {/* Sign In CTA Button */}
        <Button
          type="submit"
          className="w-full h-11 text-sm font-semibold rounded-xl transition-all shadow-sm"
          style={
            activeInstitution?.primary_color
              ? {
                  backgroundColor: activeInstitution.primary_color,
                  borderColor: activeInstitution.primary_color,
                  color: "#ffffff",
                }
              : undefined
          }
          disabled={loading}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in...
            </span>
          ) : institutionName ? (
            `Sign in to ${institutionName}`
          ) : (
            "Sign in to ExamOS"
          )}
        </Button>

        {/* Student & Parent Helper Note */}
        <div className="mt-6 pt-4 border-t border-border/80">
          <div className="rounded-xl bg-muted/40 p-3.5 border border-border/60 flex items-start gap-3">
            <GraduationCap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Student or Parent?</span> You can log in using your Roll Number, Admission ID, or registered school email with your portal password.
            </div>
          </div>
        </div>
      </form>

      {/* Institution Search Modal */}
      <InstitutionLookupDialog
        open={showLookupDialog}
        onOpenChange={setShowLookupDialog}
        onSelect={(tenant) => {
          setPicked(tenant);
        }}
        currentPicked={picked}
      />
    </AuthLayout>
  );
}