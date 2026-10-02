(function attachAnalyzerClient(globalScope) {
  "use strict";

  class AnalyzerError extends Error {
    constructor(message, { status = 0, retryable = false, missingAnalysis = false } = {}) {
      super(message);
      this.name = "AnalyzerError";
      Object.assign(this, { status, retryable, missingAnalysis });
    }
  }

  function normalizeRepositoryUrl(value) {
    const url = new URL(String(value || "").trim());
    const parts = url.pathname.split("/").filter(Boolean);
    const repository = (parts[1] || "").replace(/\.git$/i, "");
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port
        || url.username || url.password || parts.length !== 2
        || !/^[a-z\d-]+$/i.test(parts[0])
        || !/^[a-z\d_.-]+$/i.test(repository) || /^\.{1,2}$/.test(repository)) {
      throw new AnalyzerError("Use a GitHub repository URL such as https://github.com/owner/repository.");
    }
    return `https://github.com/${parts[0]}/${repository}`;
  }

  function createClient({
    baseUrl = globalScope.CodeTrackerConfig?.analyzerBaseUrl || "",
    fetchImplementation = (...args) => globalScope.fetch(...args),
    requestTimeoutMs = 15000,
    pollIntervalMs = 2000,
    maxAttempts = 120,
    maxDurationMs = 240000
  } = {}) {
    const endpoint = String(baseUrl).trim().replace(/\/+$/, "");

    async function request(path, options = {}, signal) {
      if (!endpoint) {
        throw new AnalyzerError("The code analyzer is currently unavailable. Please contact your instructor.");
      }
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => { timedOut = true; abort(); }, requestTimeoutMs);
      try {
        const response = await fetchImplementation(`${endpoint}${path}`, {
          ...options,
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json", ...options.headers }
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch (_) {
          throw new AnalyzerError("The code analyzer returned an unreadable response.", {
            status: response.status, retryable: response.status >= 500
          });
        }
        if (!response.ok) {
          const serviceMissing = data?.message === "Application not found";
          const missingAnalysis = response.status === 404 && !serviceMissing && path.startsWith("/api/analysis/");
          throw new AnalyzerError(serviceMissing
            ? "The code analyzer is currently unavailable. Please contact your instructor."
            : (data?.error || data?.message || `Code analysis request failed (${response.status}).`), {
              status: response.status,
              retryable: response.status >= 500 || [408, 429].includes(response.status),
              missingAnalysis
            });
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new AnalyzerError("The code analyzer returned an invalid response.");
        }
        return data;
      } catch (error) {
        if (signal?.aborted) throw new DOMException("Analysis cancelled.", "AbortError");
        if (error instanceof AnalyzerError) throw error;
        throw new AnalyzerError(timedOut
          ? "The code analyzer took too long to respond."
          : "Could not connect to the code analyzer. Please try again later.", { retryable: true });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }

    function wait(signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException("Analysis cancelled.", "AbortError")); return; }
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          reject(new DOMException("Analysis cancelled.", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, pollIntervalMs);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }

    async function startAnalysis(repoUrl, { signal } = {}) {
      const result = await request("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: normalizeRepositoryUrl(repoUrl) })
      }, signal);
      if (result.success !== true || !result.analysis_id) {
        throw new AnalyzerError(result.error || "The code analyzer could not start this review.");
      }
      return result;
    }

    async function getAnalysis(id, { signal } = {}) {
      if (!id) throw new AnalyzerError("No analysis was selected.");
      return request(`/api/analysis/${encodeURIComponent(id)}`, {}, signal);
    }

    async function pollAnalysis(id, { signal, onUpdate } = {}) {
      const startedAt = Date.now();
      for (let attempt = 0; attempt < maxAttempts && Date.now() - startedAt < maxDurationMs; attempt++) {
        let data;
        try { data = await getAnalysis(id, { signal }); } catch (error) {
          if (!error.retryable) throw error;
        }
        if (data) {
          const status = String(data.status || "").toLowerCase();
          if (["error", "failed"].includes(status) || data.success === false) {
            throw new AnalyzerError(data.error || "Code analysis failed.");
          }
          if (status === "completed") return data;
          onUpdate?.(data);
        }
        // Sequential polling prevents overlapping requests. Failed requests
        // count toward the limit too, so an outage cannot poll forever.
        if (attempt + 1 < maxAttempts && Date.now() - startedAt < maxDurationMs) await wait(signal);
      }
      throw new AnalyzerError("Code analysis timed out. Please return to the class and start a new review.");
    }

    return Object.freeze({ startAnalysis, getAnalysis, pollAnalysis });
  }

  globalScope.CodeTrackerAnalyzer = Object.freeze({ createClient, normalizeRepositoryUrl });
})(window);
