import React from "react";
import { AlertTriangle, Info } from "lucide-react";
import CopyChip from "@/components/branding/CopyChip";
import { CNAME_TARGET, PLATFORM_HOSTS, PLATFORM_DOMAIN } from "@/lib/utils";
import { normalizeHost } from "../../../shared/custom-domain.js";

const isPlatformHost = (h) => PLATFORM_HOSTS.includes(h);
const underPlatformDomain = (h) => h.endsWith(`.${PLATFORM_DOMAIN}`);

// Step-by-step DNS instructions matching the domain being connected.
export default function DnsRecordsGuide({ domain }) {
  const clean = normalizeHost(domain);
  const labels = clean ? clean.split(".").filter(Boolean) : [];
  const invalidInput = labels.length < 2 || (labels.length === 2 && labels[0] === "www");
  const platformOwn = !invalidInput && isPlatformHost(clean);
  const portalSubdomain = !invalidInput && !platformOwn && underPlatformDomain(clean);
  const isSubdomain = !invalidInput && !platformOwn && !portalSubdomain && labels.length > 2 && labels[0] !== "www";
  const prefix = labels[0] || "";

  const rows = isSubdomain
    ? [
        { type: "CNAME", name: prefix, value: CNAME_TARGET },
        { type: "CNAME", optional: true, name: `www.${prefix}`, value: CNAME_TARGET },
      ]
    : [
        { type: "CNAME", name: "@", value: CNAME_TARGET },
        { type: "CNAME", name: "www", value: CNAME_TARGET },
      ];

  return (
    <div className="border rounded-lg p-4 bg-white text-sm space-y-4">
      {invalidInput && (
        <div className="flex gap-2 bg-stone-50 border border-stone-200 rounded-lg p-3 text-xs text-stone-700">
          <Info className="w-4 h-4 shrink-0 text-stone-400" />
          <p>
            Enter your full domain, e.g. <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{prefix || "lpu"}.examos.com</code>{" "}
            or <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">lpu.edu</code>.
          </p>
        </div>
      )}

      {platformOwn && (
        <div className="flex gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800">
          <Info className="w-4 h-4 shrink-0 text-emerald-600" />
          <p>
            This is the platform's own address (<code className="bg-emerald-100 rounded px-1 py-0.5 font-mono">{CNAME_TARGET}</code>)
            — no DNS records are needed.
          </p>
        </div>
      )}

      {portalSubdomain && (
        <div className="flex gap-2 bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-800">
          <Info className="w-4 h-4 shrink-0 text-indigo-600" />
          <p>
            <code className="bg-indigo-100 rounded px-1 py-0.5 font-mono">{clean}</code> is a portal address under the platform's own
            domain. No DNS changes are needed on your side — the platform manages this domain. Your branded portal is accessible at{" "}
            <code className="bg-indigo-100 rounded px-1 py-0.5 font-mono">https://{clean}</code>.
          </p>
        </div>
      )}

      {!invalidInput && !platformOwn && !portalSubdomain && (
        <div>
          <h4 className="font-heading font-semibold text-stone-900">
            Connect your {isSubdomain ? "subdomain" : "domain"} through your DNS provider
          </h4>
          <p className="text-xs text-stone-500 mt-1">
            Use a domain managed by another provider by updating your DNS records as shown below.
          </p>

          <div>
            <p className="text-[11px] font-semibold tracking-wide text-stone-400 uppercase mb-1.5">
              Step 1 — Add the {isSubdomain ? "CNAME record" : "DNS records"}
            </p>
            <p className="text-xs text-stone-600 mb-2">
              Sign in to your DNS provider and add the record{rows.length > 1 ? "s" : ""} below. For{" "}
              <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{clean}</code>
              {isSubdomain && (
                <>
                  , set <span className="font-semibold">Name</span> to{" "}
                  <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{prefix}</code>
                </>
              )}
              :
            </p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 text-left text-stone-500">
                  <tr>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Name</th>
                    <th className="py-2 px-3 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-2 px-3 text-stone-700 align-top">
                        {r.type}
                        {r.optional && <span className="block text-[11px] text-stone-400 uppercase tracking-wide">Optional</span>}
                      </td>
                      <td className="py-2 px-3"><CopyChip value={r.name} /></td>
                      <td className="py-2 px-3"><CopyChip value={r.value} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="list-disc pl-4 text-xs text-stone-600 space-y-1.5">
            {isSubdomain && (
              <li>
                Enter just the prefix — <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{prefix}</code>, not{" "}
                <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{clean}</code>. Most providers add the rest of
                your domain automatically.
              </li>
            )}
            {!isSubdomain && (
              <li>
                <span className="font-semibold">Prefer a subdomain?</span> Enter something like{" "}
                <code className="bg-stone-100 rounded px-1 py-0.5 font-mono">{prefix || "lpu"}.yourdomain.com</code> instead —
                it only needs a single CNAME record and avoids apex limitations.
              </li>
            )}
            <li>
              If you see a <span className="font-semibold">TTL</span> field, leave it at the default (or "Automatic"). You
              don't need to change it.
            </li>
          </ul>

          <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <p>
              {isSubdomain ? (
                <>
                  Subdomains only need a CNAME pointing to{" "}
                  <code className="bg-amber-100 rounded px-1 py-0.5 font-mono">{CNAME_TARGET}</code>. Remove any A, AAAA, or other
                  records at the same hostname to avoid conflicts.
                </>
              ) : (
                <>
                  Apex domains require CNAME support at the root (sometimes called{" "}
                  <span className="font-semibold">ALIAS</span> or{" "}
                  <span className="font-semibold">ANAME</span>). Remove any existing A, AAAA, or CNAME records at the same
                  hostnames to avoid conflicts.
                </>
              )}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-wide text-stone-400 uppercase mb-1">Step 2 — Wait for DNS to update</p>
            <p className="text-xs text-stone-600">
              Once the record{rows.length > 1 ? "s are" : " is"} added, click <span className="font-semibold">"Verify DNS"</span>{" "}
              to complete setup. DNS changes usually take effect within a few minutes but can take up to 48 hours to fully
              propagate.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}