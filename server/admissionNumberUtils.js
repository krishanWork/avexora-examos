/**
 * Canonical Admission Number Utilities
 *
 * Handles leading-zero preservation, uppercase normalization,
 * fixed-prefix stripping, and display reconstitution.
 *
 * Never casts to integer — all values are strings to preserve leading zeros.
 */

/**
 * Returns the canonical (normalized) form of an admission number.
 *
 * @param {string} raw — The raw admission number string from the database or OMR scan.
 * @param {object} tenantConfig — Tenant configuration object (may contain `fixed_prefix`).
 * @param {string} [tenantConfig.fixed_prefix] — Verified fixed prefix to strip (e.g. "ADM-SPRINGDALE-").
 * @returns {string|null} The canonical numeric core, or null if invalid.
 */
export function canonicalAdmissionNumber(raw, tenantConfig = {}) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim().toUpperCase();
  if (s === "") return null;

  const prefix = tenantConfig.fixed_prefix;
  if (prefix && typeof prefix === "string" && prefix.length > 0) {
    const upperPrefix = prefix.toUpperCase();
    if (s.startsWith(upperPrefix)) {
      s = s.slice(upperPrefix.length).trim();
    }
  }

  if (s === "") return null;
  return s;
}

/**
 * Reconstitutes the full display admission number from a canonical core.
 *
 * @param {string} canonical — The canonical numeric core (e.g. "001042").
 * @param {object} tenantConfig — Tenant configuration object.
 * @param {string} [tenantConfig.fixed_prefix] — Prefix to prepend (e.g. "ADM-SPRINGDALE-").
 * @returns {string|null} The full display string, or null if canonical is null/empty.
 */
export function formatFullAdmissionNumber(canonical, tenantConfig = {}) {
  if (!canonical || typeof canonical !== "string") return null;
  const prefix = tenantConfig.fixed_prefix;
  if (prefix && typeof prefix === "string" && prefix.length > 0) {
    return `${prefix}${canonical}`;
  }
  return canonical;
}
