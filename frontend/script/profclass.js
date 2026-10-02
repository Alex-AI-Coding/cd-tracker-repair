const apiRequest = window.ApiClient?.request;
const ACTIVITY_TIME_ZONE = "Asia/Singapore";
const ACTIVITY_TIME_ZONE_OFFSET = "+08:00";
const ANNOUNCEMENT_MAX_MESSAGE_LENGTH = 5000;
const ANNOUNCEMENT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "application/pdf",
]);
const ANNOUNCEMENT_ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "mp4",
  "webm",
  "mov",
  "avi",
  "mkv",
  "mp3",
  "wav",
  "ogg",
  "aac",
  "pdf",
]);
const ANNOUNCEMENT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ANNOUNCEMENT_MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024;
let selectedAnnouncementFiles = [];
let selectedEditAnnouncementFiles = [];
let selectedEditAnnouncementAttachmentIds = new Set();
const ANNOUNCEMENT_CACHE_PREFIX = "ct_announcements_";

const state = {
  classroomId: null,
  currentUser: null,
  announcements: [],
  activities: [],
  students: [],
  submittedByActivity: {},
  currentSubmissionsActivityId: null,
  currentSubmissionRows: [],
  submissionFilter: "ALL",
  activityFilter: "all",
  currentDetailRow: null,
  editingAnnouncementId: null,
};

// Add this at the beginning of your DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", async () => {
  renderLoadingSkeleton();
  if (!apiRequest) {
    showNotification("API client is not initialized.", "error");
    return;
  }

  // Clean up any stale analysis data if we're not coming from syntax page
  const urlParams = new URLSearchParams(window.location.search);
  const comingFromAnalyzer = urlParams.get("from") === "analyzer";

  if (!comingFromAnalyzer) {
    // Clear stale analysis data if older than 30 minutes
    const stored = localStorage.getItem("pendingAnalysis");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        const timestamp = new Date(data.timestamp);
        const now = new Date();
        const diffMinutes = (now - timestamp) / (1000 * 60);

        if (diffMinutes > 30) {
          localStorage.removeItem("pendingAnalysis");
          sessionStorage.removeItem("pendingAnalysis");
        }
      } catch (e) {
        localStorage.removeItem("pendingAnalysis");
        sessionStorage.removeItem("pendingAnalysis");
      }
    }
  }

  state.classroomId = extractClassroomId();

  if (!state.classroomId) {
    showNotification("Classroom ID not found in URL.", "error");
    setTimeout(() => {
      window.location.href = "/dashboard/";
    }, 1200);
    return;
  }

  setupEventListeners();
  await loadInitialData();
});

function extractClassroomId() {
  // First check URL parameters
  const params = new URLSearchParams(window.location.search);
  let value = params.get("id") || params.get("classroomId") || "";

  // If not in URL, check localStorage (for when returning from syntax page)
  if (!value) {
    value = localStorage.getItem("currentClassroomId") || "";
  }

  return String(value).trim();
}

function setupEventListeners() {
  const assignmentsList = document.getElementById("assignmentsList");
  const createBtn = document.getElementById("createActivityBtn");
  const saveCreateBtn = document.getElementById("saveActivityBtn");
  const saveEditBtn = document.getElementById("saveEditActivityBtn");
  const saveGradeBtn = document.getElementById("saveGradeBtn");
  const gradeAnalyzeBtn = document.getElementById("gradeAnalyzeBtn");
  const backBtn = document.getElementById("backDashboardBtn");
  const submissionFilter = document.getElementById("submissionFilter");
  const activityFilter = document.getElementById("activityFilter");
  const announcementForm = document.getElementById("announcementForm");
  const announcementMessage = document.getElementById("announcementMessage");
  const announcementAttachments = document.getElementById(
    "announcementAttachments",
  );
  const createAnnouncementOpenBtn = document.getElementById("createAnnouncementOpenBtn");
  const createAnnouncementModal = document.getElementById("createAnnouncementModal");
  const editAnnouncementMessage = document.getElementById("editAnnouncementMessage");
  const editAnnouncementAttachments = document.getElementById("editAnnouncementAttachments");
  const editAnnouncementModal = document.getElementById("editAnnouncementModal");
  const announcementsList = document.getElementById("announcementsList");

  if (createBtn) {
    createBtn.addEventListener("click", () => {
      const form = document.getElementById("createActivityForm");
      if (form) form.reset();
      const status = document.getElementById("activityStatus");
      if (status) status.value = "PUBLISHED";
      openModal("createActivityModal");
    });
  }

  if (saveCreateBtn) {
    saveCreateBtn.addEventListener("click", async () => {
      await handleCreateActivity();
    });
  }

  if (saveEditBtn) {
    saveEditBtn.addEventListener("click", async () => {
      await handleEditActivity();
    });
  }

  if (saveGradeBtn) {
    saveGradeBtn.addEventListener("click", async () => {
      await handleSubmitGrade();
    });
  }

  if (gradeAnalyzeBtn) {
    gradeAnalyzeBtn.addEventListener("click", async () => {
      const repoUrl = gradeAnalyzeBtn.getAttribute("data-repo-url");
      const activityTitle = gradeAnalyzeBtn.getAttribute("data-activity-title");
      const studentName = gradeAnalyzeBtn.getAttribute("data-student-name");
      const submissionStatus = asString(
        gradeAnalyzeBtn.getAttribute("data-submission-status"),
      ).toUpperCase();
      const fromGradingProcess =
        gradeAnalyzeBtn.getAttribute("data-from-grading-process") === "true";

      if (repoUrl) {
        await validateAndNavigateToAnalyzer(
          repoUrl,
          activityTitle,
          studentName,
          {
            submissionStatus,
            fromGradingProcess,
          },
        );
      } else {
        showNotification("No repository URL available for analysis.", "error");
      }
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = "/dashboard/";
    });
  }

  if (submissionFilter) {
    submissionFilter.addEventListener("change", (event) => {
      state.submissionFilter = String(
        event.target.value || "ALL",
      ).toUpperCase();
      renderSubmissionRows();
    });
  }

  if (activityFilter) {
    activityFilter.addEventListener("change", (event) => {
      state.activityFilter = asString(event.target.value).toLowerCase() || "all";
      renderRecentActivity();
    });
  }

  if (announcementMessage) {
    announcementMessage.addEventListener("input", updateAnnouncementCharCount);
    updateAnnouncementCharCount();
  }

  if (announcementAttachments) {
    announcementAttachments.addEventListener("change", () => {
      const files = Array.from(announcementAttachments.files || []);
      const invalid = getInvalidAnnouncementFiles(files);

      if (invalid.length) {
        announcementAttachments.value = "";
        showNotification(
          `Unsupported attachment: ${invalid[0].name || "file"}.`,
          "error",
        );
        return;
      }

      const oversized = getOversizedAnnouncementFiles(files);
      if (oversized.length) {
        announcementAttachments.value = "";
        showNotification(
          `Each attachment must be 5 MB or smaller. ${oversized[0].name || "A file"} is too large.`,
          "error",
        );
        return;
      }

      const existingKeys = new Set(
        selectedAnnouncementFiles.map((file) => getAnnouncementFileKey(file)),
      );
      const nextFiles = [
        ...selectedAnnouncementFiles,
        ...files.filter((file) => {
          const key = getAnnouncementFileKey(file);
          if (existingKeys.has(key)) return false;
          existingKeys.add(key);
          return true;
        }),
      ];
      if (getAnnouncementRequestSize(nextFiles) > ANNOUNCEMENT_MAX_REQUEST_SIZE_BYTES) {
        announcementAttachments.value = "";
        showNotification("Announcement uploads must total 10 MB or less.", "error");
        return;
      }

      selectedAnnouncementFiles = nextFiles;

      renderAnnouncementAttachmentList(selectedAnnouncementFiles);
      announcementAttachments.value = "";
    });
  }

  if (announcementForm) {
    announcementForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleCreateAnnouncement();
    });
  }

  if (createAnnouncementOpenBtn) {
    createAnnouncementOpenBtn.addEventListener("click", () => {
      resetAnnouncementComposerState();
      openModal("createAnnouncementModal");
    });
  }

  if (announcementsList) {
    announcementsList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-announcement-action]");
      if (!button) return;

      const announcementId = asString(button.getAttribute("data-announcement-id"));
      const action = asString(button.getAttribute("data-announcement-action")).toLowerCase();

      if (!announcementId) return;

      if (action === "edit") {
        openEditAnnouncementModal(announcementId);
      } else if (action === "delete") {
        await handleDeleteAnnouncement(announcementId);
      }
    });
  }

  if (createAnnouncementModal) {
    createAnnouncementModal.addEventListener("click", (event) => {
      if (event.target === createAnnouncementModal) {
        closeModal("createAnnouncementModal");
      }
    });
  }

  if (editAnnouncementMessage) {
    editAnnouncementMessage.addEventListener("input", updateEditAnnouncementCharCount);
    updateEditAnnouncementCharCount();
  }

  if (editAnnouncementAttachments) {
    editAnnouncementAttachments.addEventListener("change", () => {
      const files = Array.from(editAnnouncementAttachments.files || []);
      const invalidFiles = getInvalidAnnouncementFiles(files);
      if (invalidFiles.length) {
        showNotification(`Unsupported attachment: ${invalidFiles[0].name || "file"}.`, "error");
        editAnnouncementAttachments.value = "";
        selectedEditAnnouncementFiles = [];
        renderEditAnnouncementAttachmentList([]);
        return;
      }

      const oversized = getOversizedAnnouncementFiles(files);
      if (oversized.length) {
        editAnnouncementAttachments.value = "";
        selectedEditAnnouncementFiles = [];
        showNotification(
          `Each attachment must be 5 MB or smaller. ${oversized[0].name || "A file"} is too large.`,
          "error",
        );
        return;
      }

      selectedEditAnnouncementFiles = files;
      renderEditAnnouncementAttachmentList(selectedEditAnnouncementFiles);
    });
  }

  if (editAnnouncementModal) {
    editAnnouncementModal.addEventListener("click", (event) => {
      if (event.target === editAnnouncementModal) {
        closeModal("editAnnouncementModal");
      }
    });
  }

  document.getElementById("saveEditAnnouncementBtn")?.addEventListener("click", async () => {
    await handleEditAnnouncement();
  });

  document.getElementById("announcementAttachmentList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-announcement-file]");
    if (!button) return;

    const fileKey = asString(button.getAttribute("data-remove-announcement-file"));
    if (!fileKey) return;

    selectedAnnouncementFiles = selectedAnnouncementFiles.filter(
      (file) => getAnnouncementFileKey(file) !== fileKey,
    );
    renderAnnouncementAttachmentList(selectedAnnouncementFiles);
  });

  document.getElementById("editAnnouncementAttachmentList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-edit-announcement-file]");
    if (!button) return;

    const fileKey = asString(button.getAttribute("data-remove-edit-announcement-file"));
    if (!fileKey) return;

    selectedEditAnnouncementFiles = selectedEditAnnouncementFiles.filter(
      (file) => getAnnouncementFileKey(file) !== fileKey,
    );
    renderEditAnnouncementAttachmentList(selectedEditAnnouncementFiles);
  });

  if (assignmentsList) {
    assignmentsList.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("[data-action]");
      const card = event.target.closest(".assignment-card[data-activity-id]");

      if (!actionButton && card && !event.target.closest(".assignment-menu")) {
        closeAllActivityMenus();
        await openSubmissionsModal(card.getAttribute("data-activity-id"));
        return;
      }

      if (!actionButton) return;

      const action = actionButton.getAttribute("data-action");
      const activityId =
        actionButton.getAttribute("data-activity-id") ||
        card?.getAttribute("data-activity-id");
      if (!activityId) return;

      if (action === "toggle-activity-menu") {
        event.stopPropagation();
        toggleActivityMenu(activityId);
        return;
      }

      if (action === "view-submissions") {
        closeAllActivityMenus();
        await openSubmissionsModal(activityId);
        return;
      }

      if (action === "edit-activity") {
        closeAllActivityMenus();
        openEditActivityModal(activityId);
        return;
      }

      if (action === "delete-activity") {
        closeAllActivityMenus();
        await deleteActivity(activityId);
      }
    });

    assignmentsList.addEventListener("keydown", async (event) => {
      const card = event.target.closest(".assignment-card[data-activity-id]");
      if (!card) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest(".assignment-menu")) return;

      event.preventDefault();
      closeAllActivityMenus();
      await openSubmissionsModal(card.getAttribute("data-activity-id"));
    });
  }

  const submissionsList = document.getElementById("submissionsList");
  if (submissionsList) {
    submissionsList.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (!actionButton) return;

      const action = actionButton.getAttribute("data-action");

      // Handle analyze action (doesn't need activityId or studentId)
      // In the submissions list event listener, update the analyze button handler
      if (action === "analyze-code") {
        showNotification(
          "Analyzer is only available inside the grading process.",
          "warning",
        );
        return;
      }

      const activityId = actionButton.getAttribute("data-activity-id");
      const studentId = actionButton.getAttribute("data-student-id");
      if (!activityId || !studentId) return;

      if (action === "grade-student") {
        openGradeModal(activityId, studentId);
        return;
      }

      if (action === "view-submission-detail") {
        openSubmissionDetailModal(activityId, studentId);
      }
    });
  }

  const submittedDetailBody = document.getElementById("submittedDetailBody");
  if (submittedDetailBody) {
    submittedDetailBody.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (!actionButton) return;

      const action = actionButton.getAttribute("data-action");
      if (action !== "copy-submission-url" && action !== "copy-clone-command")
        return;

      const row = state.currentDetailRow;
      if (!row || !row.repositoryUrl) {
        showNotification("Repository URL is unavailable.", "error");
        return;
      }

      if (action === "copy-submission-url") {
        await copyTextWithFeedback(row.repositoryUrl, "Repository URL copied.");
        return;
      }

      if (action === "copy-clone-command") {
        await copyTextWithFeedback(
          `git clone ${row.repositoryUrl}`,
          "Clone command copied.",
        );
      }
    });
  }

  const submittedDetailBack = document.getElementById(
    "closeSubmittedDetailBtn",
  );
  if (submittedDetailBack) {
    submittedDetailBack.addEventListener("click", () => {
      closeModal("submittedDetailModal");
      if (state.currentSubmissionsActivityId) {
        openModal("submissionsModal");
      }
    });
  }

  document.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", () => {
      const modalId = element.getAttribute("data-close-modal");
      closeModal(modalId);
    });
  });

  window.addEventListener("click", (event) => {
    if (!event.target.closest(".assignment-menu")) {
      closeAllActivityMenus();
    }
    const modal = event.target.closest(".modal");
    if (!modal || event.target !== modal) return;
    closeModal(modal.id);
  });
}

