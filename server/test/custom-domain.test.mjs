import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHost, validHostname, classifyHost, isPrivateIp } from "../../shared/custom-domain.js";

test("normalizeHost: canonical forms", () => {
  assert.equal(normalizeHost("EXAM.SCHOOL.EDU"), "exam.school.edu");
  assert.equal(normalizeHost("exam.school.edu."), "exam.school.edu");
  assert.equal(normalizeHost("https://exam.school.edu"), "exam.school.edu");
  assert.equal(normalizeHost("https://exam.school.edu/"), "exam.school.edu");
  assert.equal(normalizeHost("  exam.school.edu  "), "exam.school.edu");
  assert.equal(normalizeHost("HTTP://EXAM.SCHOOL.EDU./"), "exam.school.edu");
});

test("normalizeHost: rejects invalid input", () => {
  assert.equal(normalizeHost("exam.school.edu/path"), null);
  assert.equal(normalizeHost("exam.school.edu?x=1"), null);
  assert.equal(normalizeHost("exam.school.edu#top"), null);
  assert.equal(normalizeHost("exam.school.edu:8080"), null);
  assert.equal(normalizeHost("https://exam.school.edu:443/"), null);
  assert.equal(normalizeHost("*.school.edu"), null);
  assert.equal(normalizeHost("not a host"), null);
  assert.equal(normalizeHost("singlelabel"), null);
  assert.equal(normalizeHost(""), null);
  assert.equal(normalizeHost(null), null);
  assert.equal(normalizeHost(undefined), null);
  assert.equal(normalizeHost(42), null);
});

test("validHostname", () => {
  assert.equal(validHostname("exam.school.edu"), true);
  assert.equal(validHostname("a.bc"), true);
  assert.equal(validHostname("localhost"), false);
  assert.equal(validHostname("foo"), false);
  assert.equal(validHostname("exam school.edu"), false);
});

test("classifyHost", () => {
  const cfg = { platformDomains: ["avexora.in", "examos.avexora.in", "www.examos.avexora.in"], platformDomain: "avexora.in" };
  assert.equal(classifyHost("examos.avexora.in", cfg), "platform");
  assert.equal(classifyHost("ai.avexora.in", cfg), "portal-subdomain");
  assert.equal(classifyHost("lpu.edu", cfg), "apex");
  assert.equal(classifyHost("exam.school.edu", cfg), "subdomain");
  assert.equal(classifyHost("", cfg), "unknown");
});

test("isPrivateIp: private v4", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1", "100.64.0.1", "100.127.255.255", "0.0.0.0"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test("isPrivateIp: public v4", () => {
  for (const ip of ["8.8.8.8", "64.29.17.1", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.128.0.1", "255.255.255.255"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("isPrivateIp: private v6", () => {
  for (const ip of ["::1", "::", "0:0:0:0:0:0:0:1", "fe80::1", "fc00::1", "fd12::1234"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test("isPrivateIp: public v6", () => {
  for (const ip of ["2001:4860::8888", "2606:4700::1111", "fe00::1"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("isPrivateIp: garbage", () => {
  assert.equal(isPrivateIp("",), false);
  assert.equal(isPrivateIp("999.999.999.999"), false);
  assert.equal(isPrivateIp(null), false);
});