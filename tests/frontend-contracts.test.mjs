import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const authenticatedPages = [
  "dashboard/index.html",
  "onboarding/index.html",
  "profclass/index.html",
  "studentclass/index.html",
  "Syntax.html"
];

test("every authenticated page can sync theme preferences through ApiClient", () => {
  for (const page of authenticatedPages) {
    const html = read(page);
    const apiClientIndex = html.indexOf("api-client.js");
    const configIndex = html.indexOf("runtime-config.js");
    const themeIndex = html.indexOf("theme.js");

    assert.match(html, /<meta\s+name=["']viewport["']/i, `${page} needs a viewport meta tag`);
    assert.ok(apiClientIndex >= 0, `${page} must load api-client.js`);
    assert.ok(configIndex >= 0 && configIndex < apiClientIndex, `${page} must load runtime config first`);
    assert.ok(themeIndex > apiClientIndex, `${page} must load api-client.js before theme.js`);
  }
});

test("Echo is installed consistently on authenticated working pages", () => {
  for (const page of [
    "dashboard/index.html",
    "profclass/index.html",
    "studentclass/index.html",
    "Syntax.html"
  ]) {
    const html = read(page);
    assert.match(html, /frontend\/css\/chatbot\.css/);
    assert.match(html, /frontend\/script\/chatbot\.js/);
  }
});

test("deployment URLs have one source and contain no expired backend domain", () => {
  for (const script of [
    "frontend/script/api-client.js",
    "frontend/script/script.js"
  ]) {
    const source = read(script);
    assert.doesNotMatch(source, /codetracker-production-(ab72|979d)/i);
    assert.match(source, /CodeTrackerConfig/);
  }
  assert.match(read("frontend/script/runtime-config.js"), /codetracker-production-afd9/);
});

test("Echo registers initialization without leaking private history variables at script scope", () => {
  const callbacks = [];
  const context = {
    window: {},
    document: { readyState: "loading", addEventListener(_event, callback) { callbacks.push(callback); } }
  };
  assert.doesNotThrow(() => vm.runInNewContext(read("frontend/script/chatbot.js"), context));
  assert.equal(callbacks.length, 1);
});

test("missing account APIs are explicitly optional, with local fallbacks kept", () => {
  const window = {};
  vm.runInNewContext(read("frontend/script/runtime-config.js"), { window });
  assert.equal(window.CodeTrackerConfig.features.accountTheme, false);
  assert.equal(window.CodeTrackerConfig.features.remoteChatHistory, false);
  assert.match(read("frontend/script/theme.js"), /features\?\.accountTheme/);
  assert.match(read("frontend/script/chatbot.js"), /features\?\.remoteChatHistory/);
});

test("Echo mobile CSS covers compact, narrow, landscape, and safe-area layouts", () => {
  const css = read("frontend/css/chatbot.css");
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.chatbot-threads-panel[\s\S]*width:\s*100%/);
});

test("theme and Echo use the new account persistence endpoints", () => {
  assert.match(read("frontend/script/theme.js"), /\/users\/preferences\/theme/);
  const chatbot = read("frontend/script/chatbot.js");
  assert.match(chatbot, /\/chatbot\/threads/);
  assert.match(chatbot, /threadId/);
  assert.match(chatbot, /Load older messages/);
});

test("framed page spacing stays constrained on desktop and mobile", () => {
  const loginCss = read("frontend/css/style.css");
  assert.match(
    loginCss,
    /@media\s*\(min-width:\s*901px\)[\s\S]*?\.login-page\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*1rem;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/
  );

  const themeCss = read("frontend/css/theme.css");
  assert.match(themeCss, /body\s*\{\s*margin:\s*1rem;[\s\S]*?min-height:\s*calc\(100dvh\s*-\s*2rem\);/);
  assert.match(
    themeCss,
    /\.dashboard-header,\s*\.header\s*\{[\s\S]*?width:\s*calc\(100%\s*-\s*2rem\);[\s\S]*?margin:\s*1rem;[\s\S]*?top:\s*1rem;/
  );
  assert.match(themeCss, /@media\s*\(max-width:\s*768px\)[\s\S]*?margin:\s*0\.75rem;/);
  assert.match(themeCss, /@media\s*\(max-width:\s*420px\)[\s\S]*?margin:\s*0\.5rem;/);
});

test("light theme uses the complete warm neutral palette", () => {
  const css = read("frontend/css/theme.css");
  const lightTheme = css.match(/html\[data-theme=["']light["']\]\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(lightTheme, "theme.css must define a light-theme token block");
  for (const [token, value] of Object.entries({
    "color-page": "#f1f0ed",
    "color-page-deep": "#e8e6e1",
    "color-surface": "#faf9f6",
    "color-surface-raised": "#f4f2ee",
    "color-surface-hover": "#eceae5",
    "color-surface-inset": "#f0eeea",
    "color-border": "#d2d0ca",
    "color-border-strong": "#b9b6ae"
  })) {
    assert.match(lightTheme, new RegExp(`--${token}:\\s*${value};`, "i"));
    assert.equal(
      css.match(new RegExp(`--${token}:`, "g"))?.length,
      2,
      `${token} must not be overridden by a later light-theme block`
    );
  }

  assert.match(lightTheme, /--color-control:\s*#fdfcf9;/i);
  assert.match(lightTheme, /--color-control-hover:\s*#f1efeb;/i);
  assert.match(lightTheme, /--color-brand-start:\s*#f7f5f1;/i);
  assert.match(lightTheme, /--color-brand-end:\s*#e7e4de;/i);
  assert.match(lightTheme, /--color-toggle-background:\s*rgba\(250,\s*249,\s*246,\s*0\.94\);/i);
  assert.match(lightTheme, /--color-toggle-hover:\s*#eeece7;/i);
  assert.match(lightTheme, /--shadow-card:[\s\S]*?rgba\(66,\s*61,\s*52,\s*0\.08\)[\s\S]*?inset 0 1px rgba\(255,\s*255,\s*255,\s*0\.72\);/i);
  assert.match(lightTheme, /--shadow-floating:[\s\S]*?rgba\(66,\s*61,\s*52,\s*0\.12\)[\s\S]*?rgba\(66,\s*61,\s*52,\s*0\.14\);/i);

  assert.match(css, /html\[data-theme="light"\]\s+body\s*\{[\s\S]*?radial-gradient\(ellipse at 8% 0%[\s\S]*?radial-gradient\(ellipse at 96% 100%[\s\S]*?linear-gradient\(135deg/);
  assert.match(css, /Light-mode cards[\s\S]*?linear-gradient\(145deg, rgba\(255, 255, 255, 0\.58\), transparent 38%\)[\s\S]*?box-shadow:\s*var\(--shadow-card\)/);
  assert.match(css, /html\[data-theme="light"\][\s\S]*?:where\([\s\S]*?\.activity-card[\s\S]*?\):hover\s*\{[\s\S]*?0 11px 24px rgba\(66, 61, 52, 0\.10\)/);
});

test("shared headers use theme-specific depth without changing responsive framing", () => {
  const css = read("frontend/css/theme.css");
  const darkTheme = css.match(/:root,\s*html\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\n\}/)?.[1];
  const lightTheme = css.match(/html\[data-theme=["']light["']\]\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(darkTheme, "theme.css must define dark-theme tokens");
  assert.ok(lightTheme, "theme.css must define light-theme tokens");
  assert.match(darkTheme, /--shadow-header:\s*0 3px 10px rgba\(0,\s*0,\s*0,\s*0\.22\);/);
  assert.match(darkTheme, /--highlight-header:\s*rgba\(255,\s*255,\s*255,\s*0\.05\);/);
  assert.match(lightTheme, /--shadow-header:\s*0 3px 10px rgba\(31,\s*35,\s*40,\s*0\.10\);/);
  assert.match(lightTheme, /--highlight-header:\s*rgba\(255,\s*255,\s*255,\s*0\.75\);/);
  assert.match(
    css,
    /\.dashboard-header,\s*\.header\s*\{[\s\S]*?border:\s*1px solid var\(--color-border\) !important;[\s\S]*?border-radius:\s*12px;[\s\S]*?box-shadow:\s*var\(--shadow-header\),\s*inset 0 1px 0 var\(--highlight-header\);/
  );
});
