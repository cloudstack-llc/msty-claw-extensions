// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import "./view.css";

/**
 * Renders the live analog clocks. The host also passes `msty` and `extension`
 * on the mount context; this view only needs `root` and `context`.
 * @param {Msty.SurfaceMountContext} params
 */
export async function mount({ root, context }) {
  const workStart = clampHour(context?.workStart, 9);
  const workEnd = clampHour(context?.workEnd, 17);
  const rawZones = Array.isArray(context?.zones) ? context.zones : [];
  const zones = rawZones.map((zone) => ({ zone: String(zone), valid: isValidZone(String(zone)) }));
  const valid = zones.filter((z) => z.valid);
  const invalid = zones.filter((z) => !z.valid);

  root.innerHTML = `
    <main class="tc">
      <header class="tc-head">
        <span class="tc-status" data-status>
          <span class="tc-status__dot"></span>
          <span data-summary>—</span>
        </span>
        <span class="tc-local">Your time <b data-localtime>—</b></span>
      </header>
      ${
        invalid.length
          ? `<p class="tc-note">${WARNING_ICON}<span>Not recognized: ${escapeHtml(invalid.map((z) => z.zone).join(", "))}. Use standard time zone names like <code>Europe/Berlin</code>.</span></p>`
          : ""
      }
      ${
        valid.length
          ? `<div class="tc-grid">${valid.map((z, i) => clockCard(z.zone, i)).join("")}</div>`
          : `<div class="tc-empty">${EMPTY_ICON}<span class="tc-empty__title">No time zones yet</span><span class="tc-empty__hint">Add time zone names like <code>America/New_York</code> in Settings.</span></div>`
      }
    </main>
  `;

  const clocks = valid.map((z, i) => {
    const card = root.querySelector(`[data-i="${i}"]`);
    return {
      zone: z.zone,
      offset: zoneOffsetMs(z.zone, Date.now()),
      offsetLabel: "",
      lastSec: -1,
      hour: card.querySelector("[data-hour]"),
      min: card.querySelector("[data-min]"),
      sec: card.querySelector("[data-sec]"),
      digital: card.querySelector("[data-digital]"),
      badge: card.querySelector("[data-badge]"),
      face: card.querySelector("[data-face]"),
      offsetEl: card.querySelector("[data-offset]"),
    };
  });

  const statusEl = root.querySelector("[data-status]");
  const summaryEl = root.querySelector("[data-summary]");
  const localEl = root.querySelector("[data-localtime]");
  const reduce = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  // The viewer's own UTC offset in hours (getTimezoneOffset is inverted).
  const userOffsetHours = -new Date().getTimezoneOffset() / 60;

  let raf = 0;
  let lastOffsetAt = 0;
  let globalLastSec = -1;
  let running = false;

  function frame() {
    const nowMs = Date.now();
    let working = 0;

    // Refresh each zone's wall-clock offset (and its offset label) once a
    // minute so DST stays correct without re-running Intl every frame.
    if (nowMs - lastOffsetAt > 60000) {
      for (const c of clocks) c.offset = zoneOffsetMs(c.zone, nowMs);
      lastOffsetAt = nowMs;
    }

    for (const c of clocks) {
      const wall = nowMs + c.offset;
      const ms = mod(wall, 1000);
      const s = mod(Math.floor(wall / 1000), 60);
      const m = mod(Math.floor(wall / 60000), 60);
      const h = mod(Math.floor(wall / 3600000), 24);

      // Swiss railway "stop-to-go": the second hand sweeps a full turn in
      // ~58.5s, then waits at 12 until the minute ticks over. Clamping at
      // 360° (= the 0°/12 position) makes the rollover seamless — there is no
      // visible snap because the parked and restart positions coincide.
      if (!reduce) {
        const t = s + ms / 1000;
        const secAngle = Math.min(t / 58.5, 1) * 360;
        c.sec.setAttribute("transform", `rotate(${secAngle % 360} 50 50)`);
      }

      const weekday = new Date(wall).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      const isWorking = !weekend && h >= workStart && h < workEnd;
      if (isWorking) working += 1;

      // Per-second work: everything that only changes when the second ticks.
      if (s !== c.lastSec) {
        c.lastSec = s;
        if (reduce) c.sec.setAttribute("transform", `rotate(${s * 6} 50 50)`);
        c.min.setAttribute("transform", `rotate(${m * 6} 50 50)`);
        c.hour.setAttribute("transform", `rotate(${(h % 12) * 30 + m * 0.5} 50 50)`);

        c.digital.textContent = digital(h, m);
        const night = h < 6 || h >= 20;
        c.face.classList.toggle("is-night", night);

        const cls = isWorking ? "on" : weekend ? "weekend" : "off";
        c.badge.className = `tc-badge tc-badge--${cls}`;
        c.badge.textContent = isWorking ? "Working" : weekend ? "Weekend" : "Off hours";

        // Offset label only changes on the 60s DST refresh; write when it does.
        const label = formatOffset(c.offset / 3600000 - userOffsetHours);
        if (label !== c.offsetLabel) {
          c.offsetLabel = label;
          c.offsetEl.textContent = label;
          c.offsetEl.title = `UTC${formatUtc(c.offset / 3600000)}`;
        }
      }
    }

    // Header updates batched to once per second.
    if (globalLastSec !== Math.floor(nowMs / 1000)) {
      globalLastSec = Math.floor(nowMs / 1000);
      if (summaryEl) {
        summaryEl.textContent = clocks.length
          ? `${working} of ${clocks.length} ${clocks.length === 1 ? "zone" : "zones"} working`
          : "No zones configured";
      }
      if (statusEl) statusEl.classList.toggle("tc-status--on", working > 0);
      if (localEl) {
        const now = new Date();
        localEl.textContent = digital(now.getHours(), now.getMinutes());
      }
    }

    if (document.visibilityState === "visible") {
      raf = requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  start();

  // Pause the loop while the popup webview is hidden (it can stay alive in the
  // background); resume on re-show. `pagehide` is the hard teardown.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") start();
    else stop();
  });
  window.addEventListener("pagehide", stop, { once: true });
}

