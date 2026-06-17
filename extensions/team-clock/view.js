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
        <span class="tc-summary" data-summary>—</span>
        <span class="tc-local">Your time <b data-localtime>—</b></span>
      </header>
      ${
        valid.length
          ? `<div class="tc-grid">${valid.map((z, i) => clockCard(z.zone, i)).join("")}</div>`
          : `<p class="tc-empty">No time zones configured yet. Add time zone names like <code>America/New_York</code> in Settings.</p>`
      }
      ${
        invalid.length
          ? `<p class="tc-note">Not recognized: ${escapeHtml(invalid.map((z) => z.zone).join(", "))}. Use standard time zone names like <code>Europe/Berlin</code>.</p>`
          : ""
      }
    </main>
  `;

  const clocks = valid.map((z, i) => {
    const card = root.querySelector(`[data-i="${i}"]`);
    return {
      zone: z.zone,
      offset: zoneOffsetMs(z.zone, Date.now()),
      lastSec: -1,
      hour: card.querySelector("[data-hour]"),
      min: card.querySelector("[data-min]"),
      sec: card.querySelector("[data-sec]"),
      digital: card.querySelector("[data-digital]"),
      badge: card.querySelector("[data-badge]"),
      face: card.querySelector("[data-face]"),
      phase: card.querySelector("[data-phase]"),
    };
  });

  const summaryEl = root.querySelector("[data-summary]");
  const localEl = root.querySelector("[data-localtime]");
  const reduce = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

  let raf = 0;
  let lastOffsetAt = 0;

  function frame() {
    const nowMs = Date.now();
    if (nowMs - lastOffsetAt > 60000) {
      for (const c of clocks) c.offset = zoneOffsetMs(c.zone, nowMs);
      lastOffsetAt = nowMs;
    }

    let working = 0;
    for (const c of clocks) {
      const wall = nowMs + c.offset;
      const ms = mod(wall, 1000);
      const s = mod(Math.floor(wall / 1000), 60);
      const m = mod(Math.floor(wall / 60000), 60);
      const h = mod(Math.floor(wall / 3600000), 24);
      // Swiss railway "stop-to-go": the second hand sweeps a full turn in
      // ~58.5s, then waits at 12 until the minute ticks over. The minute hand
      // steps once per minute to meet it.
      const t = s + ms / 1000;
      const secAngle = reduce ? s * 6 : Math.min(t / 58.5, 1) * 360;
      c.sec.setAttribute("transform", `rotate(${secAngle} 50 50)`);
      c.min.setAttribute("transform", `rotate(${m * 6} 50 50)`);
      c.hour.setAttribute("transform", `rotate(${(h % 12) * 30 + m * 0.5} 50 50)`);

      const weekday = new Date(wall).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      const isWorking = !weekend && h >= workStart && h < workEnd;
      if (isWorking) working += 1;

      if (s !== c.lastSec) {
        c.lastSec = s;
        c.digital.textContent = digital(h, m);
        const night = h < 6 || h >= 20;
        c.face.classList.toggle("is-night", night);
        c.phase.textContent = night ? "☾" : "☀";
        const kind = weekend ? "weekend" : isWorking ? "working" : "off";
        c.badge.className = `tc-badge tc-badge--${kind === "working" ? "on" : "off"}`;
        c.badge.textContent = kind === "working" ? "Working" : kind === "weekend" ? "Weekend" : "Off hours";
      }
    }

    if (summaryEl) {
      summaryEl.textContent = clocks.length
        ? `${working} of ${clocks.length} ${clocks.length === 1 ? "zone" : "zones"} in working hours`
        : "";
    }
    if (localEl) {
      const now = new Date();
      localEl.textContent = digital(now.getHours(), now.getMinutes());
    }

    raf = requestAnimationFrame(frame);
  }

  frame();
  window.addEventListener("pagehide", () => cancelAnimationFrame(raf), { once: true });
}

function clockCard(zone, index) {
  return `
    <article class="tc-clock" data-i="${index}">
      <div class="tc-face" data-face>
        <svg viewBox="0 0 100 100" class="tc-svg" aria-hidden="true">
          <circle class="tc-dial" cx="50" cy="50" r="49" />
          ${ticks()}
          <g class="tc-hand tc-hand--hour" data-hour><rect x="48.2" y="27" width="3.6" height="26" rx="0.8" /></g>
          <g class="tc-hand tc-hand--min" data-min><rect x="48.75" y="14.5" width="2.5" height="38.5" rx="0.6" /></g>
          <g class="tc-hand tc-hand--sec" data-sec>
            <line x1="50" y1="61" x2="50" y2="25" />
            <circle cx="50" cy="20.5" r="3.7" />
          </g>
          <circle class="tc-cap" cx="50" cy="50" r="1.8" />
        </svg>
        <span class="tc-phase" data-phase aria-hidden="true">☀</span>
      </div>
      <div class="tc-meta">
        <span class="tc-city">${escapeHtml(shortZone(zone))}</span>
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
    const outer = 48.5;
    const inner = hour ? 40.5 : 45.5;
    const x1 = (50 + outer * Math.sin(angle)).toFixed(2);
    const y1 = (50 - outer * Math.cos(angle)).toFixed(2);
    const x2 = (50 + inner * Math.sin(angle)).toFixed(2);
    const y2 = (50 - inner * Math.cos(angle)).toFixed(2);
    out += `<line class="tc-tick${hour ? " tc-tick--hour" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }
  return out;
}

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
