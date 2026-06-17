// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
// Team Clock uses Intl.DateTimeFormat to read the current time in each
// configured time zone, marks who is inside working hours right now, and keeps
// the status bar indicator's count and tone in sync.

const COMMAND = "team-clock.open";

// Used when the user has not configured any time zones yet.
const DEFAULT_ZONES = "America/Los_Angeles, America/New_York, Europe/London, Asia/Kolkata";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  // The slash command and popup are declared statically in the manifest. The
  // status bar indicator is registered at runtime so we can keep its badge count
  // and tone live: we register it here, refresh it, and dispose it on teardown.
  const disposables = [];
  const register = msty.ui?.registerStatusBarPill;
  if (typeof register === "function") {
    const dispose = register.call(msty.ui, {
      id: "pill",
      title: "Team Clock",
      label: "Clock",
      tooltip: "See the team's local times",
      entry: "extension.js",
      command: COMMAND,
    });
    if (typeof dispose === "function") disposables.push(dispose);
  }
  await refreshStatus(msty);

  return {
    async run(command) {
      if (command !== COMMAND) return undefined;
      const settings = await readSettings(msty);
      const report = analyze(settings, new Date());
      await refreshStatus(msty, report);
      // Open the analog-clock view. Pass only `entry` and `context`: providing
      // `body` or `content` would make the host render its own declarative
      // blocks instead of this custom view.
      const request = {
        kind: "popup",
        id: "clock",
        title: "Team Clock",
        width: "medium",
        entry: "view.js",
        context: {
          zones: report.rows.map((row) => row.zone),
          workStart: report.workStart,
          workEnd: report.workEnd,
        },
      };
      if (typeof msty.ui?.openContribution === "function") {
        return msty.ui.openContribution(request);
      }
      return msty.ui?.openPopup?.call(msty.ui, request);
    },
    dispose() {
      while (disposables.length) {
        try {
          disposables.pop()?.();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

async function readSettings(msty) {
  try {
    return (await msty.settings?.get?.()) ?? {};
  } catch {
    return {};
  }
}

// Updates the status bar indicator's badge count and tone. `update()` returns
// void synchronously, so it is never awaited.
async function refreshStatus(msty, report = null) {
  if (typeof msty.ui?.update !== "function") return;
  const nextReport = report ?? analyze(await readSettings(msty), new Date());
  const workingCount = nextReport.working.length;
  const invalidCount = nextReport.invalid.length;
  try {
    msty.ui.update({
      id: "pill",
      surface: "statusBar",
      badge: String(workingCount),
      tone: invalidCount > 0 ? "warning" : workingCount > 0 ? "success" : "default",
      tooltip:
        workingCount > 0
          ? `${workingCount} teammate${workingCount === 1 ? "" : "s"} working now`
          : "No configured teammates are inside working hours",
      entry: "extension.js",
      command: COMMAND,
    });
  } catch {
    /* live updates are best effort */
  }
}

// Splits the configured zones, resolves each one's current local time, and
// buckets them into working / off-hours / unrecognized.
function analyze(settings, now) {
  const configured = String(settings.zones ?? "").trim();
  const zones = (configured || DEFAULT_ZONES)
    .split(",")
    .map((zone) => zone.trim())
    .filter(Boolean);

  const workStart = clampHour(settings.workStart, 9);
  const workEnd = clampHour(settings.workEnd, 17);

  const rows = zones.map((zone) => {
    const info = zoneInfo(zone, now);
    const working = Boolean(
      info && info.weekdayIndex >= 1 && info.weekdayIndex <= 5 && info.hour >= workStart && info.hour < workEnd,
    );
    return { zone, info, working };
  });

  const working = rows.filter((row) => row.info && row.working);
  const off = rows.filter((row) => row.info && !row.working);
  const invalid = rows.filter((row) => !row.info);
  return { configured, rows, working, off, invalid, workStart, workEnd, now };
}

// Resolves a zone's weekday, hour, and a formatted display time. Returns null
// for unrecognized zone names so callers can report them.
function zoneInfo(zone, now) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(now);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
    const weekday = get("weekday");
    const hour24 = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hour12: false })
        .formatToParts(now)
        .find((part) => part.type === "hour")?.value,
    ) % 24;
    return {
      time: `${weekday} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`,
      hour: Number.isFinite(hour24) ? hour24 : 0,
      weekdayIndex: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday),
    };
  } catch {
    return null;
  }
}

function clampHour(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(23, Math.trunc(n)));
}