function closeAllActivityMenus() {
  document.querySelectorAll(".assignment-menu").forEach((menu) => {
    menu.classList.remove("open");
  });
}

function toggleActivityMenu(activityId) {
  const menu = document.querySelector(
    `.assignment-menu[data-activity-id="${CSS.escape(activityId)}"]`,
  );
  if (!menu) return;

  const isOpen = menu.classList.contains("open");
  closeAllActivityMenus();
  if (!isOpen) menu.classList.add("open");
}

async function loadInitialData() {
  // Validate classroom ID before loading
  if (!state.classroomId) {
    showNotification(
      "Classroom ID is missing. Redirecting to dashboard...",
      "error",
    );
    setTimeout(() => {
      window.location.href = "/dashboard/";
    }, 1500);
    return;
  }

  // Store classroom ID in localStorage for persistence
  localStorage.setItem("currentClassroomId", state.classroomId);

  try {
    await Promise.all([
      loadUserProfile(),
      loadStudents(),
      loadActivities(),
      loadSubmittedActivities(),
      loadAnnouncements(true),
    ]);

    await new Promise(r => setTimeout(r, 120));
    
    renderStudents();
    renderActivities();
    renderOverview();
    renderRecentActivity();
  } catch (error) {
    console.error("Failed to load initial data:", error);
    showNotification(
      "Failed to load classroom data. Please try again.",
      "error",
    );
  }
}


async function loadUserProfile() {
  try {
    const result = await apiRequest("/users/profile", { method: "GET" });
    const profile =
      result?.data && typeof result.data === "object" && !result.firstName
        ? result.data
        : result;

    const firstName = asString(profile?.firstName);
    const lastName = asString(profile?.lastName);
    const fullName = `${firstName} ${lastName}`.trim() || "Professor";
    const profileUrl = asString(profile?.profileUrl);

    state.currentUser = profile;

    const nameEl = document.getElementById("professorName");
    const avatarEl = document.getElementById("professorAvatar");

    if (nameEl) nameEl.textContent = fullName;
    if (avatarEl) {
      if (profileUrl) {
        avatarEl.innerHTML = `<img src="${escapeHtml(profileUrl)}" alt="${escapeHtml(fullName)}">`;
      } else {
        avatarEl.textContent = getInitials(fullName, "PR");
      }
    }
  } catch (error) {
    console.error("Failed to load profile:", error);
    const nameEl = document.getElementById("professorName");
    const avatarEl = document.getElementById("professorAvatar");
    if (nameEl) nameEl.textContent = "Professor";
    if (avatarEl) avatarEl.textContent = "PR";
  }
}

async function loadStudents() {
  try {
    const result = await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/students`,
      {
        method: "GET",
      },
    );

    const payload = Array.isArray(result)
      ? result
      : Array.isArray(result?.data)
        ? result.data
        : [];

    state.students = payload
      .map(normalizeStudent)
      .filter((student) => student.userId);
  } catch (error) {
    console.error("Failed to load students:", error);
    state.students = [];
    showNotification(error?.message || "Failed to load students.", "error");
  }
}

async function loadActivities() {
  try {
    const result = await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/activities/owner`,
      {
        method: "GET",
      },
    );

    const payload = Array.isArray(result)
      ? result
      : Array.isArray(result?.data)
        ? result.data
        : [];

    state.activities = payload;
  } catch (error) {
    console.error("Failed to load activities:", error);
    state.activities = [];
    showNotification(error?.message || "Failed to load activities.", "error");
  }
}

