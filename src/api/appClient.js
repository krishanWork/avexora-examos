import { getImpersonation } from "@/lib/impersonation";

const AUTH_TOKEN_KEY = "avexora_examos_token";
const API_URL = import.meta.env.VITE_API_URL || "/api";
const getToken = () => localStorage.getItem(AUTH_TOKEN_KEY);
const setToken = (token) => localStorage.setItem(AUTH_TOKEN_KEY, token);
const clearToken = () => localStorage.removeItem(AUTH_TOKEN_KEY);

// While the platform owner is "viewing as" a school, every request says which one.
//
// The overlay in @/lib/impersonation only changes what React renders, so without
// this the real super_admin token went out, the server's readScope() short-circuited
// on platform(), and every screen showed EVERY institution under a banner naming
// one. Sending the scope here — in the one place every call already passes through
// — is what makes the banner true.
//
// It narrows and never widens: the server ignores the header for anyone who is not
// a super_admin, and a caller who omits it keeps today's platform-wide read. That
// is why this is a display and authority constraint, not a security boundary.
const viewAsHeaders = () => {
  const tenantId = getImpersonation()?.tenant_id;
  return tenantId ? { "X-View-As-Tenant": tenantId } : {};
};

async function request(path, options = {}) {
  const token = getToken();
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...viewAsHeaders(),
    ...options.headers,
  };
  // FormData needs the browser-assigned multipart boundary — never override it.
  if (!isForm) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: response.status, data });
  return data;
}

