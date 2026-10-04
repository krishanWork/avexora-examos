import test from "node:test";
import assert from "node:assert/strict";
import { REASONS } from "../lib/domainVerifier.js";
import { makeVerifier, indexResponse, healthResponse, examosFetch, hangingFetch, tlsFailureFetch, OTHER_APP_HTML } from "./helpers.mjs";

test("valid EXAM OS serves static bundle + backend marker -> live", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"], "examos.avexora.in": ["64.29.17.1"] } },
    fetch: examosFetch(),
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, true);
  assert.equal(r.reason, null);
});

test("HTTP 200 but a different React app (no identity marker) -> APP_IDENTITY_FAILED", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: examosFetch({ "https://exam.school.edu/": indexResponse(OTHER_APP_HTML) }),
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.APP_IDENTITY_FAILED);
});

test("static bundle valid but backend health returns a different app -> APP_IDENTITY_FAILED", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: examosFetch({ "https://exam.school.edu/api/health": healthResponse("other-react-app") }),
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.APP_IDENTITY_FAILED);
});

test("static bundle valid but backend health is missing -> APP_IDENTITY_FAILED", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: examosFetch({ "https://exam.school.edu/api/health": indexResponse("<!doctype html>", 404) }),
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.APP_IDENTITY_FAILED);
});

test("HTTP 404 on the root -> APP_NOT_REACHABLE", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: examosFetch({ "https://exam.school.edu/": indexResponse("Not found", 404) }),
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.APP_NOT_REACHABLE);
});

test("TLS certificate failure -> TLS_FAILED", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: tlsFailureFetch(),
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.TLS_FAILED);
});

test("request timeout -> APP_NOT_REACHABLE", async () => {
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: hangingFetch(),
    timeoutMs: 20,
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.APP_NOT_REACHABLE);
});

test("redirect to a public www sibling is followed and can verify", async () => {
  const fetchImpl = (url) => {
    const u = String(url);
    if (u.endsWith("/api/health")) return Promise.resolve(healthResponse());
    if (u === "https://exam.school.edu/") {
      return Promise.resolve(
        new Response(null, {
          status: 301,
          headers: { location: "https://www.exam.school.edu/" },
        })
      );
    }
    return Promise.resolve(indexResponse());
  };
  const v = makeVerifier({
    records: {
      a: { "exam.school.edu": ["64.29.17.1"], "www.exam.school.edu": ["64.29.17.1"] },
    },
    fetch: fetchImpl,
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, true);
});

test("redirect to a private address -> SSRF_BLOCKED", async () => {
  const fetchImpl = (url) => {
    if (String(url) === "https://exam.school.edu/") {
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: "https://192.168.1.1/" } })
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  const v = makeVerifier({
    records: {
      a: { "exam.school.edu": ["64.29.17.1"], "192.168.1.1": ["192.168.1.1"] },
    },
    fetch: fetchImpl,
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.SSRF_BLOCKED);
});

test("hostname pointing only at a private address -> SSRF_BLOCKED", async () => {
  const v = makeVerifier({
    records: { a: { "internal.school.edu": ["127.0.0.1"] } },
    fetch: examosFetch(),
  });
  const r = await v.probeDomain("internal.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.SSRF_BLOCKED);
});

test("redirect chain longer than the limit -> APP_NOT_REACHABLE", async () => {
  const fetchImpl = (url) => {
    if (String(url).startsWith("https://exam.school.edu/") && !String(url).includes("/api/health")) {
      return Promise.resolve(
        new Response(null, { status: 301, headers: { location: "https://exam.school.edu/again" } })
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  const v = makeVerifier({
    records: { a: { "exam.school.edu": ["64.29.17.1"] } },
    fetch: fetchImpl,
    maxRedirects: 2,
  });
  const r = await v.probeDomain("exam.school.edu");
  assert.equal(r.live, false);
  assert.equal(r.reason, REASONS.APP_NOT_REACHABLE);
});