async function loadSubmittedActivities() {
  try {
    const result = await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/activities/submitted`,
      {
        method: "GET",
      },
    );

    const payload = extractSubmittedPayload(result);
    state.submittedByActivity = mapSubmittedByActivity(payload);
  } catch (error) {
    console.error("Failed to load submitted activities:", error);
    state.submittedByActivity = {};
    showNotification(
      error?.message || "Failed to load submitted activities.",
      "error",
    );
  }
}

function normalizeStudent(entry) {
  const userId = asString(entry?.studentUserId || entry?.userId || entry?.id);
  const firstName = asString(entry?.firstName);
  const lastName = asString(entry?.lastName);
  const displayName = `${firstName} ${lastName}`.trim() || "Student";

  return {
    userId,
    firstName,
    lastName,
    displayName,
    profileUrl: asString(entry?.profileUrl),
    lastActiveAt: asString(entry?.lastActiveAt),
    joinedAt: asString(entry?.joinedAt),
  };
}

function extractSubmittedPayload(responseBody) {
  if (!responseBody || typeof responseBody !== "object") {
    return {};
  }

  if (
    responseBody.data &&
    typeof responseBody.data === "object" &&
    !Array.isArray(responseBody.data)
  ) {
    return responseBody.data;
  }

  if (
    responseBody.data?.data &&
    typeof responseBody.data.data === "object" &&
    !Array.isArray(responseBody.data.data)
  ) {
    return responseBody.data.data;
  }

  return responseBody;
}

function mapSubmittedByActivity(payload) {
  const byActivity = {};

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return byActivity;
  }

  Object.entries(payload).forEach(([userKey, userEntry]) => {
    if (!userEntry || typeof userEntry !== "object") return;

    const userId = asString(userEntry.userId) || asString(userKey);
    const firstName = asString(userEntry.firstName);
    const lastName = asString(userEntry.lastName);
    const profileUrl = asString(userEntry.profileUrl);

    const studentActivities = Array.isArray(userEntry.studentActivities)
      ? userEntry.studentActivities
      : [];
    studentActivities.forEach((item) => {
      const normalized = normalizeSubmittedEntry(item, {
        userId,
        firstName,
        lastName,
        profileUrl,
      });

      if (!normalized.activityId || !normalized.userId) return;

      if (!byActivity[normalized.activityId]) {
        byActivity[normalized.activityId] = {};
      }

      const existing = byActivity[normalized.activityId][normalized.userId];
      if (!existing || isEntryNewer(normalized, existing)) {
        byActivity[normalized.activityId][normalized.userId] = normalized;
      }
    });
  });

  return byActivity;
}

function normalizeSubmittedEntry(entry, fallback) {
  const userId = asString(entry?.userId || fallback?.userId);
  const firstName = asString(entry?.firstName || fallback?.firstName);
  const lastName = asString(entry?.lastName || fallback?.lastName);
  const displayName = `${firstName} ${lastName}`.trim() || "Student";

  const scoreRaw = entry?.score;
  const parsedScore =
    scoreRaw == null || scoreRaw === "" ? null : Number(scoreRaw);

  const maxScoreRaw = entry?.maxScore;
  const parsedMaxScore =
    maxScoreRaw == null || maxScoreRaw === "" ? null : Number(maxScoreRaw);

  return {
    userId,
    studentActivityId: asString(entry?.studentActivityId),
    activityId: asString(entry?.activityId),
    title: asString(entry?.title),
    description: asString(entry?.description),
    displayName,
    firstName,
    lastName,
    profileUrl: asString(entry?.profileUrl || fallback?.profileUrl),
    repositoryOwnerUsername: asString(entry?.repositoryOwnerUsername),
    repositoryId: asString(entry?.repositoryId),
    repositoryName: asString(entry?.repositoryName),
    repositoryMode: asString(entry?.repositoryMode),
    repositoryUrl: asString(entry?.repositoryUrl),
    submissionStatus: asString(entry?.submissionStatus).toUpperCase(),
    feedback: asString(entry?.feedback),
    score: Number.isFinite(parsedScore) ? parsedScore : null,
    maxScore: Number.isFinite(parsedMaxScore) ? parsedMaxScore : null,
    submittedAt: asString(entry?.submittedAt),
    updatedAt: asString(entry?.updatedAt),
    createdAt: asString(entry?.createdAt),
  };
}

function isLateSubmission(row, activity) {
  const submittedAt = parseApiDate(row?.submittedAt || row?.updatedAt || row?.createdAt);
  const dueDate = parseApiDate(activity?.dueDate);

  if (!submittedAt || !dueDate) return false;
  return submittedAt.getTime() > dueDate.getTime();
}

function isEntryNewer(next, current) {
  const nextTimestamp = getSubmissionTimestamp(next);
  const currentTimestamp = getSubmissionTimestamp(current);
  return nextTimestamp >= currentTimestamp;
}

function getSubmissionTimestamp(entry) {
  const raw = entry?.updatedAt || entry?.submittedAt || entry?.createdAt || "";
  const parsed = parseApiDate(raw)?.getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderOverview() {
  const totalActivities = state.activities.length;
  const totalStudents = state.students.length;

  let needGrading = 0;
  state.activities.forEach((activity) => {
    const stats = computeActivityStats(getActivityId(activity));
    needGrading += stats.submitted;
  });

  const now = new Date();
  const dueSoonCount = state.activities.filter((activity) => {
    if (!activity?.dueDate) return false;
    const due = parseApiDate(activity.dueDate);
    if (!due) return false;
    const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  }).length;

  setText("overviewActivities", String(totalActivities));
  setText("overviewStudents", String(totalStudents));
  setText("overviewNeedGrading", String(needGrading));
  setText("overviewDueSoon", String(dueSoonCount));
}

function renderActivities() {
  const container = document.getElementById("assignmentsList");
  if (!container) return;

  if (!Array.isArray(state.activities) || state.activities.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>No activities yet. Create your first activity.</p>
            </div>
        `;
    return;
  }

  container.innerHTML = state.activities
    .map((activity) => {
      const activityId = getActivityId(activity);
      const stats = computeActivityStats(activityId);
      const due = getDueInfo(activity?.dueDate);
      const maxScore =
        activity?.maxScore != null ? Number(activity.maxScore) : null;

      return `
            <article class="assignment-card" data-action="view-submissions" data-activity-id="${escapeHtml(activityId)}" tabindex="0" role="button" aria-label="View submissions for ${escapeHtml(getActivityTitle(activity))}">
                <div class="assignment-top-row">
                    <div class="assignment-title-wrap">
                        <h3 class="assignment-card-title">${escapeHtml(getActivityTitle(activity))}</h3>
                        <div class="assignment-meta-line">
                            <span class="activity-status-chip ${statusClass(activity?.status)}">${escapeHtml(asString(activity?.status) || "UNKNOWN")}</span>
                            <span><i class="fas fa-calendar-alt"></i> ${escapeHtml(due.label)}</span>
                            ${maxScore != null ? `<span><i class="fas fa-star"></i> ${escapeHtml(String(maxScore))} points</span>` : ""}
                        </div>
                    </div>
                    <div class="assignment-menu" data-activity-id="${escapeHtml(activityId)}">
                        <button class="btn btn-secondary btn-icon assignment-menu-trigger" data-action="toggle-activity-menu" data-activity-id="${escapeHtml(activityId)}" title="Activity options" aria-label="Activity options">
                            <i class="fas fa-bars"></i>
                        </button>
                        <div class="assignment-menu-dropdown">
                            <button class="assignment-menu-item" data-action="edit-activity" data-activity-id="${escapeHtml(activityId)}">
                                <i class="fas fa-pen"></i>
                                <span>Edit Activity</span>
                            </button>
                            <button class="assignment-menu-item danger" data-action="delete-activity" data-activity-id="${escapeHtml(activityId)}">
                                <i class="fas fa-trash"></i>
                                <span>Delete Activity</span>
                            </button>
                        </div>
                    </div>
                </div>

                ${activity?.description ? `<p class="assignment-description">${escapeHtml(activity.description)}</p>` : ""}

                <div class="status-row">
                    <span class="status-chip pending">PENDING: ${stats.pending}</span>
                    <span class="status-chip submitted">SUBMITTED: ${stats.submitted}</span>
                    <span class="status-chip graded">GRADED: ${stats.graded}</span>
                </div>
            </article>
        `;
    })
    .join("");
}

function renderStudents() {
  const container = document.getElementById("studentsList");
  if (!container) return;

  if (!Array.isArray(state.students) || state.students.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p>No students enrolled yet.</p>
            </div>
        `;
    return;
  }

  container.innerHTML = state.students
    .map((student) => {
      const name = student.displayName || "Student";
      const avatar = student.profileUrl
        ? `<img src="${escapeHtml(student.profileUrl)}" alt="${escapeHtml(name)}">`
        : escapeHtml(getInitials(name, "ST"));

      const recency = student.lastActiveAt
        ? `Active ${escapeHtml(timeAgo(student.lastActiveAt))}`
        : "No recent activity";

      return `
            <div class="student-card">
                <div class="student-avatar">${avatar}</div>
                <div class="student-info">
                    <div class="student-name">${escapeHtml(name)}</div>
                    <div class="student-subtext">${recency}</div>
                </div>
            </div>
        `;
    })
    .join("");
}

function renderRecentActivity() {
  const container = document.getElementById("activityList");
  if (!container) return;

  const selectedFilter = state.activityFilter || "all";
  const items = buildRecentActivityItems().filter(
    (item) => selectedFilter === "all" || item.type === selectedFilter,
  );

  if (items.length === 0) {
    const emptyCopy =
      selectedFilter === "activities"
        ? "No created activities yet"
        : selectedFilter === "submissions"
          ? "No submissions yet"
          : selectedFilter === "joins"
            ? "No students have joined yet"
            : "No activity yet";

    container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <p>${escapeHtml(emptyCopy)}</p>
            </div>
        `;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const avatar = item.profileUrl
        ? `<img src="${escapeHtml(item.profileUrl)}" alt="${escapeHtml(item.actor)}">`
        : escapeHtml(getInitials(item.actor, item.actorFallback || "AC"));

      return `
            <article class="activity-item">
                <div class="activity-avatar ${item.avatarClass || ""}">${avatar}</div>
                <div class="activity-content">
                    <div class="activity-user">
                        ${escapeHtml(item.actor)}
                        <span class="activity-badge ${escapeHtml(item.badgeClass)}">${escapeHtml(item.badgeLabel)}</span>
                    </div>
                    <div class="activity-text">${escapeHtml(item.text)}</div>
                    ${item.details ? `<div class="activity-details"><i class="${escapeHtml(item.detailsIcon || "fas fa-info-circle")}"></i>${escapeHtml(item.details)}</div>` : ""}
                    <div class="activity-time">
                        <i class="far fa-clock"></i>
                        <span>${escapeHtml(item.timeLabel)}</span>
                    </div>
                </div>
            </article>
        `;
    })
    .join("");
}

function buildRecentActivityItems() {
  const items = [];
  const professorName =
    `${asString(state.currentUser?.firstName)} ${asString(state.currentUser?.lastName)}`.trim() ||
    "Professor";

  state.students.forEach((student) => {
    const joinedAt = student.joinedAt || student.createdAt || "";
    const joinedDate = parseApiDate(joinedAt);
    if (!joinedDate) return;

    items.push({
      type: "joins",
      actor: student.displayName || "Student",
      actorFallback: "ST",
      profileUrl: student.profileUrl || "",
      badgeLabel: "Joined",
      badgeClass: "badge-joined",
      text: "joined the classroom",
      details: joinedDate ? `Joined on ${formatDateTime(joinedAt)}` : "",
      detailsIcon: "fas fa-user-plus",
      avatarClass: "",
      timestamp: joinedDate.getTime(),
      timeLabel: timeAgo(joinedAt),
    });
  });

  state.activities.forEach((activity) => {
    const createdAt =
      asString(activity?.createdAt) ||
      asString(activity?.updatedAt);
    const createdDate = parseApiDate(createdAt);

    items.push({
      type: "activities",
      actor: professorName,
      actorFallback: "PR",
      profileUrl: asString(state.currentUser?.profileUrl),
      badgeLabel: "Activity",
      badgeClass: "badge-created",
      text: `created "${getActivityTitle(activity)}"`,
      details: asString(activity?.description) || `Status: ${asString(activity?.status) || "Unknown"}`,
      detailsIcon: "fas fa-plus-circle",
      avatarClass: "professor",
      timestamp: createdDate ? createdDate.getTime() : 0,
      timeLabel: createdDate ? timeAgo(createdAt) : "Date unavailable",
    });
  });

  Object.values(state.submittedByActivity).forEach((perActivity) => {
    Object.values(perActivity || {}).forEach((entry) => {
      const submissionDateRaw =
        asString(entry?.submittedAt) ||
        asString(entry?.updatedAt) ||
        asString(entry?.createdAt);
      const submissionDate = parseApiDate(submissionDateRaw);
      if (!submissionDate) return;

      const student = state.students.find(
        (item) => item.userId === asString(entry?.userId),
      );
      const actor = student?.displayName || asString(entry?.displayName) || "Student";
      const profileUrl = student?.profileUrl || asString(entry?.profileUrl);
      const activityTitle = asString(entry?.title) || "an activity";
      const repositoryLabel =
        asString(entry?.repositoryName) ||
        trimProtocol(asString(entry?.repositoryUrl)) ||
        "Repository linked";

      items.push({
        type: "submissions",
        actor,
        actorFallback: "ST",
        profileUrl,
        badgeLabel: "Submission",
        badgeClass: "badge-submitted",
        text: `submitted "${activityTitle}"`,
        details: repositoryLabel,
        detailsIcon: "fab fa-github",
        avatarClass: "",
        timestamp: submissionDate.getTime(),
        timeLabel: timeAgo(submissionDateRaw),
      });
    });
  });

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}