const entity = (name) => ({
  list: (sort = "-created_date", limit) =>
    request(`/entities/${name}?sort=${encodeURIComponent(sort)}&limit=${limit || ""}`),
  filter: (query = {}, sort = "-created_date", limit, skip = 0) =>
    request(`/entities/${name}/filter`, { method: "POST", body: JSON.stringify({ query, sort, limit, skip }) }),
  get: (id) => request(`/entities/${name}/${id}`),
  create: (data) => request(`/entities/${name}`, { method: "POST", body: JSON.stringify(data) }),
  update: (id, data) => request(`/entities/${name}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id) => request(`/entities/${name}/${id}`, { method: "DELETE" }),
  bulkCreate: (items) => request(`/entities/${name}/bulk`, { method: "POST", body: JSON.stringify({ items }) }),
  bulkUpdate: (items) => request(`/entities/${name}/bulk`, { method: "PATCH", body: JSON.stringify({ items }) }),
  updateMany: (query, update) => request(`/entities/${name}/many`, { method: "PATCH", body: JSON.stringify({ query, update }) }),
  deleteMany: (query) => request(`/entities/${name}/many`, { method: "DELETE", body: JSON.stringify({ query }) }),
});

export const appClient = {
  entities: new Proxy({}, { get: (_, name) => entity(name) }),
  auth: {
    me: () => request("/auth/me"),
    isAuthenticated: async () => Boolean(getToken()),
    loginViaEmailPassword: async (email, password, scope) => {
      const { tenant_id, school } = scope || {};
      const data = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, tenant_id, school }),
      });
      if (data.token) setToken(data.token);
      return data;
    },
    register: async ({ email, password, full_name, role, app_role, school_name }) => {
      const data = await request("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name, role, app_role, school_name }),
      });
      if (data.token) setToken(data.token);
      return data;
    },
    resendOtp: () => Promise.resolve(),
    verifyOtp: async () => ({ access_token: getToken() }),
    loginWithProvider: (_provider, redirect = "/") => {
      window.location.assign(redirect);
    },
    resetPasswordRequest: (email) =>
      request("/auth/reset-password-request", { method: "POST", body: JSON.stringify({ email }) }),
    resetPassword: ({ resetToken, newPassword }) =>
      request("/auth/reset-password", { method: "POST", body: JSON.stringify({ resetToken, newPassword }) }),
    changePassword: ({ currentPassword, newPassword }) =>
      request("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
    // Verification deliberately takes no tenant or role argument: the token is
    // the only credential, and the server resolves the account from it. Sending
    // an id here would invite callers to start believing it is authoritative.
    verifyEmail: (token) =>
      request("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
    // Session-scoped. Needs the stored token, which the verify screen keeps.
    resendVerification: () => request("/auth/resend-verification", { method: "POST" }),
    setToken,
    logout: async (redirect) => {
      clearToken();
      if (redirect) window.location.assign(typeof redirect === "string" ? redirect : "/login");
    },
    redirectToLogin: () => window.location.assign("/login"),
  },
  functions: {
    invoke: async (name, data) => ({
      data: await request(`/functions/${name}`, { method: "POST", body: JSON.stringify(data) }),
    }),
  },
  integrations: {
    Core: {
      UploadFile: async ({ file, purpose, tenant_id }) => {
        const formData = new FormData();
        formData.append("file", file);
        if (purpose) formData.append("purpose", purpose);
        // The impersonated school, read through the shared reader rather than a
        // second hand-rolled sessionStorage lookup. This is also a request the
        // central header would not reach on its own — it does not go through
        // request() — so the header is added explicitly here and the same value is
        // still sent in the body for older servers. The server decides which wins.
        const scopeTenantId = getImpersonation()?.tenant_id;
        let resolvedTenantId = tenant_id || scopeTenantId;
        if (resolvedTenantId) formData.append("tenant_id", resolvedTenantId);
        const token = getToken();
        const response = await fetch(`${API_URL}/upload`, {
          method: "POST",
          headers: {
            ...(token && { Authorization: `Bearer ${token}` }),
            ...(scopeTenantId && { "X-View-As-Tenant": scopeTenantId }),
          },
          body: formData,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "File upload failed");
        return { file_url: data.file_url };
      },
      ExtractDataFromUploadedFile: (payload) =>
        request("/integrations/extract", { method: "POST", body: JSON.stringify(payload) }),
      InvokeLLM: (payload) =>
        request("/integrations/llm", { method: "POST", body: JSON.stringify(payload) }),
    },
  },
  users: {
    inviteUser: (email, role) =>
      request("/users/invite", { method: "POST", body: JSON.stringify({ email, role }) }),
    provisionUser: (payload) =>
      request("/users/provision", { method: "POST", body: JSON.stringify(payload) }),
    // The employee tenant boundary. It has no entity-API equivalent on purpose:
    // assigned_tenant_ids is a secret field server-side, so it is stripped from
    // every ordinary User projection and refused on the generic write path. This
    // is the only way to read or set it, and the server checks super_admin,
    // validates the institutions, and audits the change.
    getAssignedTenants: (userId) =>
      request("/functions/manageStaff", {
        method: "POST",
        body: JSON.stringify({ action: "getAssignedTenants", user_id: userId }),
      }),
    setAssignedTenants: (userId, tenantIds) =>
      request("/functions/manageStaff", {
        method: "POST",
        body: JSON.stringify({ action: "setAssignedTenants", user_id: userId, tenant_ids: tenantIds }),
      }),
  },
  // The affiliate programme. Its own block rather than the entities Proxy, for
  // the same reason `lead` has one: these routes aggregate across collections,
  // enforce a privilege write (commission_rate), or move money (approve/pay), and
  // none of that can be expressed by a generic field map.
  affiliate: {
    list: (params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      });
      return request(`/affiliates?${qs.toString()}`);
    },
    create: (payload) => request("/affiliates", { method: "POST", body: JSON.stringify(payload) }),
    // Only the fields on the server's allowlist are accepted; anything else is
    // refused by name rather than silently dropped.
    update: (id, payload) => request(`/affiliates/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    sales: (id, params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      });
      return request(`/affiliates/${id}/sales?${qs.toString()}`);
    },
    approve: (id, saleId) => request(`/affiliates/${id}/sales/${saleId}/approve`, { method: "POST" }),
    markPaid: (id, saleId, note) =>
      request(`/affiliates/${id}/sales/${saleId}/pay`, { method: "POST", body: JSON.stringify({ note }) }),
    // --- Subscriptions and renewal reminders -------------------------------------
    // The super admin and the reseller call the SAME routes for these; the server
    // resolves which affiliate is involved from the session and refuses anything the
    // caller does not own, so there is no separate "my subscriptions" endpoint that
    // could drift from the authorized one.
    subscriptions: (id, params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      });
      return request(`/affiliates/${id}/subscriptions?${qs.toString()}`);
    },
    subscriptionSettings: (id) => request(`/affiliates/${id}/subscription-settings`),
    saveSubscriptionSettings: (id, payload) =>
      request(`/affiliates/${id}/subscription-settings`, { method: "PATCH", body: JSON.stringify(payload) }),
    whatsappTemplates: (id) => request(`/affiliates/${id}/whatsapp-templates`),
    reminderPreview: (id, subscriptionId) =>
      request(`/affiliates/${id}/subscriptions/${subscriptionId}/reminder-preview`),
    // `paid_through` is the period being advanced FROM, and is sent back so a
    // double-click or a stale tab cannot book two renewals.
    renew: (id, subscriptionId, paidThrough, paymentMethod) =>
      request(`/affiliates/${id}/subscriptions/${subscriptionId}/renew`, {
        method: "POST",
        body: JSON.stringify({ paid_through: paidThrough, payment_method: paymentMethod }),
      }),
    sendReminder: (id, subscriptionId, payload = {}) =>
      request(`/affiliates/${id}/subscriptions/${subscriptionId}/send-reminder`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    deliveries: (id, subscriptionId) =>
      request(`/affiliates/${id}/subscriptions/${subscriptionId}/deliveries`),
    // The reseller's own surface. Both actions take no affiliate_id: the server
    // resolves the caller from the session and scopes every query to that profile,
    // so there is nothing here a caller could point at somebody else's ledger.
    mySummary: () =>
      request("/functions/affiliateSell", { method: "POST", body: JSON.stringify({ action: "summary" }) }),
    sell: (payload) =>
      request("/functions/affiliateSell", { method: "POST", body: JSON.stringify({ action: "sell", ...payload }) }),
  },
  lead: {
    list: (params = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      });
      return request(`/leads?${qs.toString()}`);
    },
    sendEmail: (id, payload) => {
      const body =
        typeof FormData !== "undefined" && payload instanceof FormData
          ? payload
          : JSON.stringify({ subject: payload.subject, message: payload.message });
      return request(`/leads/${id}/email`, { method: "POST", body });
    },
    emailHistory: (id) => request(`/leads/${id}/email-history`),
    whatsapp: (id) => request(`/leads/${id}/whatsapp`),
    whatsappTemplates: (id) => request(`/leads/${id}/whatsapp/templates`),
    sendWhatsapp: (id, payload) => request(`/leads/${id}/whatsapp/messages`, { method: "POST", body: JSON.stringify(payload) }),
    sendWhatsappMedia: (id, formData) => request(`/leads/${id}/whatsapp/media`, { method: "POST", body: formData }),
    getSettings: () => request("/lead-settings"),
    saveSettings: (payload) => request("/lead-settings", { method: "PUT", body: JSON.stringify(payload) }),
    getIntegrationSettings: () => request("/integration-settings"),
    saveIntegrationSettings: (payload) => request("/integration-settings", { method: "PUT", body: JSON.stringify(payload) }),
  },
};
