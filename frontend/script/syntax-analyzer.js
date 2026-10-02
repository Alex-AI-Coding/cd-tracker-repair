(function initializeAnalyzerPage(globalScope) {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const client = globalScope.CodeTrackerAnalyzer.createClient();
    const controller = new AbortController();
    let fileList = [];
    let currentFileIndex = 0;
    let currentErrors = [];
    let currentWarnings = [];

    function readPendingAnalysis() {
      const params = new URLSearchParams(globalScope.location.search);
      let stored = null;
      for (const name of ["sessionStorage", "localStorage"]) {
        try {
          const parsed = JSON.parse(globalScope[name].getItem("pendingAnalysis"));
          if (parsed?.repoUrl) { stored = parsed; break; }
        } catch (_) { /* Try the other store or URL parameters. */ }
      }
      const repoUrl = params.get("repo") || stored?.repoUrl;
      if (!repoUrl) return null;
      const classroomId = params.get("classroomId") || stored?.classroomId || "";
      const sameReview = stored?.repoUrl === repoUrl && String(stored?.classroomId || "") === classroomId;
      const fresh = stored?.timestamp && Date.now() - Date.parse(stored.timestamp) < 30 * 60 * 1000;
      return {
        ...(sameReview ? stored : {}),
        repoUrl,
        classroomId,
        studentName: params.get("student") || (sameReview ? stored?.studentName : "") || "Student",
        activityTitle: params.get("activity") || (sameReview ? stored?.activityTitle : "") || "Activity",
        analysisId: sameReview && fresh ? stored?.analysisId : null
      };
    }

    function savePendingAnalysis(data) {
      const saved = { ...data, timestamp: new Date().toISOString() };
      for (const name of ["sessionStorage", "localStorage"]) {
        try { globalScope[name].setItem("pendingAnalysis", JSON.stringify(saved)); } catch (_) {}
      }
    }

    function setStatus(status, text) {
      const element = document.getElementById("repoStatus");
      const icon = { analyzing: "spinner fa-spin", completed: "check-circle", error: "times-circle" }[status] || "clock";
      element.className = `repo-status ${status}`;
      element.innerHTML = `<i class="fas fa-${icon}"></i> ${escapeHtml(text)}`;
    }

    function showToast(message, type = "info") {
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }

    async function startReview(data) {
      try {
        setStatus("analyzing", data.analysisId ? "Resuming..." : "Analyzing...");
        document.getElementById("resultsSection").style.display = "block";
        document.getElementById("summaryStats").textContent = "Preparing code review...";
        let result;
        if (data.analysisId) {
          try {
            // Reuse a completed/pending job; restart only if the service
            // explicitly says that saved job no longer exists.
            result = await client.pollAnalysis(data.analysisId, { signal: controller.signal });
          } catch (error) {
            if (!error.missingAnalysis) throw error;
            data.analysisId = null;
            savePendingAnalysis(data);
          }
        }
        if (!result) {
          const started = await client.startAnalysis(data.repoUrl, { signal: controller.signal });
          data.analysisId = started.analysis_id;
          savePendingAnalysis(data);
          result = await client.pollAnalysis(data.analysisId, { signal: controller.signal });
        }
        displayResults(result);
        setStatus("completed", "Completed");
        showToast("Analysis completed successfully!", "success");
      } catch (error) {
        if (error.name === "AbortError") return;
        setStatus("error", "Failed");
        document.getElementById("summaryStats").textContent = error.message;
        showToast(error.message, "error");
      }
    }

    // ========== DISPLAY RESULTS ==========
    function displayResults(data) {
      const summary = data.summary || {};
      fileList = Array.isArray(data.files) ? data.files : [];
      currentFileIndex = 0;
      currentErrors = [];
      currentWarnings = [];
      document.getElementById("codeContent").replaceChildren();
      document.getElementById("currentFileName").textContent = "Select a file";
      document.getElementById("languageBadge").textContent = "-";
      updateErrorPanel();

      if (fileList.length === 0) {
        document.getElementById("summaryStats").innerHTML = `<div class="stat"><i class="fas fa-info-circle"></i> No supported files found</div>`;
        document.getElementById("fileList").innerHTML = `<div style="padding: 20px; text-align: center;">No source files found</div>`;
        return;
      }

      document.getElementById("summaryStats").innerHTML = `
        <div class="stat files"><i class="fas fa-file-code"></i> Files: ${summary.total_files || 0}</div>
        <div class="stat errors"><i class="fas fa-times-circle"></i> Errors: ${summary.errors_count || 0}</div>
        <div class="stat warnings"><i class="fas fa-exclamation-triangle"></i> Warnings: ${summary.warnings_count || 0}</div>
        <div class="stat"><i class="fas fa-code-branch"></i> ${escapeHtml(summary.branch_used || "main")}</div>
      `;

      renderFileList();
      if (fileList.length > 0) loadFile(0);
    }

    function renderFileList(filter = "") {
      const fileListEl = document.getElementById("fileList");
      if (!fileList || fileList.length === 0) {
        fileListEl.innerHTML = `<div style="padding: 20px; text-align: center;">No files</div>`;
        return;
      }

      const filteredFiles = filter ? fileList.filter(f => String(f.file_name || f.file_path || "").toLowerCase().includes(filter.toLowerCase())) : fileList;

      fileListEl.innerHTML = filteredFiles.map((file) => {
        const originalIndex = fileList.findIndex(f => f.file_path === file.file_path);
        let statusClass = "", statusIcon = "";
        if (file.errors_count > 0) {
          statusClass = "has-errors";
          statusIcon = '<i class="fas fa-times-circle" style="color: var(--accent-red);"></i>';
        } else if (file.warnings_count > 0) {
          statusClass = "has-warnings";
          statusIcon = '<i class="fas fa-exclamation-circle" style="color: var(--accent-yellow);"></i>';
        } else {
          statusClass = "clean";
          statusIcon = '<i class="fas fa-check-circle" style="color: var(--accent-green);"></i>';
        }
        return `
          <div class="file-item ${statusClass} ${originalIndex === currentFileIndex ? "active" : ""}" data-file-index="${originalIndex}">
            <i class="fas fa-file-code"></i>
            <span class="file-name" title="${escapeHtml(file.file_path)}">${escapeHtml(file.file_name)}</span>
            ${statusIcon}
          </div>
        `;
      }).join("");
    }

    function loadFile(index) {
      if (index < 0 || index >= fileList.length) return;
      currentFileIndex = index;
      const file = fileList[index];
      document.getElementById("currentFileName").textContent = file.file_name;
      document.getElementById("languageBadge").textContent = file.language || "Code";
      currentErrors = Array.isArray(file.errors) ? file.errors : [];
      currentWarnings = Array.isArray(file.warnings) ? file.warnings : [];
      updateErrorPanel();
      displayCode(String(file.code ?? file.content ?? "// No code content available"));
      renderFileList(document.getElementById("fileSearch").value);
    };

    function displayCode(code) {
      const lines = code.split(/\r?\n/);
      const codeContentEl = document.getElementById("codeContent");
      codeContentEl.innerHTML = "";

      for (let i = 0; i < lines.length; i++) {
        const lineContent = document.createElement("div");
        lineContent.className = "code-line";
        const hasError = currentErrors.some(e => e.line === i + 1);
        const hasWarning = currentWarnings.some(w => w.line === i + 1);
        if (hasError) lineContent.classList.add("error-line");
        else if (hasWarning) lineContent.classList.add("warning-line");

        const lineNumber = document.createElement("span");
        lineNumber.className = "line-number";
        lineNumber.textContent = i + 1;

        const lineText = document.createElement("span");
        lineText.className = "line-text";
        lineText.textContent = lines[i] || " ";

        lineContent.appendChild(lineNumber);
        lineContent.appendChild(lineText);
        codeContentEl.appendChild(lineContent);
      }
    }

    function updateErrorPanel() {
      const errorListEl = document.getElementById("errorList");
      const errorCountEl = document.getElementById("errorCount");
      const warningCountEl = document.getElementById("warningCount");
      errorCountEl.textContent = currentErrors.length;
      warningCountEl.textContent = currentWarnings.length;

      if (currentErrors.length === 0 && currentWarnings.length === 0) {
        errorListEl.innerHTML = `<div class="no-errors"><i class="fas fa-check-circle fa-2x"></i><div style="margin-top: 10px;">No issues found!</div></div>`;
        return;
      }

      let html = "";
      if (currentErrors.length > 0) {
        html += `<div style="margin-bottom: 10px; font-weight: 600; color: var(--accent-red);"><i class="fas fa-times-circle"></i> Errors (${currentErrors.length})</div>`;
        currentErrors.forEach(err => {
          html += `<div class="error-item"><div class="error-line-num">Line ${escapeHtml(err.line || "?")}</div><div class="error-message">${escapeHtml(err.message)}</div></div>`;
        });
      }
      if (currentWarnings.length > 0) {
        if (currentErrors.length > 0) html += `<div style="margin: 12px 0 4px;"></div>`;
        html += `<div style="margin-bottom: 10px; font-weight: 600; color: var(--accent-yellow);"><i class="fas fa-exclamation-triangle"></i> Warnings (${currentWarnings.length})</div>`;
        currentWarnings.forEach(warn => {
          html += `<div class="error-item warning"><div class="error-line-num">Line ${escapeHtml(warn.line || "?")}</div><div class="error-message">${escapeHtml(warn.message)}</div></div>`;
        });
      }
      errorListEl.innerHTML = html;
    }

    function escapeHtml(text) {
      return String(text ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
    }

    const data = readPendingAnalysis();
    document.getElementById("backToClassBtn").addEventListener("click", () => {
      controller.abort();
      for (const name of ["sessionStorage", "localStorage"]) {
        try { globalScope[name].removeItem("pendingAnalysis"); } catch (_) {}
      }
      let target = new URL("/profclass/", globalScope.location.origin);
      if (data?.returnUrl) {
        try {
          const previous = new URL(data.returnUrl, globalScope.location.origin);
          if (previous.origin === globalScope.location.origin && /^\/profclass(?:\/|$)/i.test(previous.pathname)) target = previous;
        } catch (_) {}
      }
      if (data?.classroomId) target.searchParams.set("classroomId", data.classroomId);
      target.searchParams.set("from", "analyzer");
      globalScope.location.href = target.toString();
    });
    globalScope.addEventListener("pagehide", () => controller.abort(), { once: true });
    document.getElementById("supportedBadge").addEventListener("click", () => {
      showToast("Analysis is available for Python, Java, C, and C++ source files.");
    });
    document.getElementById("fileSearch").addEventListener("input", (event) => renderFileList(event.target.value));
    document.getElementById("fileList").addEventListener("click", (event) => {
      const item = event.target.closest("[data-file-index]");
      if (item) loadFile(Number(item.dataset.fileIndex));
    });
    document.addEventListener("keydown", (event) => {
      if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      const next = event.key === "ArrowUp" ? currentFileIndex - 1 : event.key === "ArrowDown" ? currentFileIndex + 1 : -1;
      if (next >= 0 && next < fileList.length) { event.preventDefault(); loadFile(next); }
    });
    if (data) {
      document.getElementById("repoUrlDisplay").textContent = data.repoUrl;
      document.getElementById("headerSubtitle").textContent = `Reviewing: ${data.studentName} | ${data.activityTitle}`;
      void startReview(data);
    } else {
      document.getElementById("repoUrlDisplay").textContent = "No active review. Please return to the class dashboard.";
    }
  });
})(window);