function computeActivityStats(activityId) {
  const rows = buildSubmissionRows(activityId);
  let pending = 0;
  let submitted = 0;
  let graded = 0;

  rows.forEach((row) => {
    if (row.status === "PENDING") pending += 1;
    else if (row.status === "SUBMITTED") submitted += 1;
    else if (row.status === "GRADED") graded += 1;
  });

  return { pending, submitted, graded };
}

function buildSubmissionRows(activityId) {
  const perActivity = state.submittedByActivity[activityId] || {};
  const rows = [];
  Object.values(perActivity).forEach((entry) => {
    const userId = asString(entry?.userId);
    if (!userId) return;

    const student = state.students.find((item) => item.userId === userId);
    const fullName =
      student?.displayName || asString(entry?.displayName) || "Student";
    rows.push({
      activityId,
      userId,
      displayName: fullName,
      profileUrl: student?.profileUrl || entry?.profileUrl || "",
      status: deriveSubmissionStatus(entry),
      repositoryUrl: entry?.repositoryUrl || "",
      repositoryName: entry?.repositoryName || "",
      repositoryOwnerUsername: entry?.repositoryOwnerUsername || "",
      repositoryMode: entry?.repositoryMode || "",
      submittedAt: entry?.submittedAt || "",
      createdAt: entry?.createdAt || "",
      updatedAt: entry?.updatedAt || "",
      studentActivityId: entry?.studentActivityId || "",
      title: entry?.title || "",
      description: entry?.description || "",
      score: entry?.score,
      maxScore: entry?.maxScore,
      feedback: entry?.feedback || "",
      raw: entry,
    });
  });

  const priority = {
    SUBMITTED: 1,
    PENDING: 2,
    GRADED: 3,
    NONE: 4,
  };

  rows.sort((a, b) => {
    const rank = (priority[a.status] || 99) - (priority[b.status] || 99);
    if (rank !== 0) return rank;
    return a.displayName.localeCompare(b.displayName);
  });

  return rows;
}

function deriveSubmissionStatus(entry) {
  if (!entry) return "NONE";

  const rawStatus = asString(entry.submissionStatus).toUpperCase();
  if (
    rawStatus === "PENDING" ||
    rawStatus === "SUBMITTED" ||
    rawStatus === "GRADED"
  ) {
    return rawStatus;
  }

  if (entry.score != null) return "GRADED";
  if (asString(entry.repositoryUrl)) return "PENDING";
  return "NONE";
}

async function openSubmissionsModal(activityId) {
  state.currentSubmissionsActivityId = activityId;
  state.submissionFilter = "ALL";

  const filter = document.getElementById("submissionFilter");
  if (filter) filter.value = "ALL";

  renderSubmissionsModal();
  openModal("submissionsModal");
}

function renderSubmissionsModal() {
  const activity = state.activities.find(
    (item) => getActivityId(item) === state.currentSubmissionsActivityId,
  );
  const titleEl = document.getElementById("submissionsModalTitle");
  const subtitleEl = document.getElementById("submissionsSubtitle");

  state.currentSubmissionRows = buildSubmissionRows(
    state.currentSubmissionsActivityId,
  );

  if (titleEl) {
    titleEl.innerHTML = `<i class="fas fa-file-circle-check"></i> ${escapeHtml(getActivityTitle(activity))}`;
  }

  const counts = {
    PENDING: 0,
    SUBMITTED: 0,
    GRADED: 0,
    LATE: 0,
  };

  state.currentSubmissionRows.forEach((row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
  });

  const activityDueDate = activity?.dueDate;
  if (activityDueDate) {
    state.currentSubmissionRows.forEach((row) => {
      if (isLateSubmission(row, activity)) {
        counts.LATE += 1;
      }
    });
  }

  if (subtitleEl) {
    subtitleEl.textContent = `PENDING: ${counts.PENDING} | SUBMITTED: ${counts.SUBMITTED} | GRADED: ${counts.GRADED} | LATE: ${counts.LATE}`;
  }

  renderSubmissionRows();
}

function renderSubmissionRows() {
  const container = document.getElementById("submissionsList");
  if (!container) return;

  const activity = state.activities.find(
    (item) => getActivityId(item) === state.currentSubmissionsActivityId,
  );
  const filter = state.submissionFilter;
  const rows = state.currentSubmissionRows.filter(
    (row) => filter === "ALL" || row.status === filter,
  );

  if (rows.length === 0) {
    container.innerHTML = `
            <div class="empty-state compact">
                <i class="fas fa-filter-circle-xmark"></i>
                <p>No submissions match the selected filter.</p>
            </div>
        `;
    return;
  }

  container.innerHTML = rows
    .map((row) => {
      const lateSubmission = isLateSubmission(row, activity);
      const initials = getInitials(row.displayName, "ST");
      const avatar = row.profileUrl
        ? `<img src="${escapeHtml(row.profileUrl)}" alt="${escapeHtml(row.displayName)}">`
        : escapeHtml(initials);

      const repoLink = row.repositoryUrl
        ? `<a href="${escapeHtml(row.repositoryUrl)}" target="_blank" rel="noopener noreferrer" class="repo-link"><i class="fa-brands fa-github"></i> ${escapeHtml(row.repositoryName || trimProtocol(row.repositoryUrl))}</a>`
        : '<span class="repo-missing">No repository linked</span>';

      const gradedMeta =
        row.status === "GRADED"
          ? `
                    <div>
                        <span class="field-label">Score</span>
                        <span>${
                          row.score != null
                            ? `${escapeHtml(String(row.score))}${row.maxScore != null ? ` / ${escapeHtml(String(row.maxScore))}` : ""}`
                            : "N/A"
                        }</span>
                    </div>
                    <div>
                        <span class="field-label">Feedback</span>
                        <span>${row.feedback ? escapeHtml(row.feedback) : "No feedback provided"}</span>
                    </div>
              `
          : "";

      let actionArea = "";
      if (row.status === "PENDING") {
        actionArea =
          '<span class="inline-note">Waiting final activity submission</span>';
      } else if (row.status === "SUBMITTED") {
        actionArea = `
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-small" data-action="grade-student" data-activity-id="${escapeHtml(row.activityId)}" data-student-id="${escapeHtml(row.userId)}">
                <i class="fas fa-award"></i>
                Grade
            </button>
        </div>
    `;
      } else if (row.status === "GRADED") {
        actionArea = `
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-small" data-action="view-submission-detail" data-activity-id="${escapeHtml(row.activityId)}" data-student-id="${escapeHtml(row.userId)}">
                <i class="fas fa-file-circle-check"></i>
                View Details
            </button>
        </div>
    `;
      }

      return `
            <article class="submission-card">
                <div class="submission-person">
                    <div class="student-avatar">${avatar}</div>
                    <div>
                        <div class="submission-name">${escapeHtml(row.displayName)}</div>
                        <div class="submission-time">${row.submittedAt ? `Updated ${escapeHtml(timeAgo(row.submittedAt))}` : "No timestamp"}</div>
                    </div>
                </div>

                <div class="submission-fields">
                    <div>
                        <span class="field-label">Status</span>
                        <span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span>
                        ${lateSubmission ? '<span class="status-pill late"><i class="fas fa-triangle-exclamation"></i> LATE SUBMISSION</span>' : ""}
                    </div>
                    <div>
                        <span class="field-label">Repository</span>
                        ${repoLink}
                    </div>
                    ${gradedMeta}
                </div>

                <div class="submission-actions">${actionArea}</div>
            </article>
        `;
    })
    .join("");
}

