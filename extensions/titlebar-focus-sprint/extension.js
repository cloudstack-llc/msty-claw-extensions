// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
// Focus Sprint keeps a local timer in extension storage and exposes it from
// both the title bar and the status bar.

const START_COMMAND = "focus-sprint.toggle";
const STATUS_COMMAND = "focus-sprint.status";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const disposables = [];
  if (typeof msty.ui?.registerTitleBarItem === "function") {
    disposables.push(
      msty.ui.registerTitleBarItem({
        id: "focus_toggle",
        title: "Focus Sprint",
        label: "Focus",
        tooltip: "Start or review a focus sprint",
        badge: "Ready",
        entry: "extension.js",
        command: START_COMMAND,
        priority: 50,
      }),
    );
  }
  if (typeof msty.ui?.registerStatusBarPill === "function") {
    disposables.push(
      msty.ui.registerStatusBarPill({
        id: "focus_status",
        title: "Focus Sprint",
        label: "Focus",
        tooltip: "Check the active sprint",
        badge: "Ready",
        entry: "extension.js",
        command: STATUS_COMMAND,
      }),
    );
  }
  void updateChrome(msty);
  if (typeof setInterval === "function") {
    const timer = setInterval(() => {
      void updateChrome(msty);
    }, 30_000);
    disposables.push(() => clearInterval(timer));
  }

  return {
    async run(command) {
      if (command !== START_COMMAND && command !== STATUS_COMMAND) return undefined;
      const settings = await safeSettings(msty);
      const current = await safeLocalGet(msty, "active_sprint");
      const now = Date.now();
      const minutes = clamp(Number(settings.minutes), 5, 180, 25);
      const label = text(settings.label, "Focus sprint");

      if (command === START_COMMAND && !isActive(current, now)) {
        const sprint = { label, startedAt: now, endsAt: now + minutes * 60000 };
        await safeLocalSet(msty, "active_sprint", sprint);
        await updateChrome(msty);
        return openStatus(msty, sprint, settings, "Sprint started.");
      }

      if (command === START_COMMAND && isActive(current, now)) {
        const result = await openStatus(
          msty,
          current,
          settings,
          "Sprint in progress.",
          [
            { id: "end", label: "End sprint", variant: "secondary" },
          ],
        );
        if (result?.actionId === "end" || result?.action === "end") {
          await safeLocalRemove(msty, "active_sprint");
          await updateChrome(msty);
          return openStopped(msty, current, settings);
        }
        return result;
      }

      await updateChrome(msty);
      return openStatus(msty, current, settings, isActive(current, now) ? "Sprint in progress." : "No active sprint.");
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

async function updateChrome(msty) {
  if (typeof msty.ui?.update !== "function") return;
  const settings = await safeSettings(msty);
  let sprint = await safeLocalGet(msty, "active_sprint");
  const now = Date.now();
  if (sprint && !isActive(sprint, now)) {
    await safeLocalRemove(msty, "active_sprint");
    sprint = undefined;
  }

  const state = chromeState(sprint, settings, now);
  await safeUiUpdate(msty, {
    id: "focus_toggle",
    surface: "titleBar",
    title: "Focus Sprint",
    label: "Focus",
    ...state,
  });
  await safeUiUpdate(msty, {
    id: "focus_status",
    surface: "statusBar",
    title: "Focus Sprint",
    label: "Focus",
    ...state,
  });
}

function chromeState(sprint, settings, now) {
  const label = text(settings.label, "Focus sprint");
  if (isActive(sprint, now)) {
    const remaining = Math.max(1, Math.ceil((sprint.endsAt - now) / 60000));
    return {
      badge: `${remaining}m`,
      tone: remaining <= 5 ? "warning" : "success",
      tooltip: `${remaining} min left in ${sprint.label || label}`,
      disabled: false,
      disabledReason: null,
    };
  }

  return {
    badge: "Ready",
    tone: "default",
    tooltip: `Start a ${clamp(Number(settings.minutes), 5, 180, 25)} min focus sprint`,
    disabled: false,
    disabledReason: null,
  };
}

function openStatus(msty, sprint, settings, headline, actions = []) {
  const now = Date.now();
  const lines = [headline];
  const remaining = isActive(sprint, now)
    ? Math.max(0, Math.ceil((sprint.endsAt - now) / 60000))
    : 0;
  if (isActive(sprint, now)) {
    lines.push(`Label: ${sprint.label || text(settings.label, "Focus sprint")}`);
    lines.push(`Remaining: ${remaining} min`);
    lines.push(`Ends: ${new Date(sprint.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  } else {
    lines.push(`Next sprint: ${clamp(Number(settings.minutes), 5, 180, 25)} min`);
  }
  return msty.ui?.openPopup?.({
    id: "focus_sprint_status",
    title: "Focus Sprint",
    width: "small",
    closeLabel: "Keep going",
    body: lines.join("\n"),
    content: [
      {
        type: "progress",
        title: "Sprint progress",
        label: isActive(sprint, now) ? `${remaining} min left` : "Ready",
        value: isActive(sprint, now) ? sprintProgress(sprint, now) : 0,
        max: 100,
        tone: isActive(sprint, now) ? "success" : "default",
      },
      {
        type: "kv",
        title: "Details",
        items: isActive(sprint, now)
          ? [
              { label: "Label", value: sprint.label || text(settings.label, "Focus sprint") },
              { label: "Remaining", value: `${remaining} min` },
              { label: "Break", value: `${clamp(Number(settings.breakMinutes), 1, 60, 5)} min` },
            ]
          : [
              { label: "Next sprint", value: `${clamp(Number(settings.minutes), 5, 180, 25)} min` },
            ],
      },
    ],
    actions,
  });
}

function openStopped(msty, sprint, settings) {
  return msty.ui?.openPopup?.({
    id: "focus_sprint_done",
    title: "Focus Sprint",
    width: "small",
    closeLabel: "Done",
    body: `Stopped ${sprint.label || text(settings.label, "Focus sprint")}.\nTake ${clamp(Number(settings.breakMinutes), 1, 60, 5)} minutes before starting another sprint.`,
    content: [
      {
        type: "callout",
        title: "Sprint stopped",
        body: `${sprint.label || text(settings.label, "Focus sprint")} ended.`,
        tone: "success",
      },
      {
        type: "stats",
        title: "Next step",
        items: [
          { label: "Break", value: `${clamp(Number(settings.breakMinutes), 1, 60, 5)} min` },
          { label: "Next sprint", value: `${clamp(Number(settings.minutes), 5, 180, 25)} min` },
        ],
      },
    ],
  });
}

function sprintProgress(sprint, now) {
  if (!sprint || typeof sprint.startedAt !== "number" || typeof sprint.endsAt !== "number") return 0;
  const total = Math.max(1, sprint.endsAt - sprint.startedAt);
  return Math.max(0, Math.min(100, Math.round(((now - sprint.startedAt) / total) * 100)));
}

function isActive(sprint, now) {
  return sprint && typeof sprint.endsAt === "number" && sprint.endsAt > now;
}

async function safeSettings(msty) {
  try {
    return (await msty.settings?.get?.()) ?? {};
  } catch {
    return {};
  }
}

async function safeLocalGet(msty, key) {
  try {
    return await msty.storage?.local?.get?.(key);
  } catch {
    return undefined;
  }
}

async function safeLocalSet(msty, key, value) {
  try {
    await msty.storage?.local?.set?.(key, value);
  } catch {
    /* optional storage */
  }
}

async function safeLocalRemove(msty, key) {
  try {
    await msty.storage?.local?.remove?.(key);
  } catch {
    /* optional storage */
  }
}

async function safeUiUpdate(msty, update) {
  try {
    await msty.ui?.update?.(update);
  } catch {
    /* optional dynamic chrome */
  }
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function disposeAll(disposables) {
  while (disposables.length) {
    try {
      disposables.pop()?.();
    } catch {
      /* ignore cleanup errors */
    }
  }
}
