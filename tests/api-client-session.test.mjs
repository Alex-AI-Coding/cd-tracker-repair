import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const apiClientSource = readFileSync(
  new URL("../frontend/script/api-client.js", import.meta.url),
  "utf8"
);
const runtimeConfigSource = readFileSync(new URL("../frontend/script/runtime-config.js", import.meta.url), "utf8");

function jsonResponse(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body == null ? "" : JSON.stringify(body);
    }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

function loadApiClient(fetchImplementation) {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const document = {
    cookie: "",
    querySelector() {
      return null;
    }
  };
  const window = {
    location: {
      pathname: "/dashboard/",
      href: "",
      replace() {}
    }
  };

  const context = {
    window,
    document,
    localStorage,
    sessionStorage,
    fetch: fetchImplementation,
    FormData,
    Blob,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console: { log() {}, error() {} }
  };

  vm.runInNewContext(runtimeConfigSource, context);
  vm.runInNewContext(apiClientSource, context, {
    filename: "api-client.js"
  });
  return window.ApiClient;
}

test("concurrent 401 responses share one refresh and all retry", async () => {
  let refreshCalls = 0;
  const endpointCalls = new Map();
  const client = loadApiClient(async (url) => {
    if (url.endsWith("/auth/check")) return jsonResponse(200, { authenticated: true });
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse(200, { refreshed: true });
    }

    const count = (endpointCalls.get(url) || 0) + 1;
    endpointCalls.set(url, count);
    return count === 1
      ? jsonResponse(401, { message: "Expired access token" })
      : jsonResponse(200, { url });
  });

  const paths = ["/activity/a", "/activity/b", "/classroom/c"];
  const results = await Promise.all(
    paths.map((path) => client.request(path, {}, {
      redirectOnUnauthorized: false,
      retryOnRefresh: true
    }))
  );

  assert.equal(refreshCalls, 1);
  assert.equal(results.length, 3);
  for (const calls of endpointCalls.values()) {
    assert.equal(calls, 2);
  }
});

test("a 401 arriving just after refresh is retried without a refresh storm", async () => {
  let refreshCalls = 0;
  const endpointCalls = new Map();
  const client = loadApiClient(async (url) => {
    if (url.endsWith("/auth/check")) return jsonResponse(200, { authenticated: true });
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      return jsonResponse(200, { refreshed: true });
    }

    const count = (endpointCalls.get(url) || 0) + 1;
    endpointCalls.set(url, count);
    return count === 1
      ? jsonResponse(401, { message: "Expired access token" })
      : jsonResponse(200, { ok: true });
  });

  await client.request("/first", {}, {
    redirectOnUnauthorized: false,
    retryOnRefresh: true
  });
  await client.request("/second", {}, {
    redirectOnUnauthorized: false,
    retryOnRefresh: true
  });

  assert.equal(refreshCalls, 1);
  assert.equal(endpointCalls.get(`${client.baseUrl}/first`), 2);
  assert.equal(endpointCalls.get(`${client.baseUrl}/second`), 2);
});

test("403 permission errors never trigger token refresh", async () => {
  let refreshCalls = 0;
  const client = loadApiClient(async (url) => {
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      return jsonResponse(200);
    }
    return jsonResponse(403, { message: "Not allowed" });
  });

  await assert.rejects(
    client.request("/activity/private", {}, {
      redirectOnUnauthorized: false,
      retryOnRefresh: true
    }),
    /Not allowed/
  );
  assert.equal(refreshCalls, 0);
});

test("HTTP 200 refresh is rejected when the browser still has no authenticated session", async () => {
  let refreshCalls = 0;
  let protectedCalls = 0;
  const client = loadApiClient(async (url, options) => {
    assert.equal(options.credentials, "include");
    if (url.endsWith("/auth/refresh")) {
      refreshCalls++;
      return jsonResponse(200, { refreshed: true });
    }
    if (url.endsWith("/auth/check")) {
      assert.equal(options.cache, "no-store");
      return jsonResponse(200, { authenticated: false });
    }
    protectedCalls++;
    return jsonResponse(401);
  });
  await assert.rejects(client.request("/users/profile", {}, { redirectOnUnauthorized: false }),
    (error) => error.status === 401);
  assert.equal(refreshCalls, 1);
  assert.equal(protectedCalls, 1, "Do not retry protected requests with a rejected cookie");
  assert.equal(await client.refreshToken(), false);
  assert.equal(refreshCalls, 1, "A failed refresh must not start a refresh storm");
});

test("API errors retain their HTTP status for feature compatibility handling", async () => {
  const client = loadApiClient(async () => jsonResponse(404, { message: "Unknown endpoint" }));
  await assert.rejects(client.request("/missing", {}, { redirectOnUnauthorized: false }),
    (error) => error.status === 404 && error.path === "/missing" && error.body.message === "Unknown endpoint");
});

test("public auth routes never refresh recursively", async () => {
  let calls = 0;
  const client = loadApiClient(async () => { calls++; return jsonResponse(401); });
  await assert.rejects(client.request("/auth/check", {}, { redirectOnUnauthorized: false }));
  assert.equal(calls, 1);
});