function openSubmissionDetailModal(activityId, studentUserId) {
  const row = state.currentSubmissionRows.find(
    (item) => item.activityId === activityId && item.userId === studentUserId,
  );
  if (!row) {
    showNotification("Submission details are unavailable.", "error");
    return;
  }

  state.currentDetailRow = row;

  const activity = state.activities.find(
    (item) => getActivityId(item) === activityId,
  );
  const submittedAt = row.submittedAt
    ? formatDateTime(row.submittedAt)
    : row.updatedAt
      ? formatDateTime(row.updatedAt)
      : "N/A";
  const status = row.status || "UNKNOWN";
  const lateSubmission = isLateSubmission(row, activity);

  const title = row.title || getActivityTitle(activity);
  const repositoryLabel = row.repositoryUrl
    ? trimProtocol(row.repositoryUrl)
    : "No repository URL";

  const gradingMessage =
    status === "GRADED"
      ? "This activity has already been graded."
      : status === "SUBMITTED"
        ? "This activity is submitted and waiting for grading."
        : "This activity is still pending final submission.";

  const detailTitle = document.getElementById("submittedDetailTitle");
  if (detailTitle) {
    detailTitle.innerHTML = `<i class="fas fa-file-circle-check"></i> ${escapeHtml(title)}`;
  }

  const detailBody = document.getElementById("submittedDetailBody");
  if (!detailBody) return;

  detailBody.innerHTML = `
        <article class="detail-shell">
            <header class="detail-head">
                <div class="detail-person">
                    <div class="student-avatar">${row.profileUrl ? `<img src="${escapeHtml(row.profileUrl)}" alt="${escapeHtml(row.displayName)}">` : escapeHtml(getInitials(row.displayName, "ST"))}</div>
                    <div>
                        <div class="detail-name">${escapeHtml(row.displayName)}</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                    <span class="status-pill ${statusClass(status)}">${escapeHtml(status)}</span>
                    ${lateSubmission ? '<span class="status-pill late"><i class="fas fa-triangle-exclamation"></i> LATE SUBMISSION</span>' : ""}
                </div>
            </header>

            <section class="detail-section">
                <h4>ACTIVITY</h4>
                <div class="detail-grid">
                    <div>
                        <span class="field-label">Title</span>
                        <span>${escapeHtml(title)}</span>
                    </div>
                </div>
            </section>

            <section class="detail-section">
                <h4>SUBMISSION</h4>
                <div class="detail-grid detail-grid-2">
                    <div>
                        <span class="field-label">Submitted At</span>
                        <span>${escapeHtml(submittedAt)}</span>
                    </div>
                    <div>
                        <span class="field-label">Submission Status</span>
                        <span>${escapeHtml(status)}</span>
                    </div>
                    ${
                      lateSubmission
                        ? `
                    <div>
                        <span class="field-label">Timing</span>
                        <span class="status-pill late">Late submission</span>
                    </div>`
                        : ""
                    }
                    ${
                      row.score != null
                        ? `
                    <div>
                        <span class="field-label">Score</span>
                        <span>${escapeHtml(String(row.score))}</span>
                    </div>`
                        : ""
                    }
                </div>
            </section>

            <section class="detail-section">
                <h4>GRADING</h4>
                <p class="detail-paragraph">${escapeHtml(gradingMessage)}</p>
            </section>

            <section class="detail-section">
                <h4>REPOSITORY</h4>
                <div class="detail-repo-row">
                    ${
                      row.repositoryUrl
                        ? `<a href="${escapeHtml(row.repositoryUrl)}" target="_blank" rel="noopener noreferrer" class="submission-repo-link">${escapeHtml(repositoryLabel)} <i class="fas fa-up-right-from-square"></i></a>`
                        : `<span class="repo-missing">${escapeHtml(repositoryLabel)}</span>`
                    }
                </div>
                ${
                  row.repositoryUrl
                    ? `
                <div class="detail-repo-actions">
                    <button type="button" class="btn btn-secondary btn-small" data-action="copy-submission-url"><i class="far fa-copy"></i> Copy URL</button>
                    <button type="button" class="btn btn-secondary btn-small" data-action="copy-clone-command"><i class="fas fa-terminal"></i> Copy Clone Command</button>
                </div>`
                    : ""
                }
                ${row.score != null ? `<div class="detail-meta-line"><strong>Score:</strong> ${escapeHtml(String(row.score))}</div>` : ""}
                ${row.feedback ? `<div class="detail-meta-line"><strong>Feedback:</strong> ${escapeHtml(row.feedback)}</div>` : ""}
            </section>
        </article>
    `;

  closeModal("submissionsModal");
  openModal("submittedDetailModal");
}

function openGradeModal(activityId, studentUserId) {
  const row = state.currentSubmissionRows.find(
    (item) => item.activityId === activityId && item.userId === studentUserId,
  );
  if (!row) {
    showNotification("Submission row not found.", "error");
    return;
  }

  if (row.status !== "SUBMITTED") {
    showNotification("Only SUBMITTED entries can be graded.", "error");
    return;
  }

  const activity = state.activities.find(
    (item) => getActivityId(item) === activityId,
  );
  const effectiveMaxScore =
    row.maxScore != null
      ? Number(row.maxScore)
      : activity?.maxScore != null
        ? Number(activity.maxScore)
        : null;

  setInputValue("gradeActivityId", activityId);
  setInputValue("gradeStudentUserId", studentUserId);
  setInputValue("gradeFeedback", row.feedback || "");
  setInputValue("gradeScore", row.score != null ? String(row.score) : "");
  setInputValue(
    "gradeMaxScore",
    effectiveMaxScore != null ? String(effectiveMaxScore) : "",
  );

  const scoreInput = document.getElementById("gradeScore");
  const scoreHint = document.getElementById("gradeScoreHint");
  if (scoreInput) {
    if (effectiveMaxScore != null && Number.isFinite(effectiveMaxScore)) {
      scoreInput.max = String(effectiveMaxScore);
    } else {
      scoreInput.removeAttribute("max");
    }
  }

  if (scoreHint) {
    scoreHint.textContent =
      effectiveMaxScore != null && Number.isFinite(effectiveMaxScore)
        ? `Maximum allowed score: ${effectiveMaxScore}`
        : "No maximum score was provided by backend for this entry.";
  }

  const info = document.getElementById("gradeStudentInfo");
  const gradeAnalyzeBtn = document.getElementById("gradeAnalyzeBtn");
  if (info) {
    const repoLink = row.repositoryUrl
      ? `<a href="${escapeHtml(row.repositoryUrl)}" target="_blank" rel="noopener noreferrer" class="repo-link">${escapeHtml(row.repositoryName || trimProtocol(row.repositoryUrl))}</a>`
      : '<span class="repo-missing">No repository URL</span>';

    const submittedAt = row.submittedAt
      ? formatDate(row.submittedAt)
      : row.updatedAt
        ? formatDate(row.updatedAt)
        : "N/A";

    info.innerHTML = `
            <strong>${escapeHtml(row.displayName)}</strong>
            <div class="grade-info-grid">
                <span><strong>Activity:</strong> ${escapeHtml(row.title || getActivityTitle(activity))}</span>
                <span><strong>Status:</strong> <span class="status-pill submitted">SUBMITTED</span></span>
                ${row.studentActivityId ? `<span><strong>Submission ID:</strong> ${escapeHtml(row.studentActivityId)}</span>` : ""}
                <span><strong>Repository:</strong> ${repoLink}</span>
                ${row.repositoryOwnerUsername ? `<span><strong>Owner:</strong> ${escapeHtml(row.repositoryOwnerUsername)}</span>` : ""}
                ${row.repositoryMode ? `<span><strong>Mode:</strong> ${escapeHtml(row.repositoryMode)}</span>` : ""}
                <span><strong>Submitted:</strong> ${escapeHtml(submittedAt)}</span>
                ${row.maxScore != null ? `<span><strong>Max Score:</strong> ${escapeHtml(String(row.maxScore))}</span>` : ""}
            </div>
            ${row.description ? `<div class="grade-activity-description">${escapeHtml(row.description)}</div>` : ""}
        `;
  }

  if (gradeAnalyzeBtn) {
    if (row.repositoryUrl) {
      gradeAnalyzeBtn.style.display = "";
      gradeAnalyzeBtn.setAttribute("data-repo-url", row.repositoryUrl);
      gradeAnalyzeBtn.setAttribute(
        "data-activity-title",
        row.title || "Activity",
      );
      gradeAnalyzeBtn.setAttribute("data-student-name", row.displayName);
      gradeAnalyzeBtn.setAttribute("data-submission-status", row.status);
      gradeAnalyzeBtn.setAttribute("data-from-grading-process", "true");
    } else {
      gradeAnalyzeBtn.style.display = "none";
      gradeAnalyzeBtn.removeAttribute("data-repo-url");
      gradeAnalyzeBtn.removeAttribute("data-activity-title");
      gradeAnalyzeBtn.removeAttribute("data-student-name");
      gradeAnalyzeBtn.removeAttribute("data-submission-status");
      gradeAnalyzeBtn.removeAttribute("data-from-grading-process");
    }
  }

  openModal("gradeModal");
}

async function handleSubmitGrade() {
  if (this.disabled) return;
  const activityId = asString(getInputValue("gradeActivityId"));
  const studentUserId = asString(getInputValue("gradeStudentUserId"));
  const feedback = asString(getInputValue("gradeFeedback"));
  const scoreRaw = asString(getInputValue("gradeScore"));
  const maxScoreRaw = asString(getInputValue("gradeMaxScore"));

  if (!activityId || !studentUserId) {
    showNotification("Grade target is missing.", "error");
    return;
  }

  const targetRow = state.currentSubmissionRows.find(
    (item) => item.activityId === activityId && item.userId === studentUserId,
  );
  if (!targetRow || targetRow.status !== "SUBMITTED") {
    showNotification("Only SUBMITTED entries can be graded.", "error");
    return;
  }

  const payload = {};

  if (feedback) {
    payload.feedback = feedback;
  }

  if (scoreRaw) {
    const score = Number(scoreRaw);
    if (!Number.isFinite(score) || score < 0) {
      showNotification("Score must be a non-negative number.", "error");
      return;
    }

    if (maxScoreRaw) {
      const maxScore = Number(maxScoreRaw);
      if (Number.isFinite(maxScore) && score > maxScore) {
        showNotification(
          `Score cannot exceed max score (${maxScore}).`,
          "error",
        );
        return;
      }
    }

    payload.score = score;
  }

  const button = document.getElementById("saveGradeBtn");
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Grading...';
  }

  try {
    await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/activities/${encodeURIComponent(activityId)}/students/${encodeURIComponent(studentUserId)}/grade`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    closeModal("gradeModal");
    showNotification("Submission graded successfully.", "success");

    await loadSubmittedActivities();
    renderActivities();
    renderOverview();
    renderRecentActivity();
    renderSubmissionsModal();
  } catch (error) {
    console.error("Failed to grade submission:", error);
    showNotification(error?.message || "Failed to grade submission.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-check"></i> Submit Grade';
    }
  }
}

async function handleCreateActivity() {
  if (this.disabled) return;
  const title = asString(getInputValue("activityTitle"));
  const description = asString(getInputValue("activityDescription"));
  const dueDate = asString(getInputValue("dueDate"));
  const maxScoreRaw = asString(getInputValue("maxScore"));
  const status = asString(getInputValue("activityStatus"));

  if (!title || !status) {
    showNotification("Title and status are required.", "error");
    return;
  }

  const payload = {
    title,
    description: description || null,
    dueDate: dueDate ? `${dueDate}T23:59:00Z` : null,
    maxScore: null,
    status,
  };

  if (maxScoreRaw) {
    const parsed = Number(maxScoreRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
      showNotification("Max score must be between 0 and 1000.", "error");
      return;
    }
    payload.maxScore = parsed;
  }

  const button = document.getElementById("saveActivityBtn");
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
  }

  try {
    await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/activities`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    closeModal("createActivityModal");
    showNotification("Activity created successfully.", "success");

    await loadActivities();
    renderActivities();
    renderOverview();
    renderRecentActivity();
  } catch (error) {
    console.error("Failed to create activity:", error);
    showNotification(error?.message || "Failed to create activity.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-save"></i> Create Activity';
    }
  }
}

