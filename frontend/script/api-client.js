
(function attachApiClient(globalScope) {
  "use strict";

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function resolveApiBaseUrl() {
    const fromWindow = globalScope.__CODETRACKER_API_BASE_URL || globalScope.__API_BASE_URL;
    const fromMeta = document.querySelector('meta[name="api-base-url"]')?.getAttribute("content");
    const chosen = fromWindow || fromMeta || globalScope.CodeTrackerConfig?.apiBaseUrl;
    if (!chosen) {
      throw new Error("Load runtime-config.js before api-client.js.");
    }
    return normalizeBaseUrl(chosen);
  }

  const API_BASE_URL = resolveApiBaseUrl();

  function getCookie(name) {
    if (!document.cookie) return null;

    const cookies = document.cookie.split(";");
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      const [cookieName, ...rest] = trimmed.split("=");

      if (cookieName === name) {
        const cookieValue = rest.join("=");
        try {
          return decodeURIComponent(cookieValue);
        } catch (_) {
          return cookieValue;
        }
      }
    }

    return null;
  }

  function getDeviceId() {
    const cookieDeviceId = getCookie("device_id");
    if (cookieDeviceId && cookieDeviceId.trim()) {
      return cookieDeviceId.trim();
    }

    // Fallback for environments where the device cookie may not be readable.
    const storageDeviceId = localStorage.getItem("device_id") || sessionStorage.getItem("device_id");
    if (storageDeviceId && storageDeviceId.trim()) {
      return storageDeviceId.trim();
    }

    console.error("Device ID missing; cannot refresh token.");
    return null;
  }

  async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  function extractErrorMessage(body, fallback) {
    if (!body) return fallback;
    if (typeof body === "string") return body;
    if (Array.isArray(body.errors) && body.errors.length) {
      return body.errors.join(" ");
    }
    return body.message || body.error || body.data?.message || body.data?.error || fallback;
  }

  let isRefreshing = false;
  let refreshPromise = null;
  let lastRefreshSucceededAt = 0;
  let refreshFailedUntil = 0;
  const REFRESH_COOLDOWN_MS = 10000;
  let authLockActive = false;
  let authLockPromptShown = false;
  let authLockOverlay = null;

  function isAuthEndpoint(path) {
    return String(path || "").startsWith("/auth/");
  }

  async function refreshToken() {
    if (isRefreshing && refreshPromise) {
      return refreshPromise;
    }
    if (Date.now() < refreshFailedUntil) return false;

    isRefreshing = true;

    refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json"
          }
        });

        const body = await parseResponseBody(response);

        if (!response.ok) {
          refreshFailedUntil = Date.now() + REFRESH_COOLDOWN_MS;
          console.error("Token refresh failed:", extractErrorMessage(body, `Refresh failed with status ${response.status}`));
          return false;
        }

        // A 200 refresh response does not prove the browser accepted the JWT
        // cookie. Verify it on the same API before announcing success.
        const checkResponse = await fetch(`${API_BASE_URL}/auth/check`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" }
        });
        const checkBody = await parseResponseBody(checkResponse);
        if (!checkResponse.ok || checkBody?.authenticated !== true) {
          refreshFailedUntil = Date.now() + REFRESH_COOLDOWN_MS;
          console.error("Refresh completed, but the session is still unauthenticated. Check JWT cookie settings, blocked cookies, and deployment consistency.");
          return false;
        }

        refreshFailedUntil = 0;
        lastRefreshSucceededAt = Date.now();
        console.log("JWT token refreshed successfully");
        return true;
      } catch (error) {
        refreshFailedUntil = Date.now() + REFRESH_COOLDOWN_MS;
        console.error("Refresh token error:", error);
        return false;
      } finally {
        isRefreshing = false;
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function request(path, options = {}, config = {}) {
    const {
      redirectOnUnauthorized = true,
      retryOnRefresh = true
    } = config;

    let retried = false;

    async function makeRequest() {
      const requestOptions = {
        ...options,
        credentials: "include"
      };

      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...requestOptions
      });

      const body = await parseResponseBody(response);
      return { response, body };
    }

    let { response, body } = await makeRequest();

    if (response.status === 401 && !retried && retryOnRefresh && !isAuthEndpoint(path)) {
      retried = true;

      // Another in-flight request may receive its old 401 just after a
      // shared refresh completes. Retry it with the new cookie without
      // launching a second refresh storm.
      if (Date.now() - lastRefreshSucceededAt < REFRESH_COOLDOWN_MS) {
        console.log(`Retrying ${path}; the session was refreshed recently.`);
        ({ response, body } = await makeRequest());
      } else {
        console.log(`Received 401 on ${path}, attempting token refresh`);
        const refreshed = await refreshToken();

        if (refreshed) {
          ({ response, body } = await makeRequest());
        }
      }
    }

    if (!response.ok) {
      if (redirectOnUnauthorized && response.status === 401) {
        if (!isOnLoginPage()) {
          await promptSessionExpired();
        }
        throw new Error("Authentication required");
      }

      const error = new Error(extractErrorMessage(body, `Server error: ${response.status}`));
      error.status = response.status;
      error.body = body;
      error.path = path;
      throw error;
    }

    return body;
  }

  function isOnLoginPage() {
    const path = window.location.pathname;
    const normalizedPath = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;

    return normalizedPath === "" ||
      normalizedPath === "/" ||
      normalizedPath === "/index.html" ||
      normalizedPath === "/onboarding";
  }

  function logoutAndRedirect() {
    try {
      localStorage.removeItem("userData");
      sessionStorage.clear();
      window.location.replace("/");
    } catch (_) {
      window.location.href = "/";
    }
  }

  function lockToReadOnlyState() {
    if (authLockActive) return;
    authLockActive = true;

    if (!authLockOverlay && document?.body) {
      const overlay = document.createElement("div");
      overlay.className = "ct-auth-lock-overlay";
      overlay.innerHTML = `
        <div class="ct-auth-lock-box" role="status" aria-live="polite">
          <h3>Session expired</h3>
          <p>You are now in read-only mode. Please log in again to continue using actions.</p>
        </div>
      `;
      document.body.appendChild(overlay);
      authLockOverlay = overlay;
    } else if (authLockOverlay) {
      authLockOverlay.hidden = false;
    }

    document.documentElement.classList.add("ct-auth-locked");
    document.body?.classList.add("ct-auth-locked");

    const lockPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    try {
      window.history.pushState({ ctAuthLocked: true }, "", lockPath);
      window.addEventListener("popstate", () => {
        if (!authLockActive) return;
        window.history.pushState({ ctAuthLocked: true }, "", lockPath);
      });
    } catch (_) {}
  }

  async function checkSessionState() {
    async function fetchAuthCheck() {
      const response = await fetch(`${API_BASE_URL}/auth/check`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      });

      const data = await parseResponseBody(response);
      return {
        response,
        data,
        authenticated: data?.authenticated === true,
        fullyInitialized: data?.fullyInitialized === true
      };
    }

    try {
      let checkResult = await fetchAuthCheck();

      // If /auth/check reports unauthenticated, force a token refresh once and retry /auth/check.
      if (!checkResult.authenticated) {
        const refreshed = await refreshToken();
        if (refreshed) {
          checkResult = await fetchAuthCheck();
        }
      }

      return {
        authenticated: checkResult.authenticated,
        fullyInitialized: checkResult.fullyInitialized,
        data: checkResult.data
      };
    } catch (error) {
      console.error("Auth check error:", error);
      return {
        authenticated: false,
        fullyInitialized: false,
        data: null
      };
    }
  }

  async function checkAuth() {
    const sessionState = await checkSessionState();
    return sessionState.authenticated;
  }

  async function checkAndRedirectIfAuthenticated() {
    try {
      const sessionState = await checkSessionState();
      if (sessionState.authenticated) {
        window.location.replace(sessionState.fullyInitialized ? "/dashboard/" : "/onboarding/");
      }
    } catch (error) {
      console.error("Auth check failed:", error);
    }
  }

  async function logout() {
    try {
      const deviceId = getDeviceId();

      localStorage.removeItem("userData");
      localStorage.removeItem("device_id");
      sessionStorage.clear();

      try {
        const logoutPath = deviceId
          ? `/auth/logout/${encodeURIComponent(deviceId)}`
          : "/auth/logout";

        await fetch(`${API_BASE_URL}${logoutPath}`, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json"
          }
        });
      } catch (_) {
      }

      logoutAndRedirect();
    } catch (_) {
      logoutAndRedirect();
    }
  }

  function createRegistrationFormData(payload, profileFile) {
    const formData = new FormData();
    formData.append(
      "data",
      new Blob([JSON.stringify(payload)], { type: "application/json" })
    );

    if (profileFile) {
      formData.append("profile", profileFile);
    }

    return formData;
  }

  function createAnnouncementFormData(payload, attachments = []) {
    const formData = new FormData();
    formData.append(
      "data",
      new Blob([JSON.stringify(payload)], { type: "application/json" })
    );

    // MultipartFile lists are represented by repeated parts with the same
    // field name. Array.from also supports the FileList returned by <input>.
    Array.from(attachments || []).forEach((file) => {
      formData.append("attachments", file);
    });

    return formData;
  }

  function createAnnouncementEditFormData(payload = {}, newAttachments = [], attachmentIdsToRemove = []) {
    const formData = new FormData();

    if (payload && typeof payload === "object" && Object.keys(payload).length) {
      Object.entries(payload).forEach(([key, value]) => {
        if (value == null) return;
        formData.append(key, String(value));
      });
    }

    Array.from(newAttachments || []).forEach((file) => {
      formData.append("newAttachments", file);
    });

    Array.from(attachmentIdsToRemove || []).forEach((attachmentId) => {
      if (!attachmentId) return;
      formData.append("attachmentIdsToRemove", attachmentId);
    });

    return formData;
  }

  const dialogState = {
    queue: Promise.resolve(),
    mounted: false,
    overlay: null,
    title: null,
    message: null,
    cancelBtn: null,
    confirmBtn: null
  };

  function mountDialog() {
    if (dialogState.mounted || !document?.body) return;

    const style = document.createElement("style");
    style.id = "ct-dialog-style";
    style.textContent = `
      .ct-dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(1, 4, 9, 0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 9999;
      }
      .ct-dialog-overlay[hidden] {
        display: none;
      }
      .ct-dialog-box {
        width: min(480px, 100%);
        background: #161b22;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
        border: 1px solid #30363d;
        padding: 18px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      }
      .ct-dialog-title {
        margin: 0 0 10px;
        color: #e6edf3;
        font-size: 18px;
        line-height: 1.3;
      }
      .ct-dialog-message {
        margin: 0;
        color: #8b949e;
        font-size: 14px;
        line-height: 1.55;
        white-space: pre-line;
      }
      .ct-dialog-actions {
        margin-top: 18px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .ct-dialog-btn {
        border: 1px solid #30363d;
        border-radius: 8px;
        padding: 9px 14px;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
      }
      .ct-dialog-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .ct-dialog-btn-cancel {
        background: #21262d;
        color: #c9d1d9;
      }
      .ct-dialog-btn-cancel:hover {
        background: #30363d;
        border-color: #484f58;
      }
      .ct-dialog-btn-confirm {
        background: #1f6feb;
        border-color: #1f6feb;
        color: #ffffff;
      }
      .ct-dialog-btn-confirm:hover {
        background: #388bfd;
        border-color: #388bfd;
      }
      .ct-dialog-btn-confirm.ct-danger {
        background: #da3633;
        border-color: #da3633;
      }
      .ct-dialog-btn-confirm.ct-danger:hover {
        background: #f85149;
        border-color: #f85149;
      }
      .ct-auth-locked {
        overflow: hidden !important;
      }
      .ct-auth-lock-overlay {
        position: fixed;
        inset: 0;
        z-index: 10001;
        background: rgba(1, 4, 9, 0.82);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .ct-auth-lock-box {
        width: min(560px, 100%);
        border-radius: 12px;
        border: 1px solid #30363d;
        background: #0d1117;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.45);
        padding: 20px;
      }
      .ct-auth-lock-box h3 {
        margin: 0 0 8px;
        color: #e6edf3;
        font-size: 18px;
      }
      .ct-auth-lock-box p {
        margin: 0;
        color: #8b949e;
        line-height: 1.5;
      }
    `;

    const overlay = document.createElement("div");
    overlay.className = "ct-dialog-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ct-dialog-box" role="dialog" aria-modal="true" aria-live="polite">
        <h3 class="ct-dialog-title"></h3>
        <p class="ct-dialog-message"></p>
        <div class="ct-dialog-actions">
          <button type="button" class="ct-dialog-btn ct-dialog-btn-cancel">Cancel</button>
          <button type="button" class="ct-dialog-btn ct-dialog-btn-confirm">OK</button>
        </div>
      </div>
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    dialogState.overlay = overlay;
    dialogState.title = overlay.querySelector(".ct-dialog-title");
    dialogState.message = overlay.querySelector(".ct-dialog-message");
    dialogState.cancelBtn = overlay.querySelector(".ct-dialog-btn-cancel");
    dialogState.confirmBtn = overlay.querySelector(".ct-dialog-btn-confirm");
    dialogState.mounted = true;
  }

  function queueDialog(task) {
    dialogState.queue = dialogState.queue.then(task, task);
    return dialogState.queue;
  }

  function openDialog({ title, message, confirmText, cancelText, mode, danger }) {
    return queueDialog(() => new Promise((resolve) => {
      mountDialog();
      if (!dialogState.mounted) {
        resolve(mode === "confirm" ? false : undefined);
        return;
      }

      const { overlay, title: titleEl, message: messageEl, cancelBtn, confirmBtn } = dialogState;
      titleEl.textContent = title;
      messageEl.textContent = message;
      cancelBtn.textContent = cancelText;
      confirmBtn.textContent = confirmText;
      cancelBtn.hidden = mode !== "confirm";
      confirmBtn.classList.toggle("ct-danger", Boolean(danger));
      overlay.hidden = false;

      const activeBefore = document.activeElement;

      const close = (result) => {
        overlay.hidden = true;
        overlay.removeEventListener("click", onOverlayClick);
        document.removeEventListener("keydown", onKeyDown);
        cancelBtn.removeEventListener("click", onCancel);
        confirmBtn.removeEventListener("click", onConfirm);
        if (activeBefore && typeof activeBefore.focus === "function") {
          activeBefore.focus();
        }
        resolve(result);
      };

      const onConfirm = () => close(mode === "confirm" ? true : undefined);
      const onCancel = () => close(false);
      const onOverlayClick = (event) => {
        if (event.target === overlay) {
          close(mode === "confirm" ? false : undefined);
        }
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(mode === "confirm" ? false : undefined);
        }
      };

      overlay.addEventListener("click", onOverlayClick);
      document.addEventListener("keydown", onKeyDown);
      cancelBtn.addEventListener("click", onCancel);
      confirmBtn.addEventListener("click", onConfirm);
      confirmBtn.focus();
    }));
  }

  const dialog = {
    alert(message, options = {}) {
      return openDialog({
        mode: "alert",
        title: options.title || "Notice",
        message: String(message || ""),
        confirmText: options.confirmText || "OK",
        cancelText: "Cancel",
        danger: options.danger
      });
    },

    confirm(message, options = {}) {
      return openDialog({
        mode: "confirm",
        title: options.title || "Confirm",
        message: String(message || ""),
        confirmText: options.confirmText || "Confirm",
        cancelText: options.cancelText || "Cancel",
        danger: options.danger
      });
    }
  };

  async function promptSessionExpired() {
    if (authLockPromptShown) return;
    authLockPromptShown = true;

    await dialog.alert(
      "Your session has expired and can no longer be refreshed.\n\nPress the button below to continue to login.",
      {
        title: "Session expired",
        confirmText: "Go to login",
        danger: true
      }
    );

    logoutAndRedirect();
  }

  const user = {
    register(payload, profileFile) {
      return request("/users/register", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: createRegistrationFormData(payload, profileFile)
      }, { retryOnRefresh: false });
    },

    getProfile() {
      return request("/users/profile", { method: "GET" });
    },

    updateProfile(payload) {
      return request("/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    },

    updateProfilePicture(file) {
      const formData = new FormData();
      formData.append("file", file);
      return request("/users/profile/update", {
        method: "PATCH",
        body: formData
      });
    },

    removeProfilePicture() {
      return request("/users/profile/remove", { method: "DELETE" });
    }
  };

  const classroom = {
    createAnnouncement(classroomId, payload, attachments = []) {
      const formData = createAnnouncementFormData(payload, attachments);
      return request(`/classroom/${encodeURIComponent(classroomId)}/announcement`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData
      });
    },

    listAnnouncements(classroomId) {
      return request(`/classroom/${encodeURIComponent(classroomId)}/announcement`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
    },

    editAnnouncement(classroomId, announcementId, payload = {}, newAttachments = [], attachmentIdsToRemove = []) {
      const formData = createAnnouncementEditFormData(payload, newAttachments, attachmentIdsToRemove);
      return request(`/classroom/${encodeURIComponent(classroomId)}/announcement/${encodeURIComponent(announcementId)}`, {
        method: "PATCH",
        headers: { Accept: "application/json" },
        body: formData
      });
    },

    deleteAnnouncement(classroomId, announcementId) {
      return request(`/classroom/${encodeURIComponent(classroomId)}/announcement/${encodeURIComponent(announcementId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" }
      });
    }
  };

  globalScope.ApiClient = {
    request,
    baseUrl: API_BASE_URL,
    user,
    classroom,
    checkAuth,
    checkAndRedirectIfAuthenticated,
    logout,
    getDeviceId,
    refreshToken,
    checkSessionState,
    _getCookie: getCookie
  };

  globalScope.AppDialog = dialog;
})(window);
