(() => {
  "use strict";

  const STORAGE_KEY = "codetracker-theme";
  const LEGACY_STORAGE_KEY = "codetracker-theme-preference";
  const PREFERENCES_ENDPOINT = "/users/preferences/theme";

  const ALLOWED_PREFERENCES = new Set([
    "system",
    "light",
    "dark"
  ]);

  const root = document.documentElement;

  const systemThemeQuery = window.matchMedia(
    "(prefers-color-scheme: light)"
  );

  let currentPreference = readSavedPreference();
  let backendPreferenceSupported = null;
  let preferenceRevision = 0;
  let accountSaveQueue = Promise.resolve();

  /**
   * The public login page always uses CodeTracker's original dark design.
   * Theme controls are only displayed inside the application.
   */
  function isLoginPage() {
    const path = window.location.pathname.toLowerCase();

    const isRootPage =
      path === "/" ||
      path === "/index.html";

    return isRootPage;
  }

  /**
   * Keep the public login page dark and remove any theme controls.
   */
  function keepLoginPageDark() {
    document
      .querySelectorAll("#themeControl, #themeToggle")
      .forEach((element) => element.remove());

    root.dataset.theme = "dark";
    root.dataset.themePreference = "dark";
    root.style.colorScheme = "dark";
  }

  /**
   * Safely read from localStorage.
   */
  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  /**
   * Safely write to localStorage.
   */
  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // The theme still works for the current visit if storage is blocked.
    }
  }

  /**
   * Only allow valid theme preference values.
   */
  function normalizePreference(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();

    return ALLOWED_PREFERENCES.has(normalized)
      ? normalized
      : null;
  }

  /**
   * Read the user's previously selected theme.
   */
  function readSavedPreference() {
    return (
      normalizePreference(safeGet(STORAGE_KEY)) ||
      normalizePreference(safeGet(LEGACY_STORAGE_KEY)) ||
      "system"
    );
  }

  /**
   * Save the selected theme locally.
   */
  function savePreference(preference) {
    safeSet(STORAGE_KEY, preference);

    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      // Ignore storage cleanup failures.
    }
  }

  /**
   * Convert "system" into the device's current light or dark theme.
   */
  function resolveTheme(preference = currentPreference) {
    if (preference === "light" || preference === "dark") {
      return preference;
    }

    return systemThemeQuery.matches
      ? "light"
      : "dark";
  }

  /**
   * Apply a theme to the current page.
   */
  function applyTheme(
    preference,
    {
      persist = false,
      sync = false
    } = {}
  ) {
    const safePreference =
      normalizePreference(preference) || "system";

    currentPreference = safePreference;

    const resolvedTheme = resolveTheme(safePreference);

    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = safePreference;
    root.style.colorScheme = resolvedTheme;

    if (persist) {
      savePreference(safePreference);
    }

    updateThemeControl();

    document.dispatchEvent(
      new CustomEvent("codetracker:themechange", {
        detail: {
          preference: safePreference,
          theme: resolvedTheme
        }
      })
    );

    if (sync) {
      preferenceRevision += 1;
      void savePreferenceToAccount(safePreference);
    }
  }

  /**
   * Remove the old bottom-right light/dark button.
   *
   * The newer theme menu contains its own button with the same ID,
   * so only buttons outside #themeControl are removed.
   */
  function removeLegacyThemeToggles() {
    document
      .querySelectorAll("#themeToggle")
      .forEach((toggle) => {
        if (!toggle.closest("#themeControl")) {
          toggle.remove();
        }
      });
  }

  /**
   * Create the single shared theme menu.
   */
  function createThemeControl() {
    const existing =
      document.getElementById("themeControl");

    if (existing) {
      return existing;
    }

    removeLegacyThemeToggles();

    const control = document.createElement("div");

    control.id = "themeControl";
    control.className = "theme-control";

    control.innerHTML = `
      <button
        id="themeToggle"
        class="theme-toggle"
        type="button"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="themeMenu"
      >
        <span
          class="theme-toggle__icon"
          id="themeToggleIcon"
          aria-hidden="true"
        ></span>

        <span id="themeToggleText">
          Theme
        </span>

        <i
          class="fas fa-chevron-up theme-toggle__chevron"
          aria-hidden="true"
        ></i>
      </button>

      <div
        id="themeMenu"
        class="theme-menu"
        role="menu"
        aria-label="Choose theme"
        hidden
      >
        <button
          type="button"
          role="menuitemradio"
          data-theme-choice="system"
        >
          <i
            class="fas fa-desktop"
            aria-hidden="true"
          ></i>

          <span>
            <strong>System</strong>
            <small>Match this device</small>
          </span>

          <i
            class="fas fa-check theme-menu__check"
            aria-hidden="true"
          ></i>
        </button>

        <button
          type="button"
          role="menuitemradio"
          data-theme-choice="light"
        >
          <i
            class="fas fa-sun"
            aria-hidden="true"
          ></i>

          <span>
            <strong>Light</strong>
            <small>Bright background</small>
          </span>

          <i
            class="fas fa-check theme-menu__check"
            aria-hidden="true"
          ></i>
        </button>

        <button
          type="button"
          role="menuitemradio"
          data-theme-choice="dark"
        >
          <i
            class="fas fa-moon"
            aria-hidden="true"
          ></i>

          <span>
            <strong>Dark</strong>
            <small>Dim background</small>
          </span>

          <i
            class="fas fa-check theme-menu__check"
            aria-hidden="true"
          ></i>
        </button>
      </div>
    `;

    document.body.appendChild(control);

    return control;
  }

  /**
   * Update the theme menu text, icon, and selected option.
   */
  function updateThemeControl() {
    const toggle =
      document.getElementById("themeToggle");

    const icon =
      document.getElementById("themeToggleIcon");

    const text =
      document.getElementById("themeToggleText");

    if (!toggle || !icon || !text) {
      return;
    }

    const resolvedTheme =
      resolveTheme(currentPreference);

    const label =
      currentPreference === "system"
        ? `System (${resolvedTheme})`
        : currentPreference.charAt(0).toUpperCase() +
          currentPreference.slice(1);

    text.textContent = label;

    toggle.setAttribute(
      "aria-label",
      `Theme: ${label}. Open theme choices.`
    );

    toggle.title = `Theme: ${label}`;

    icon.className = "theme-toggle__icon fas";

    if (currentPreference === "system") {
      icon.classList.add("fa-desktop");
    } else if (resolvedTheme === "light") {
      icon.classList.add("fa-sun");
    } else {
      icon.classList.add("fa-moon");
    }

    document
      .querySelectorAll("[data-theme-choice]")
      .forEach((button) => {
        const selected =
          button.dataset.themeChoice ===
          currentPreference;

        button.setAttribute(
          "aria-checked",
          String(selected)
        );

        button.classList.toggle(
          "is-selected",
          selected
        );
      });
  }

  /**
   * Close the theme choices menu.
   */
  function closeThemeMenu({
    restoreFocus = false
  } = {}) {
    const menu =
      document.getElementById("themeMenu");

    const toggle =
      document.getElementById("themeToggle");

    if (!menu || !toggle) {
      return;
    }

    menu.hidden = true;

    toggle.setAttribute(
      "aria-expanded",
      "false"
    );

    if (restoreFocus) {
      toggle.focus();
    }
  }

  /**
   * Open the theme choices menu.
   */
  function openThemeMenu() {
    const menu =
      document.getElementById("themeMenu");

    const toggle =
      document.getElementById("themeToggle");

    if (!menu || !toggle) {
      return;
    }

    menu.hidden = false;

    toggle.setAttribute(
      "aria-expanded",
      "true"
    );

    menu
      .querySelector(".is-selected")
      ?.focus();
  }

  /**
   * Add the theme menu interactions.
   */
  function setupThemeControl() {
    const control = createThemeControl();

    const toggle =
      control.querySelector("#themeToggle");

    const menu =
      control.querySelector("#themeMenu");

    toggle?.addEventListener("click", () => {
      if (menu?.hidden) {
        openThemeMenu();
      } else {
        closeThemeMenu();
      }
    });

    menu?.addEventListener("click", (event) => {
      const choice =
        event.target.closest(
          "[data-theme-choice]"
        );

      if (!choice) {
        return;
      }

      applyTheme(
        choice.dataset.themeChoice,
        {
          persist: true,
          sync: true
        }
      );

      closeThemeMenu({
        restoreFocus: true
      });
    });

    document.addEventListener(
      "click",
      (event) => {
        if (!control.contains(event.target)) {
          closeThemeMenu();
        }
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape" &&
          menu &&
          !menu.hidden
        ) {
          event.preventDefault();

          closeThemeMenu({
            restoreFocus: true
          });
        }
      }
    );

    updateThemeControl();
  }

  /**
   * Preserve the saved theme when older logout code calls
   * localStorage.clear().
   */
  function installLogoutThemeGuard() {
    const prototype =
      window.Storage?.prototype;

    if (
      !prototype ||
      prototype.__codetrackerThemeGuardInstalled
    ) {
      return;
    }

    const originalClear = prototype.clear;

    Object.defineProperty(
      prototype,
      "__codetrackerThemeGuardInstalled",
      {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      }
    );

    prototype.clear = function guardedClear() {
      const isLocalStorage =
        this === window.localStorage;

      const savedTheme = isLocalStorage
        ? normalizePreference(
            this.getItem(STORAGE_KEY)
          )
        : null;

      originalClear.call(this);

      if (isLocalStorage && savedTheme) {
        this.setItem(
          STORAGE_KEY,
          savedTheme
        );
      }
    };
  }

  /**
   * Read a theme value returned by the backend.
   */
  function getPreferenceFromResponse(response) {
    const value =
      response?.themePreference ??
      response?.theme ??
      response?.preference ??
      response?.data?.themePreference ??
      response?.data?.theme ??
      response?.data?.preference;

    return normalizePreference(value);
  }

  /**
   * Pages that represent the logged-in application.
   */
  function isAuthenticatedArea() {
    const path =
      window.location.pathname.toLowerCase();

    return (
      path.includes("/dashboard") ||
      path.includes("/studentclass") ||
      path.includes("/profclass") ||
      path.includes("/onboarding") ||
      path.includes("/syntax")
    );
  }

  /**
   * Load the user's database theme preference when the backend
   * endpoint becomes available.
   */
  async function loadPreferenceFromAccount() {
    if (
      window.CodeTrackerConfig?.features?.accountTheme !== true ||
      !isAuthenticatedArea() ||
      !window.ApiClient?.request
    ) {
      return;
    }

    const revisionAtRequestStart = preferenceRevision;

    try {
      const response =
        await window.ApiClient.request(
          PREFERENCES_ENDPOINT,
          {
            method: "GET",
            headers: {
              Accept: "application/json"
            }
          },
          {
            redirectOnUnauthorized: false,
            retryOnRefresh: true
          }
        );

      backendPreferenceSupported = true;

      // A slow GET must not overwrite a choice the user made while it
      // was in flight. That newer choice is already queued for saving.
      if (preferenceRevision !== revisionAtRequestStart) {
        return;
      }

      const accountPreference =
        getPreferenceFromResponse(response);

      if (accountPreference) {
        applyTheme(
          accountPreference,
          {
            persist: true,
            sync: false
          }
        );
      } else {
        // Preserve an existing browser preference when the account has
        // not stored one yet, then make the database authoritative.
        await savePreferenceToAccount(currentPreference);
      }
    } catch (error) {
      const message =
        String(error?.message || "");

      if ([404, 405].includes(error?.status) || /404|not found|405/i.test(message)) {
        backendPreferenceSupported = false;
      }
    }
  }

  /**
   * Save the user's preference to the backend when supported.
   */
  function savePreferenceToAccount(
    preference
  ) {
    if (
      window.CodeTrackerConfig?.features?.accountTheme !== true ||
      !isAuthenticatedArea() ||
      !window.ApiClient?.request ||
      backendPreferenceSupported === false
    ) {
      return Promise.resolve();
    }

    // Serialize updates so rapid theme clicks cannot finish out of order
    // and leave the database with an older preference.
    accountSaveQueue = accountSaveQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          await window.ApiClient.request(
            PREFERENCES_ENDPOINT,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({
                themePreference:
                  preference.toUpperCase()
              })
            },
            {
              redirectOnUnauthorized: false,
              retryOnRefresh: true
            }
          );

          backendPreferenceSupported = true;
        } catch (error) {
          const message =
            String(error?.message || "");

          if ([404, 405].includes(error?.status) || /404|not found|405/i.test(message)) {
            backendPreferenceSupported = false;
          }
        }
      });

    return accountSaveQueue;
  }

  /**
   * Dynamically load one stylesheet only once.
   */
  function ensureStylesheet(href, marker) {
    const attribute = `data-${marker}`;

    if (
      document.querySelector(
        `link[${attribute}]`
      )
    ) {
      return;
    }

    const link =
      document.createElement("link");

    link.rel = "stylesheet";
    link.href = href;

    link.setAttribute(
      attribute,
      ""
    );

    document.head.appendChild(link);
  }

  /**
   * Dynamically load one script only once.
   */
  function ensureScript(src, marker) {
    const attribute = `data-${marker}`;

    if (
      document.querySelector(
        `script[${attribute}]`
      )
    ) {
      return;
    }

    const script =
      document.createElement("script");

    script.src = src;

    script.setAttribute(
      attribute,
      ""
    );

    document.body.appendChild(script);
  }

  /**
   * Load page-specific usability improvements.
   */
  function loadPageEnhancements() {
    ensureStylesheet(
      "/frontend/css/ux-improvements.css",
      "codetracker-ux"
    );

    const path =
      window.location.pathname.toLowerCase();

    if (path.includes("/studentclass")) {
      ensureScript(
        "/frontend/script/student-ux.js",
        "codetracker-student-ux"
      );
    } else if (path.includes("/profclass")) {
      ensureScript(
        "/frontend/script/professor-ux.js",
        "codetracker-professor-ux"
      );
    }
  }

  /**
   * Run a callback when the HTML is ready.
   */
  function whenReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        callback,
        {
          once: true
        }
      );
    } else {
      callback();
    }
  }

  installLogoutThemeGuard();

  /*
   * The login page remains permanently dark.
   * Remove both the old and new theme controls if this script
   * is accidentally loaded there.
   */
  if (isLoginPage()) {
    keepLoginPageDark();
    whenReady(keepLoginPageDark);
    return;
  }

  /*
   * Apply the saved theme on application pages.
   */
  applyTheme(currentPreference);

  whenReady(() => {
    removeLegacyThemeToggles();
    setupThemeControl();
    loadPageEnhancements();
    void loadPreferenceFromAccount();
  });

  /*
   * Update automatically when the device theme changes and
   * the user selected System.
   */
  systemThemeQuery.addEventListener?.(
    "change",
    () => {
      if (currentPreference === "system") {
        applyTheme("system");
      }
    }
  );

  /**
   * Public theme API for other scripts.
   */
  window.CodeTrackerTheme = Object.freeze({
    getPreference: () =>
      currentPreference,

    getResolvedTheme: () =>
      resolveTheme(currentPreference),

    setPreference: (preference) =>
      applyTheme(
        preference,
        {
          persist: true,
          sync: true
        }
      )
  });
})();
