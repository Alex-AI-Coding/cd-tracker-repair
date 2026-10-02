// GitHub OAuth Configuration

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function readApiBaseUrl() {
  const fromClient = window.ApiClient?.baseUrl;
  const fromWindow = window.__CODETRACKER_API_BASE_URL || window.__API_BASE_URL;
  const fromMeta = document.querySelector('meta[name="api-base-url"]')?.getAttribute("content");

  return normalizeBaseUrl(fromClient || fromWindow || fromMeta || window.CodeTrackerConfig?.apiBaseUrl);
}

const BACKEND_URL = `${readApiBaseUrl()}/oauth`;

function clearOAuthQueryParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("oauth");
  url.searchParams.delete("success");
  url.searchParams.delete("registered");
  url.searchParams.delete("error");
  window.history.replaceState({}, document.title, url.toString());
}

function parseBooleanParam(value) {
  if (typeof value !== "string") return null;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return null;
}

async function redirectAuthenticatedSession() {
  if (!window.ApiClient?.checkSessionState) return false;

  const sessionState = await window.ApiClient.checkSessionState();
  if (!sessionState.authenticated) return false;

  window.location.replace(sessionState.fullyInitialized ? "/dashboard/" : "/onboarding/");
  return true;
}

async function handleOAuthCallbackRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("oauth") !== "github") return false;

  const success = parseBooleanParam(params.get("success"));
  const alreadyRegistered = parseBooleanParam(params.get("registered"));
  const error = params.get("error");

  if (success === true) {
    clearOAuthQueryParamsFromUrl();

    if (alreadyRegistered === true) {
      window.location.replace("/dashboard/");
      return true;
    }

    if (alreadyRegistered === false) {
      window.location.replace("/onboarding/");
      return true;
    }

    await redirectAuthenticatedSession();
    return true;
  }

  if (success === false) {
    const message = (typeof error === "string" && error.trim())
      ? error.trim()
      : "GitHub sign in failed. Please try again.";
    clearOAuthQueryParamsFromUrl();
    console.warn("GitHub OAuth sign-in failed:", message);
    return true;
  }

  return false;
}

// Check if user is already authenticated on page load.
document.addEventListener("DOMContentLoaded", async () => {
  if (await handleOAuthCallbackRedirect()) {
    return;
  }

  if (!window.ApiClient) return;

  try {
    // Backend cookies cannot be read from a frontend on another origin.
    // Let the backend check and refresh them through credentialed requests.
    await redirectAuthenticatedSession();
  } catch (error) {
    console.warn("Auto-redirect check failed:", error);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const githubBtn = document.getElementById("githubLogin");
  if (githubBtn) {
    githubBtn.addEventListener("click", () => {
      console.log("GitHub login clicked");

      githubBtn.disabled = true;
      window.location.assign(`${BACKEND_URL}/github/authorize`);
    });
  }

  const note = document.getElementById("platformNote");
  const noteToggle = document.getElementById("platformNoteToggle");
  const noteBody = document.getElementById("platformNoteBody");

  if (!note || !noteToggle || !noteBody) return;

  noteBody.style.maxHeight = "0px";

  noteToggle.addEventListener("click", () => {
    const isExpanded = note.getAttribute("data-expanded") === "true";

    if (isExpanded) {
      noteBody.style.maxHeight = `${noteBody.scrollHeight}px`;
      requestAnimationFrame(() => {
        note.setAttribute("data-expanded", "false");
        noteToggle.setAttribute("aria-expanded", "false");
        noteBody.setAttribute("aria-hidden", "true");
        noteBody.style.maxHeight = "0px";
      });
      return;
    }

    note.setAttribute("data-expanded", "true");
    noteToggle.setAttribute("aria-expanded", "true");
    noteBody.setAttribute("aria-hidden", "false");
    noteBody.style.maxHeight = `${noteBody.scrollHeight}px`;
  });

  noteBody.addEventListener("transitionend", (event) => {
    if (event.propertyName !== "max-height") return;
    const isExpanded = note.getAttribute("data-expanded") === "true";
    if (isExpanded) {
      noteBody.style.maxHeight = "none";
    }
  });
});