function clockCard(zone, index) {
  return `
    <article class="tc-clock" data-i="${index}" style="--tc-i:${index}">
      <div class="tc-face" data-face>
        <svg viewBox="0 0 100 100" class="tc-svg" aria-hidden="true">
          <defs>
            <radialGradient id="tc-dial-grad-${index}" cx="50%" cy="36%" r="68%">
              <stop offset="0%" stop-color="var(--tc-dial-day-hi)" />
              <stop offset="100%" stop-color="var(--tc-dial-day)" />
            </radialGradient>
          </defs>
          <circle class="tc-dial" cx="50" cy="50" r="48" fill="url(#tc-dial-grad-${index})" />
          <circle class="tc-bezel" cx="50" cy="50" r="45.5" />
          ${ticks()}
          ${numerals()}
          <g class="tc-hand tc-hand--hour" data-hour><rect x="48.1" y="27" width="3.8" height="26" rx="1.2" /></g>
          <g class="tc-hand tc-hand--min" data-min><rect x="48.7" y="14.5" width="2.6" height="38.5" rx="0.8" /></g>
          <g class="tc-hand tc-hand--sec" data-sec>
            <line x1="50" y1="64" x2="50" y2="22" />
            <circle cx="50" cy="18" r="3.4" />
          </g>
          <circle class="tc-cap-outer" cx="50" cy="50" r="3" />
          <circle class="tc-cap-inner" cx="50" cy="50" r="1.4" />
        </svg>
      </div>
      <div class="tc-meta">
        <span class="tc-city">${escapeHtml(shortZone(zone))}</span>
        <span class="tc-offset" data-offset title="">—</span>
        <span class="tc-digital" data-digital>—</span>
        <span class="tc-badge tc-badge--off" data-badge>Off hours</span>
      </div>
    </article>
  `;
}

function ticks() {
  let out = "";
  for (let i = 0; i < 60; i += 1) {
    const angle = (i * 6 * Math.PI) / 180;
    const hour = i % 5 === 0;
    const outer = 43;
    const inner = hour ? 39 : 41.5;
    const x1 = (50 + outer * Math.sin(angle)).toFixed(2);
    const y1 = (50 - outer * Math.cos(angle)).toFixed(2);
    const x2 = (50 + inner * Math.sin(angle)).toFixed(2);
    const y2 = (50 - inner * Math.cos(angle)).toFixed(2);
    out += `<line class="tc-tick${hour ? " tc-tick--hour" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }
  return out;
}

// 12 / 3 / 6 / 9 only — classic watch markers without crowding the small dial.
function numerals() {
  const pos = [
    { n: 12, x: 50, y: 22 },
    { n: 3, x: 78, y: 50 },
    { n: 6, x: 50, y: 78 },
    { n: 9, x: 22, y: 50 },
  ];
  return pos.map((p) => `<text class="tc-numeral" x="${p.x}" y="${p.y}">${p.n}</text>`).join("");
}

const WARNING_ICON = `<svg class="tc-note__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const EMPTY_ICON = `<svg class="tc-empty__glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Milliseconds to add to real UTC `now` to get the zone's wall-clock time,
// treated as if it were UTC. Recomputed periodically so DST stays correct.
function zoneOffsetMs(zone, nowMs) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(nowMs));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return asUtc - nowMs;
  } catch {
    return 0;
  }
}

// Relative offset from the viewer, e.g. -3, +5:30. Always shows a sign.
function formatOffset(diffHours) {
  const sign = diffHours >= 0 ? "+" : "−";
  const abs = Math.abs(diffHours);
  const whole = Math.floor(abs + 0.0001);
  const mins = Math.round((abs - whole) * 60);
  if (mins === 0) return `${sign}${whole}h`;
  return `${sign}${whole}:${String(mins).padStart(2, "0")}`;
}

// Absolute UTC offset for the tooltip, e.g. UTC-5, UTC+5:30.
function formatUtc(offsetHours) {
  const sign = offsetHours >= 0 ? "+" : "−";
  const abs = Math.abs(offsetHours);
  const whole = Math.floor(abs + 0.0001);
  const mins = Math.round((abs - whole) * 60);
  if (mins === 0) return `${sign}${whole}`;
  return `${sign}${whole}:${String(mins).padStart(2, "0")}`;
}

function digital(hour, minute) {
  const hr = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${hr}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function shortZone(zone) {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

function clampHour(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(23, Math.trunc(n)));
}

function mod(value, n) {
  return ((value % n) + n) % n;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