async function handleCreateAnnouncement() {
  const message = asString(getInputValue("announcementMessage"));
  const attachmentsInput = document.getElementById("announcementAttachments");
  const attachments = selectedAnnouncementFiles.length
    ? [...selectedAnnouncementFiles]
    : Array.from(attachmentsInput?.files || []);
  const button = document.getElementById("createAnnouncementBtn");

  if (!message) {
    showNotification("Announcement message is required.", "error");
    return;
  }

  if (message.length > ANNOUNCEMENT_MAX_MESSAGE_LENGTH) {
    showNotification("Announcement message must be 5000 characters or less.", "error");
    return;
  }

  const invalidFiles = getInvalidAnnouncementFiles(attachments);
  if (invalidFiles.length) {
    showNotification(`Unsupported attachment: ${invalidFiles[0].name || "file"}.`, "error");
    return;
  }

  if (!window.ApiClient?.classroom?.createAnnouncement) {
    showNotification("Announcement API is not initialized.", "error");
    return;
  }

  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting...';
  }

  try {
    const result = await window.ApiClient.classroom.createAnnouncement(
      state.classroomId,
      { message },
      attachments,
    );

    resetAnnouncementComposerState();
    closeModal("createAnnouncementModal");
    cacheAnnouncement(state.classroomId, normalizeAnnouncementResponse(result));
    await loadAnnouncements(true);
    showNotification("Announcement posted successfully.", "success");
  } catch (error) {
    console.error("Failed to create announcement:", error);
    showNotification(error?.message || "Failed to post announcement.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-paper-plane"></i> Post Announcement';
    }
  }
}

async function loadAnnouncements(silent = false) {
  const container = document.getElementById("announcementsList");
  if (!container) return [];

  if (!silent) {
    container.innerHTML = `
      <div class="empty-state compact">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading announcements...</p>
      </div>`;
  }

  let announcements = [];
  try {
    const result = await window.ApiClient?.classroom?.listAnnouncements?.(state.classroomId);
    announcements = normalizeAnnouncementCollection(result);
    if (announcements.length) {
      cacheAnnouncements(state.classroomId, announcements);
    }
  } catch (_) {
    announcements = readCachedAnnouncements(state.classroomId);
  }

  if (!announcements.length) {
    announcements = readCachedAnnouncements(state.classroomId);
  }

  state.announcements = announcements;
  renderAnnouncements(container, announcements);
  return announcements;
}

function getAnnouncementById(announcementId) {
  const targetId = asString(announcementId);
  return state.announcements.find(
    (item) => asString(item?.announcementId) === targetId,
  ) || readCachedAnnouncements(state.classroomId).find(
    (item) => asString(item?.announcementId) === targetId,
  ) || null;
}

function resetAnnouncementComposerState() {
  const form = document.getElementById("announcementForm");
  if (form) form.reset();

  selectedAnnouncementFiles = [];
  updateAnnouncementCharCount();
  renderAnnouncementAttachmentList([]);
}

function openEditActivityModal(activityId) {
  const activity = state.activities.find(
    (item) => getActivityId(item) === activityId,
  );
  if (!activity) {
    showNotification("Activity not found.", "error");
    return;
  }

  setInputValue("editActivityId", getActivityId(activity));
  setInputValue("editActivityTitle", asString(activity.title));
  setInputValue("editActivityDescription", asString(activity.description));
  setInputValue(
    "editMaxScore",
    activity.maxScore != null ? String(activity.maxScore) : "",
  );
  setInputValue("editActivityStatus", asString(activity.status) || "PUBLISHED");

  if (activity?.dueDate) {
    const formatted = formatDateInputValue(activity.dueDate);
    if (formatted) {
      setInputValue("editDueDate", formatted);
    } else {
      setInputValue("editDueDate", "");
    }
  } else {
    setInputValue("editDueDate", "");
  }

  openModal("editActivityModal");
}

async function handleEditActivity() {
  if (this.disabled) return;
  const activityId = asString(getInputValue("editActivityId"));
  const title = asString(getInputValue("editActivityTitle"));
  const description = asString(getInputValue("editActivityDescription"));
  const dueDate = asString(getInputValue("editDueDate"));
  const maxScoreRaw = asString(getInputValue("editMaxScore"));
  const status = asString(getInputValue("editActivityStatus"));

  if (!activityId) {
    showNotification("Activity ID is missing.", "error");
    return;
  }

  if (!title || !status) {
    showNotification("Title and status are required.", "error");
    return;
  }

  const payload = {
    title,
    description: description || null,
    dueDate: buildZonedDateTime(dueDate),
    maxScore: null,
    status,
  };

  if (maxScoreRaw) {
    const parsed = Number(maxScoreRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
      showNotification("Max score must be between 0 and 1000.", "error");
      return;
    }
    payload.maxScore = parsed;
  }

  const button = document.getElementById("saveEditActivityBtn");
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }

  try {
    await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/activities/${encodeURIComponent(activityId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    closeModal("editActivityModal");
    showNotification("Activity updated successfully.", "success");

    await loadActivities();
    renderActivities();
    renderOverview();
    renderRecentActivity();

    if (state.currentSubmissionsActivityId === activityId) {
      renderSubmissionsModal();
    }
  } catch (error) {
    console.error("Failed to update activity:", error);
    showNotification(error?.message || "Failed to update activity.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-save"></i> Save Changes';
    }
  }
}

async function deleteActivity(activityId) {
  if (this.disabled) return;
  const confirmMessage =
    "Are you sure you want to delete this activity? This cannot be undone.";
  let approved = false;

  if (window.AppDialog?.confirm) {
    approved = await window.AppDialog.confirm(confirmMessage, {
      title: "Delete Activity",
      confirmText: "Delete",
      danger: true,
    });
  } else {
    approved = window.confirm(confirmMessage);
  }

  if (!approved) return;

  try {
    await apiRequest(
      `/classrooms/${encodeURIComponent(state.classroomId)}/activities/${encodeURIComponent(activityId)}`,
      {
        method: "DELETE",
      },
    );

    showNotification("Activity deleted successfully.", "success");

    await loadActivities();
    await loadSubmittedActivities();
    renderActivities();
    renderOverview();
    renderRecentActivity();

    if (state.currentSubmissionsActivityId === activityId) {
      closeModal("submissionsModal");
      state.currentSubmissionsActivityId = null;
      state.currentSubmissionRows = [];
    }
  } catch (error) {
    console.error("Failed to delete activity:", error);
    showNotification(error?.message || "Failed to delete activity.", "error");
  }
}

function getActivityId(activity) {
  return asString(activity?.activityId || activity?.id);
}

function getActivityTitle(activity) {
  return asString(activity?.title || activity?.name) || "Untitled activity";
}

function getDueInfo(dueDate) {
  if (!dueDate) {
    return { label: "No due date" };
  }

  const parsed = parseApiDate(dueDate);
  if (!parsed) {
    return { label: "Invalid due date" };
  }

  const now = new Date();
  const diffDays = Math.ceil((parsed - now) / (1000 * 60 * 60 * 24));
  const dueText = formatDate(parsed.toISOString());

  if (diffDays < 0) {
    return { label: `${dueText} (Overdue)` };
  }

  if (diffDays === 0) {
    return { label: `${dueText} (Due today)` };
  }

  return {
    label: `${dueText} (${diffDays} day${diffDays === 1 ? "" : "s"} left)`,
  };
}

function statusClass(value) {
  const status = asString(value).toUpperCase();
  if (status === "PENDING") return "pending";
  if (status === "SUBMITTED") return "submitted";
  if (status === "GRADED") return "graded";
  if (status === "DRAFT") return "draft";
  if (status === "PUBLISHED") return "published";
  if (status === "CLOSED") return "closed";
  if (status === "ARCHIVED") return "archived";
  return "none";
}

// ✅ MODAL FUNCTIONS EXACTLY LIKE DASHBOARD
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Reset scroll position BEFORE opening
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) modalContent.scrollTop = 0;

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    document.body.classList.add('modal-open');

    // Focus first input automatically
    setTimeout(() => {
        const firstInput = modal.querySelector('input, textarea, button:not(.close-btn)');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';

        const stillOpen = document.querySelector('.modal.active');
        if (!stillOpen) {
            document.body.classList.remove('modal-open');
        }
    }, 220);

    if (modalId === "editAnnouncementModal") {
      resetAnnouncementEditState();
    } else if (modalId === "createAnnouncementModal") {
      resetAnnouncementComposerState();
    }
}

function showNotification(message, type = "info") {
    // Remove existing notification first
    document.querySelector('.notification')?.remove();

    const note = document.createElement("div");
    note.className = `notification ${type}`;
    note.textContent = message;
    document.body.appendChild(note);

    setTimeout(() => {
        note.style.animation = 'slideOut 0.22s ease-in';
        setTimeout(() => note.remove(), 220);
    }, 3000);
}

function updateAnnouncementCharCount() {
  const message = getInputValue("announcementMessage");
  const counter = document.getElementById("announcementCharCount");
  if (!counter) return;

  counter.textContent = `${message.length} / ${ANNOUNCEMENT_MAX_MESSAGE_LENGTH}`;
  counter.classList.toggle(
    "is-warning",
    message.length > ANNOUNCEMENT_MAX_MESSAGE_LENGTH * 0.9,
  );
}

function getInvalidAnnouncementFiles(files) {
  return files.filter((file) => !isValidAnnouncementFile(file));
}

function getOversizedAnnouncementFiles(files) {
  return files.filter((file) => Number(file?.size) > ANNOUNCEMENT_MAX_FILE_SIZE_BYTES);
}

function getAnnouncementRequestSize(files) {
  return Array.from(files || []).reduce((total, file) => total + Number(file?.size || 0), 0);
}

function isValidAnnouncementFile(file) {
  if (!file) return false;

  const mimeType = asString(file.type).toLowerCase();
  const extension = getFileExtension(file.name);

  return (
    (mimeType && ANNOUNCEMENT_ALLOWED_MIME_TYPES.has(mimeType)) ||
    (extension && ANNOUNCEMENT_ALLOWED_EXTENSIONS.has(extension))
  );
}

function getFileExtension(fileName) {
  const value = asString(fileName).toLowerCase();
  const dotIndex = value.lastIndexOf(".");
  return dotIndex >= 0 ? value.slice(dotIndex + 1) : "";
}

function getAnnouncementFileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function renderAnnouncementAttachmentList(files) {
  const container = document.getElementById("announcementAttachmentList");
  if (!container) return;

  if (!files.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = files
    .map((file) => {
      const type = getAnnouncementFileType(file);
      return `
        <div class="announcement-attachment-item">
          <i class="${escapeHtml(getAnnouncementFileIcon(type))}"></i>
          <button type="button" class="announcement-attachment-remove-btn" data-remove-announcement-file="${escapeHtml(getAnnouncementFileKey(file))}" aria-label="Remove ${escapeHtml(file.name)}" title="Remove file">
            <i class="fas fa-xmark"></i>
          </button>
          <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <small>${escapeHtml(formatAnnouncementFileSize(file.size))}</small>
        </div>
      `;
    })
    .join("");
}

function normalizeAnnouncementCollection(result) {
  if (Array.isArray(result)) return result.map(normalizeAnnouncement).filter(Boolean);
  if (Array.isArray(result?.data)) return result.data.map(normalizeAnnouncement).filter(Boolean);
  if (Array.isArray(result?.content)) return result.content.map(normalizeAnnouncement).filter(Boolean);
  if (Array.isArray(result?.items)) return result.items.map(normalizeAnnouncement).filter(Boolean);
  if (result && typeof result === "object" && result.announcementId) return [normalizeAnnouncement(result)].filter(Boolean);
  return [];
}

function normalizeAnnouncementResponse(result) {
  return normalizeAnnouncementCollection(result)[0] || null;
}

function normalizeAnnouncement(item) {
  if (!item || typeof item !== "object") return null;
  return {
    announcementId: asString(item.announcementId),
    classroomId: asString(item.classroomId),
    authorId: asString(item.authorId),
    message: asString(item.message),
    createdAt: asString(item.createdAt),
    updatedAt: asString(item.updatedAt),
    attachments: Array.isArray(item.attachments)
      ? item.attachments.map(normalizeAttachment).filter(Boolean)
      : [],
  };
}

function normalizeAttachment(item) {
  if (!item || typeof item !== "object") return null;
  return {
    attachmentId: asString(item.attachmentId),
    url: asString(item.url),
    type: asString(item.type),
    resourceType: asString(item.resourceType),
  };
}

function cacheKeyForClassroom(classroomId) {
  return `${ANNOUNCEMENT_CACHE_PREFIX}${asString(classroomId)}`;
}

function readCachedAnnouncements(classroomId) {
  try {
    const raw = localStorage.getItem(cacheKeyForClassroom(classroomId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeAnnouncement).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

function cacheAnnouncements(classroomId, announcements) {
  try {
    localStorage.setItem(cacheKeyForClassroom(classroomId), JSON.stringify(announcements || []));
  } catch (_) {}
}

function cacheAnnouncement(classroomId, announcement) {
  if (!announcement) return;
  const current = readCachedAnnouncements(classroomId);
  const next = [announcement, ...current.filter((item) => item.announcementId !== announcement.announcementId)];
  cacheAnnouncements(classroomId, next);
}

function removeAnnouncementFromCache(classroomId, announcementId) {
  const targetId = asString(announcementId);
  if (!targetId) return;

  const current = readCachedAnnouncements(classroomId);
  const next = current.filter((item) => asString(item?.announcementId) !== targetId);
  cacheAnnouncements(classroomId, next);
}

function renderAnnouncements(container, announcements) {
  if (!announcements.length) {
    container.innerHTML = `
      <div class="empty-state compact">
        <i class="fas fa-bullhorn"></i>
        <p>No announcements posted yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = announcements.map((announcement) => {
    const attachments = Array.isArray(announcement.attachments) ? announcement.attachments : [];
    const hasEditedTimestamp = Boolean(
      announcement.updatedAt &&
      announcement.createdAt &&
      announcement.updatedAt !== announcement.createdAt,
    );
    const message = asString(announcement.message) || "No message provided.";
    return `
      <article class="announcement-item" data-announcement-id="${escapeHtml(announcement.announcementId)}">
        <div class="announcement-item-main">
          <div class="announcement-item-head">
            <div class="announcement-item-title-wrap">
              <div class="announcement-item-title">
                <i class="fas fa-bullhorn"></i>
                <span>Announcement</span>
              </div>
              <div class="announcement-item-meta">
                <span><i class="fas fa-paper-plane"></i> Posted</span>
                ${hasEditedTimestamp ? '<span><i class="fas fa-pen-to-square"></i> Edited</span>' : ''}
              </div>
            </div>
            <div class="announcement-item-actions">
              <button type="button" class="announcement-item-action" data-announcement-action="edit" data-announcement-id="${escapeHtml(announcement.announcementId)}">
                <i class="fas fa-pen-to-square"></i>
                Edit
              </button>
              <button type="button" class="announcement-item-action danger" data-announcement-action="delete" data-announcement-id="${escapeHtml(announcement.announcementId)}">
                <i class="fas fa-trash-can"></i>
                Delete
              </button>
            </div>
          </div>
          <span class="announcement-item-time">${escapeHtml(formatAnnouncementTime(announcement.createdAt))}</span>
          <div class="announcement-item-message">${escapeHtml(message)}</div>
        </div>
        <div class="announcement-item-side">
          <div class="announcement-item-side-label">
            <i class="fas fa-paperclip"></i>
            <span>Attachments</span>
          </div>
          ${attachments.length ? `
            <div class="announcement-item-attachments">
              ${attachments.map((attachment) => renderAnnouncementAttachmentPreview(attachment)).join("")}
            </div>` : `
            <div class="announcement-item-empty-attachments">
              No attachments
            </div>`}
        </div>
      </article>`;
  }).join("");
}

function renderAnnouncementAttachmentPreview(attachment) {
  const type = asString(attachment?.type).toUpperCase();
  const url = asString(attachment?.url);
  const label = getAttachmentLabel(attachment);
  if (!url) return "";

  if (type === "IMAGE") {
    return `
      <a class="announcement-attachment-media announcement-attachment-media-image" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(label)}">
        <span class="announcement-attachment-media-caption">
          <i class="${escapeHtml(getAttachmentIcon(type))}"></i>
          <span>${escapeHtml(label)}</span>
        </span>
      </a>
    `;
  }

  if (type === "VIDEO") {
    return `
      <div class="announcement-attachment-media announcement-attachment-media-video">
        <video controls preload="metadata" src="${escapeHtml(url)}"></video>
        <span class="announcement-attachment-media-caption">
          <i class="${escapeHtml(getAttachmentIcon(type))}"></i>
          <span>${escapeHtml(label)}</span>
        </span>
      </div>
    `;
  }

  return `
    <a class="announcement-attachment-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      <i class="${escapeHtml(getAttachmentIcon(type))}"></i>
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

function resetAnnouncementEditState() {
  state.editingAnnouncementId = null;
  selectedEditAnnouncementFiles = [];
  selectedEditAnnouncementAttachmentIds = new Set();

  const form = document.getElementById("editAnnouncementForm");
  if (form) form.reset();

  const modal = document.getElementById("editAnnouncementModal");
  if (modal) {
    delete modal.dataset.originalMessage;
  }

  updateEditAnnouncementCharCount();
  renderEditAnnouncementAttachmentList([]);
  renderExistingAnnouncementAttachments(null);
}

function updateEditAnnouncementCharCount() {
  const message = asString(getInputValue("editAnnouncementMessage"));
  const counter = document.getElementById("editAnnouncementCharCount");
  if (!counter) return;

  counter.textContent = `${message.length} / ${ANNOUNCEMENT_MAX_MESSAGE_LENGTH}`;
  counter.classList.toggle(
    "is-warning",
    message.length > ANNOUNCEMENT_MAX_MESSAGE_LENGTH * 0.9,
  );
}

function renderExistingAnnouncementAttachments(announcement) {
  const container = document.getElementById("editAnnouncementCurrentAttachments");
  if (!container) return;

  const attachments = Array.isArray(announcement?.attachments) ? announcement.attachments : [];
  if (!attachments.length) {
    container.innerHTML = `
      <div class="announcement-empty-attachments">
        No attachments on this announcement.
      </div>
    `;
    return;
  }

  container.innerHTML = attachments.map((attachment) => `
    <label class="announcement-existing-attachment">
      <input
        type="checkbox"
        data-attachment-id="${escapeHtml(attachment.attachmentId)}"
      >
      <div class="announcement-existing-attachment-main">
        <strong>${escapeHtml(getAttachmentLabel(attachment))}</strong>
        <small>${escapeHtml(attachment.url)}</small>
      </div>
      <span class="announcement-existing-attachment-remove">Remove</span>
    </label>
  `).join("");
}

function renderEditAnnouncementAttachmentList(files) {
  const container = document.getElementById("editAnnouncementAttachmentList");
  if (!container) return;

  if (!files.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = files
    .map((file) => {
      const type = getAnnouncementFileType(file);
      return `
        <div class="announcement-attachment-item">
          <i class="${escapeHtml(getAnnouncementFileIcon(type))}"></i>
          <button type="button" class="announcement-attachment-remove-btn" data-remove-edit-announcement-file="${escapeHtml(getAnnouncementFileKey(file))}" aria-label="Remove ${escapeHtml(file.name)}" title="Remove file">
            <i class="fas fa-xmark"></i>
          </button>
          <span title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <small>${escapeHtml(formatAnnouncementFileSize(file.size))}</small>
        </div>
      `;
    })
    .join("");
}

function formatAnnouncementFileSize(size) {
  const bytes = Number(size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
}

function openEditAnnouncementModal(announcementId) {
  const announcement = getAnnouncementById(announcementId);
  if (!announcement) {
    showNotification("Announcement not found.", "error");
    return;
  }

  state.editingAnnouncementId = announcement.announcementId;
  selectedEditAnnouncementFiles = [];
  selectedEditAnnouncementAttachmentIds = new Set();

  setInputValue("editAnnouncementId", announcement.announcementId);
  setInputValue("editAnnouncementMessage", announcement.message || "");

  const modal = document.getElementById("editAnnouncementModal");
  if (modal) {
    modal.dataset.originalMessage = announcement.message || "";
  }

  const attachmentsInput = document.getElementById("editAnnouncementAttachments");
  if (attachmentsInput) {
    attachmentsInput.value = "";
  }

  updateEditAnnouncementCharCount();
  renderEditAnnouncementAttachmentList([]);
  renderExistingAnnouncementAttachments(announcement);
  openModal("editAnnouncementModal");
}

async function handleEditAnnouncement() {
  const announcementId = asString(getInputValue("editAnnouncementId"));
  const message = asString(getInputValue("editAnnouncementMessage"));
  const attachmentsInput = document.getElementById("editAnnouncementAttachments");
  const newAttachments = selectedEditAnnouncementFiles.length
    ? [...selectedEditAnnouncementFiles]
    : Array.from(attachmentsInput?.files || []);
  const button = document.getElementById("saveEditAnnouncementBtn");
  const modal = document.getElementById("editAnnouncementModal");
  const originalMessage = asString(modal?.dataset?.originalMessage);

  if (!announcementId) {
    showNotification("Announcement ID is missing.", "error");
    return;
  }

  const attachmentIdsToRemove = Array.from(
    document.querySelectorAll("#editAnnouncementCurrentAttachments [data-attachment-id]:checked"),
  ).map((input) => asString(input.getAttribute("data-attachment-id"))).filter(Boolean);

  const messageChanged = message !== originalMessage;
  if (!messageChanged && !newAttachments.length && !attachmentIdsToRemove.length) {
    showNotification("Add a change before saving the announcement.", "error");
    return;
  }

  if (message.length > ANNOUNCEMENT_MAX_MESSAGE_LENGTH) {
    showNotification("Announcement message must be 5000 characters or less.", "error");
    return;
  }

  const invalidFiles = getInvalidAnnouncementFiles(newAttachments);
  if (invalidFiles.length) {
    showNotification(`Unsupported attachment: ${invalidFiles[0].name || "file"}.`, "error");
    return;
  }

  if (!window.ApiClient?.classroom?.editAnnouncement) {
    showNotification("Announcement API is not initialized.", "error");
    return;
  }

  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const payload = {};
    if (messageChanged) {
      payload.message = message;
    }

    await window.ApiClient.classroom.editAnnouncement(
      state.classroomId,
      announcementId,
      payload,
      newAttachments,
      attachmentIdsToRemove,
    );

    closeModal("editAnnouncementModal");
    showNotification("Announcement updated successfully.", "success");
    await loadAnnouncements(true);
  } catch (error) {
    console.error("Failed to update announcement:", error);
    showNotification(error?.message || "Failed to update announcement.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-save"></i> Save Changes';
    }
  }
}

async function handleDeleteAnnouncement(announcementId) {
  const targetId = asString(announcementId);
  if (!targetId) {
    showNotification("Announcement ID is missing.", "error");
    return;
  }

  const announcement = getAnnouncementById(targetId);
  const message = announcement?.message ? announcement.message.slice(0, 120) : "this announcement";
  const confirmed = await window.AppDialog?.confirm?.(
    `Delete ${message}${announcement?.message && announcement.message.length > 120 ? "..." : ""}? This cannot be undone.`,
    {
      title: "Delete Announcement",
      confirmText: "Delete",
      danger: true,
    },
  );

  if (!confirmed) return;

  const button = Array.from(
    document.querySelectorAll('[data-announcement-action="delete"]'),
  ).find((element) => asString(element.getAttribute("data-announcement-id")) === targetId);

  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
  }

  try {
    if (!window.ApiClient?.classroom?.deleteAnnouncement) {
      throw new Error("Announcement API is not initialized.");
    }

    await window.ApiClient.classroom.deleteAnnouncement(state.classroomId, targetId);
    removeAnnouncementFromCache(state.classroomId, targetId);
    state.announcements = state.announcements.filter(
      (item) => asString(item?.announcementId) !== targetId,
    );
    const container = document.getElementById("announcementsList");
    if (container) {
      renderAnnouncements(container, state.announcements);
    }
    showNotification("Announcement deleted successfully.", "success");
    await loadAnnouncements(true);
  } catch (error) {
    console.error("Failed to delete announcement:", error);
    showNotification(error?.message || "Failed to delete announcement.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-trash-can"></i> Delete';
    }
  }
}

function formatAnnouncementTime(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString();
}

function getAttachmentIcon(type) {
  const value = asString(type).toUpperCase();
  if (value === "IMAGE") return "fas fa-image";
  if (value === "VIDEO") return "fas fa-film";
  if (value === "AUDIO") return "fas fa-music";
  return "fas fa-file";
}

function getAttachmentLabel(attachment) {
  const type = asString(attachment?.type).toUpperCase();
  const resourceType = asString(attachment?.resourceType);
  return resourceType || type || "Attachment";
}

function getAnnouncementFileType(file) {
  const mimeType = asString(file?.type).toLowerCase();
  const extension = getFileExtension(file?.name);

  if (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(extension)) return "IMAGE";
  if (mimeType.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(extension)) return "VIDEO";
  if (mimeType.startsWith("audio/") || ["mp3", "wav", "ogg", "aac"].includes(extension)) return "AUDIO";
  return "FILE";
}

function getAnnouncementFileIcon(type) {
  if (type === "IMAGE") return "fas fa-image";
  if (type === "VIDEO") return "fas fa-film";
  if (type === "AUDIO") return "fas fa-music";
  return "fas fa-file-pdf";
}

function asString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function getInitials(name, fallback) {
  const value = asString(name);
  if (!value) return fallback;

  const initials = value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  return initials || fallback;
}

function formatDate(dateString) {
  const date = parseApiDate(dateString);
  if (!date) return "N/A";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateString) {
  const date = parseApiDate(dateString);
  if (!date) return "N/A";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(dateString) {
  const date = parseApiDate(dateString);
  if (!date) return "recently";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function trimProtocol(url) {
  return asString(url).replace(/^https?:\/\//i, "");
}

function parseApiDate(value) {
  const raw = asString(value);
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const withoutZoneRegion = raw.replace(/\[[^\]]+\]$/, "");
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(withoutZoneRegion)
      ? `${withoutZoneRegion}T00:00:00`
      : withoutZoneRegion;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateInputValue(value) {
  const raw = asString(value);
  if (!raw) return "";

  const datePartMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePartMatch) {
    return datePartMatch[1];
  }

  const parsed = parseApiDate(raw);
  if (!parsed) return "";

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildZonedDateTime(value) {
  const raw = asString(value);
  if (!raw) return null;

  if (/\[[^\]]+\]$/.test(raw)) {
    return raw;
  }

  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:00` : raw;
  const parsed = parseApiDate(normalized);
  if (!parsed) {
    return normalized;
  }

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}${ACTIVITY_TIME_ZONE_OFFSET}[${ACTIVITY_TIME_ZONE}]`;
}

async function copyTextWithFeedback(value, successMessage) {
  const text = asString(value);
  if (!text) {
    showNotification("Nothing to copy.", "error");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.setAttribute("readonly", "");
      temp.style.position = "absolute";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
    }

    showNotification(successMessage, "success");
  } catch (error) {
    console.error("Copy failed:", error);
    showNotification("Failed to copy text.", "error");
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value;
}

function getInputValue(id) {
  const element = document.getElementById(id);
  return element ? element.value : "";
}
/** Open a repository review from an eligible grading submission. */
async function validateAndNavigateToAnalyzer(repoUrl, activityTitle, studentName, context = {}) {
  const submissionStatus = asString(context?.submissionStatus).toUpperCase();
  if (!context?.fromGradingProcess) {
    showNotification("Analyzer can only be opened from the grading process.", "warning");
    return false;
  }
  if (submissionStatus === "GRADED") {
    showNotification("Analyzer is locked because this submission is already graded.", "warning");
    return false;
  }
  if (submissionStatus && submissionStatus !== "SUBMITTED") {
    showNotification("Analyzer is only available for submissions awaiting grading.", "warning");
    return false;
  }
  if (!state.classroomId) {
    showNotification("Classroom ID not found. Please reopen the class.", "error");
    return false;
  }
  if (!window.CodeTrackerConfig?.analyzerBaseUrl) {
    showNotification("The code analyzer is currently unavailable. Please try again later.", "error");
    return false;
  }
  try {
    const repository = window.CodeTrackerAnalyzer.normalizeRepositoryUrl(repoUrl);
    proceedToAnalyzer(repository, activityTitle, studentName);
    return true;
  } catch (error) {
    showNotification(error.message || "Invalid GitHub repository URL.", "error");
    return false;
  }
}

function proceedToAnalyzer(repoUrl, activityTitle, studentName) {
  const analysisData = {
    repoUrl,
    activityTitle: activityTitle || "Activity",
    studentName: studentName || "Student",
    classroomId: state.classroomId,
    timestamp: new Date().toISOString(),
    source: "professor_dashboard",
    returnUrl: window.location.href
  };
  // GitHub's public language API was an unreliable gate (private repositories,
  // rate limits, and delayed language detection). The analyzer checks files.
  for (const storageName of ["sessionStorage", "localStorage"]) {
    try {
      window[storageName].setItem("pendingAnalysis", JSON.stringify(analysisData));
      window[storageName].setItem("currentClassroomId", state.classroomId);
    } catch (_) { /* URL parameters still carry the review if storage is blocked. */ }
  }
  const params = new URLSearchParams({
    classroomId: state.classroomId,
    student: analysisData.studentName,
    activity: analysisData.activityTitle,
    repo: repoUrl
  });
  window.location.href = `/Syntax.html?${params}`;
}

/**
 * Helper function to open modal
 */

function renderLoadingSkeleton() {
    const assignments = document.getElementById('assignmentsList');
    const students = document.getElementById('studentsList');
    const activityList = document.getElementById('activityList');

    if (assignments) {
        assignments.innerHTML = Array(3).fill(`
            <div class="assignment-card">
                <div style="height: 18px; width: 60%; margin-bottom: 10px;" class="skeleton"></div>
                <div style="height: 12px; width: 40%; margin-bottom: 14px;" class="skeleton"></div>
                <div style="height: 16px; width: 100%;" class="skeleton"></div>
            </div>
        `).join('');
    }

    if (students) {
        students.innerHTML = Array(5).fill(`
            <div class="student-card">
                <div style="width: 34px; height: 34px; border-radius: 50%;" class="skeleton"></div>
                <div style="flex: 1;">
                    <div style="height: 12px; width: 70%; margin-bottom: 6px;" class="skeleton"></div>
                    <div style="height: 10px; width: 40%;" class="skeleton"></div>
                </div>
            </div>
        `).join('');
    }

    if (activityList) {
        activityList.innerHTML = Array(4).fill(`
            <div class="activity-item">
                <div style="width: 30px; height: 30px; border-radius: 50%;" class="skeleton"></div>
                <div style="flex: 1;">
                    <div style="height: 12px; width: 48%; margin-bottom: 8px;" class="skeleton"></div>
                    <div style="height: 11px; width: 72%; margin-bottom: 8px;" class="skeleton"></div>
                    <div style="height: 10px; width: 38%;" class="skeleton"></div>
                </div>
            </div>
        `).join('');
    }
}
