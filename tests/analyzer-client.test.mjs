import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../frontend/script/analyzer-client.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window, URL, AbortController, DOMException, setTimeout, clearTimeout });
const { createClient, normalizeRepositoryUrl } = window.CodeTrackerAnalyzer;
const response = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  async text() { return JSON.stringify(body); }
});
const client = (fetchImplementation, options = {}) => createClient({
  baseUrl: "https://analyzer.example", pollIntervalMs: 0, maxAttempts: 4,
  fetchImplementation, ...options
});

test("repository URLs reject lookalike domains and normalize .git", () => {
  assert.equal(normalizeRepositoryUrl("https://github.com/Qycx1/codetracker.git"), "https://github.com/Qycx1/codetracker");
  for (const value of ["https://github.com.evil.example/a/b", "https://evilgithub.com/a/b", "https://user@github.com/a/b", "http://github.com/a/b", "https://github.com/a", "https://github.com/a/b/tree/main"]) {
    assert.throws(() => normalizeRepositoryUrl(value));
  }
});

test("analysis start preserves the existing service JSON contract", async () => {
  const api = client(async (url, options) => {
    assert.equal(url, "https://analyzer.example/api/analyze");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { repo_url: "https://github.com/Qycx1/codetracker" });
    return response(200, { success: true, analysis_id: "job-1" });
  });
  assert.equal((await api.startAnalysis("https://github.com/Qycx1/codetracker.git")).analysis_id, "job-1");
});

test("polling never overlaps slow requests", async () => {
  let calls = 0, inFlight = 0, maximum = 0;
  const api = client(async () => {
    inFlight++;
    maximum = Math.max(maximum, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 4));
    inFlight--;
    calls++;
    return response(200, { success: true, status: calls < 3 ? "processing" : "completed", files: [] });
  });
  assert.equal((await api.pollAnalysis("job-1")).status, "completed");
  assert.equal(calls, 3);
  assert.equal(maximum, 1);
});

test("repeated connection failures count toward the polling limit", async () => {
  let calls = 0;
  const api = client(async () => { calls++; throw new TypeError("Network failed"); }, { maxAttempts: 3 });
  await assert.rejects(api.pollAnalysis("job-1"), /timed out/);
  assert.equal(calls, 3);
});

test("a removed Railway application fails immediately instead of being treated as an expired job", async () => {
  let calls = 0;
  const api = client(async () => { calls++; return response(404, { message: "Application not found" }); });
  await assert.rejects(api.pollAnalysis("old-job"), (error) => error.status === 404 && !error.missingAnalysis && !error.retryable);
  assert.equal(calls, 1);
});

test("an expired saved job is distinguishable from a missing deployment", async () => {
  const api = client(async () => response(404, { error: "Analysis not found" }));
  await assert.rejects(api.pollAnalysis("old-job"), (error) => error.missingAnalysis === true);
});

test("service-reported failure is never displayed as a successful clean analysis", async () => {
  const api = client(async () => response(200, { success: false, status: "error", error: "Clone failed" }));
  await assert.rejects(api.pollAnalysis("job-1"), /Clone failed/);
});

test("invalid JSON fails with a useful error", async () => {
  const api = client(async () => ({ status: 200, ok: true, async text() { return "<html>wrong service</html>"; } }));
  await assert.rejects(api.pollAnalysis("job-1"), /unreadable response/);
});

test("request timeout aborts the network request", async () => {
  let aborted = false;
  const api = client((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
  }), { requestTimeoutMs: 5 });
  await assert.rejects(api.startAnalysis("https://github.com/a/b"), (error) => error.retryable && /too long/.test(error.message));
  assert.equal(aborted, true);
});

test("leaving the page cancels polling instead of starting another request", async () => {
  const abortController = new AbortController();
  let calls = 0;
  const api = client(async () => {
    calls++;
    return response(200, { success: true, status: "processing" });
  }, { pollIntervalMs: 100 });
  const pending = api.pollAnalysis("job-1", {
    signal: abortController.signal,
    onUpdate() { abortController.abort(); }
  });
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(calls, 1);
});

test("an unconfigured analyzer does not call the expired deployment", async () => {
  let calls = 0;
  const api = client(async () => { calls++; }, { baseUrl: "" });
  await assert.rejects(api.startAnalysis("https://github.com/a/b"), /unavailable/);
  assert.equal(calls, 0);
});
