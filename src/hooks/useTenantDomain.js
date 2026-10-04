import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { PLATFORM_HOSTS } from "@/lib/utils";

// Detects whether the app is being viewed on a tenant's custom domain
// and returns that tenant's public branding. Result is cached per session.
// Only the platform's own hosts (and localhost) are treated as non-tenant —
// any other host, including a school's *.avexora.in portal subdomain, is a
// branded candidate.
const isPlatformHost = (h) => h === "localhost" || h === "127.0.0.1" || PLATFORM_HOSTS.includes(h);

export default function useTenantDomain() {
  const host = window.location.hostname.toLowerCase();
  const candidate = !isPlatformHost(host);
  const cacheKey = `tenant-domain-branding:${host}`;
  const cached = candidate ? sessionStorage.getItem(cacheKey) : null;

  const [branding, setBranding] = useState(cached ? JSON.parse(cached) : null);
  const [checking, setChecking] = useState(candidate && cached === null);

  useEffect(() => {
    if (!candidate || cached !== null) return;
    let active = true;
    appClient.functions
      .invoke("publicSite", { action: "branding", school: host })
      .then((res) => {
        const b = res.data?.branding || null;
        sessionStorage.setItem(cacheKey, JSON.stringify(b));
        if (active) setBranding(b);
      })
      .catch(() => {
        if (active) setBranding(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [candidate, cached, cacheKey, host]);

  return { checking, branding };
}