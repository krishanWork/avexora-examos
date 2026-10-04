import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


export const isIframe = window.self !== window.top;

// Root domain under which each school's portal subdomain lives.
export const PLATFORM_DOMAIN = "avexora.in";

// Canonical hostname schools CNAME their custom domain to. A DNS record value
// is a plain hostname — no scheme, no trailing slash. Keep this as a host the
// platform owns in its own DNS so migrating hosting providers never requires
// re-pointing schools' CNAME records.
export const CNAME_TARGET = "examos.avexora.in";

// Hosts that ARE the platform itself (marketing/login), never a school portal.
export const PLATFORM_HOSTS = ["avexora.in", "examos.avexora.in", "www.examos.avexora.in"];

export const portalUrl = (subdomain) => `https://${subdomain}.${PLATFORM_DOMAIN}`;
