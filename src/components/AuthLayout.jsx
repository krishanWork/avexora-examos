import React from "react";
import usePlatformBranding from "@/hooks/usePlatformBranding";
import AuthShowcase from "@/components/auth/AuthShowcase";

export default function AuthLayout({
  icon: Icon,
  title,
  subtitle,
  footer,
  brand,
  variant = "centered",
  showcase,
  children,
}) {
  const platform = usePlatformBranding();
  const contact = brand ? [brand.contact_phone, brand.contact_email].filter(Boolean).join(" · ") : "";

  // Split-screen variant (Enterprise / Modern SaaS)
  if (variant === "split") {
    return (
      <div className="min-h-screen w-full flex flex-col lg:flex-row bg-background">
        {/* Left Pane: Interactive Form Area */}
        <div className="w-full lg:w-[48%] xl:w-[45%] min-h-screen flex flex-col justify-between px-6 py-8 sm:px-12 sm:py-10 lg:px-14 lg:py-12 bg-background z-10">
          {/* Header Brand Bar */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              {brand?.logo_url ? (
                <img
                  src={brand.logo_url}
                  alt={brand.name}
                  className="w-10 h-10 rounded-xl object-contain border border-border bg-white shadow-2xs p-1"
                />
              ) : platform?.login_logo_url ? (
                <img
                  src={platform.login_logo_url}
                  alt={platform.brand_name || "ExamOS"}
                  className="w-10 h-10 rounded-xl object-contain border border-border bg-white shadow-2xs p-1"
                />
              ) : Icon ? (
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-xs">
                  <Icon className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
                </div>
              ) : null}

              <div>
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  {brand?.name || platform?.brand_name || "Avexora ExamOS"}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  {brand?.name ? "Institutional Portal" : "Examination Platform"}
                </p>
              </div>
            </div>

            {brand?.address && (
              <span className="hidden sm:inline-block text-[11px] text-muted-foreground/80 max-w-[200px] truncate text-right">
                {brand.address}
              </span>
            )}
          </div>

          {/* Center Content Container */}
          <div className="w-full max-w-md mx-auto my-auto py-6">
            <div className="mb-7">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-heading">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-1.5 font-body">
                  {subtitle}
                </p>
              )}
            </div>

            {/* Form & Children */}
            <div>{children}</div>

            {/* Card Footer if passed */}
            {footer && (
              <div className="mt-6 text-center text-sm text-muted-foreground">
                {footer}
              </div>
            )}
          </div>

          {/* Bottom Footnote & White-Label Attribution */}
          <div className="pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            {contact ? (
              <span className="truncate max-w-xs">{contact}</span>
            ) : (
              <span>© {new Date().getFullYear()} {platform?.brand_name || "Avexora ExamOS"}</span>
            )}
            
            {brand && brand.powered_by_avexora !== false && (
              <span className="text-[11px] text-muted-foreground/70 font-mono">
                Powered by Avexora ExamOS
              </span>
            )}
          </div>
        </div>

        {/* Right Pane: Visual Showcase (Hidden on Mobile) */}
        <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] sticky top-0 h-screen overflow-hidden">
          {showcase || <AuthShowcase brand={brand} platform={platform} />}
        </div>
      </div>
    );
  }

  // Classic Centered Variant (for ForgotPassword, ResetPassword, VerifyEmail)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {brand?.logo_url ? (
            <img
              src={brand.logo_url}
              alt={brand.name}
              className="w-14 h-14 rounded-2xl object-contain mx-auto mb-4 border border-border bg-white shadow-2xs p-1.5"
            />
          ) : platform?.login_logo_url ? (
            <img
              src={platform.login_logo_url}
              alt={platform.brand_name || "Avexora ExamOS"}
              className="w-14 h-14 rounded-2xl object-contain mx-auto mb-4 border border-border bg-white shadow-2xs p-1.5"
            />
          ) : Icon ? (
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4 shadow-xs">
              <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
            </div>
          ) : null}

          {brand?.name && (
            <p
              className="text-lg font-semibold mb-1"
              style={brand.primary_color ? { color: brand.primary_color } : undefined}
            >
              {brand.name}
            </p>
          )}
          {brand?.address && <p className="text-xs text-muted-foreground">{brand.address}</p>}
          {contact && <p className="text-xs text-muted-foreground mb-3">{contact}</p>}
          
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-heading">
            {title}
          </h1>
          {(brand?.login_message || subtitle) && (
            <p className="text-sm text-muted-foreground mt-2 font-body">
              {brand?.login_message || subtitle}
            </p>
          )}
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border p-6 sm:p-8">
          {children}
        </div>

        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
        
        {brand && brand.powered_by_avexora !== false && (
          <p className="text-center text-[11px] text-muted-foreground/70 mt-3 font-mono">
            Powered by Avexora ExamOS
          </p>
        )}
      </div>
    </div>
  );
}