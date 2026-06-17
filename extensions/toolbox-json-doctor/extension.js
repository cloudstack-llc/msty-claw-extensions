// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
// JSON Doctor parses configured JSON from pasted text, a fetched URL, or a
// user-selected local file, then reports shape problems and can save a report.

const COMMAND = "json-doctor.inspect";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const disposables = [];
  if (typeof msty.ui?.registerToolboxItem === "function") {
    disposables.push(
      msty.ui.registerToolboxItem({
        id: "json_doctor",
        title: "JSON Doctor",
        label: "JSON",
        tooltip: "Validate configured JSON",
        entry: "extension.js",
        command: COMMAND,
        priority: 35,
      }),
    );
  }

  return {
    async run(command) {
      if (command !== COMMAND) return undefined;
      const settings = await safeSettings(msty);
      await safeLog(msty, "info", "JSON Doctor started", {
        source: sourceMode(settings),
      });
      const source = await loadJsonSource(msty, settings);
      const report = source.error
        ? {
            ok: false,
            source,
            summary: "JSON source could not be loaded.",
            details: [source.error],
          }
        : inspectJson(source, settings);
      const exportResult = await maybeSaveReport(msty, report, settings);
      if (exportResult) report.exportResult = exportResult;
      await safeLog(msty, report.ok ? "info" : "warn", "JSON validation finished", {
        ok: report.ok,
        source: report.source.kind,
        detailCount: report.details.length,
        exportStatus: exportResult?.status,
      });
      await safeLocalSet(msty, "last_result", {
        ok: report.ok,
        checkedAt: new Date().toISOString(),
        summary: report.summary,
        source: report.source.label,
        exportStatus: exportResult?.status,
      });
      return msty.ui?.openDrawer?.({
        id: "json_doctor_report",
        title: "JSON Doctor",
        width: "medium",
        content: buildContent(report),
      });
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

async function loadJsonSource(msty, settings) {
  const mode = sourceMode(settings);
  if (mode === "file") return loadJsonFile(msty, settings);
  if (mode !== "url") {
    return {
      kind: "pasted",
      label: "Pasted JSON",
      text: text(settings.jsonText, "{}"),
    };
  }

  const url = text(settings.jsonUrl, "");
  if (!url) {
    return {
      kind: "url",
      label: "JSON URL",
      text: "",
      error: "Enter a JSON URL in settings or switch Source to Pasted.",
    };
  }

  try {
    const allowed = await ensurePermission(
      msty,
      "network.fetch",
      "Fetch the JSON URL you configured.",
    );
    if (!allowed) {
      return {
        kind: "url",
        label: url,
        text: "",
        error: "Grant network access in Extensions to fetch the JSON URL, then try again.",
      };
    }
    const token = await readSecret(msty, "apiToken");
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await msty.network?.fetch?.({
      url,
      headers,
      responseType: "json",
      maxBytes: maxBytes(settings),
    });
    if (!response?.ok) {
      await safeLog(msty, "warn", "JSON request returned a non-success status", {
        url,
        status: response?.status || 0,
      });
      return {
        kind: "url",
        label: url,
        text: "",
        status: response?.status,
        error: `Request returned ${response?.status || "no status"}.`,
      };
    }
    await safeLog(msty, "info", "Fetched JSON source", {
      url: response.url || url,
      status: response.status,
      bytes: response.text?.length || 0,
    });
    return {
      kind: "url",
      label: response.url || url,
      text: response.text || "",
      status: response.status,
    };
  } catch (error) {
    await safeLog(msty, "error", "JSON request failed", {
      url,
      message: errorMessage(error),
    });
    return {
      kind: "url",
      label: url,
      text: "",
      error: errorMessage(error),
    };
  }
}

async function loadJsonFile(msty, settings) {
  try {
    if (typeof msty.resources?.pickFile !== "function" || typeof msty.resources?.readText !== "function") {
      return {
        kind: "file",
        label: "Local file",
        text: "",
        error: "Local file access is not available in this version of Msty Claw.",
      };
    }
    const allowed = await ensurePermission(
      msty,
      "files.read",
      "Choose and read the local JSON file you want to validate.",
    );
    if (!allowed) {
      return {
        kind: "file",
        label: "Local file",
        text: "",
        error: "Grant file access in Extensions to choose a JSON file, then try again.",
      };
    }
    const picked = await msty.resources.pickFile({
      title: "Choose JSON file",
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "Text", extensions: ["txt"] },
      ],
    });
    const file = picked?.resources?.[0];
    if (!file || picked.cancelled) {
      return {
        kind: "file",
        label: "Local file",
        text: "",
        error: "No file selected.",
      };
    }
    const result = await msty.resources.readText({
      path: file.path,
      maxBytes: maxBytes(settings),
    });
    await safeLog(msty, "info", "Read local JSON source", {
      name: result.name || file.name,
      bytes: result.bytesRead,
      truncated: result.truncated,
    });
    return {
      kind: "file",
      label: result.name || file.name,
      text: result.text || "",
      truncated: result.truncated === true,
    };
  } catch (error) {
    await safeLog(msty, "error", "Local JSON file could not be read", {
      message: errorMessage(error),
    });
    return {
      kind: "file",
      label: "Local file",
      text: "",
      error: errorMessage(error),
    };
  }
}

async function maybeSaveReport(msty, report, settings) {
  if (settings.saveReport !== true) return null;
  if (typeof msty.resources?.saveJson !== "function") {
    return {
      status: "unavailable",
      detail: "Saving reports is not available in this version of Msty Claw.",
    };
  }

  const allowed = await ensurePermission(
    msty,
    "files.write",
    "Save the JSON Doctor report you requested.",
  );
  if (!allowed) {
    return {
      status: "needs_permission",
      detail: "Grant file saving in Extensions to save the report, then run JSON Doctor again.",
    };
  }

  try {
    const saved = await msty.resources.saveJson({
      title: "Save JSON Doctor report",
      defaultPath: "json-doctor-report.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      value: reportExportPayload(report),
      pretty: 2,
    });

    if (saved?.cancelled) {
      return {
        status: "cancelled",
        detail: "Report was not saved.",
        bytesWritten: 0,
      };
    }

    const name = saved?.resource?.name || "report file";
    await safeLog(msty, "info", "Saved JSON Doctor report", {
      name,
      bytesWritten: saved?.bytesWritten || 0,
    });
    return {
      status: "saved",
      detail: `Saved ${name}.`,
      name,
      bytesWritten: saved?.bytesWritten || 0,
    };
  } catch (error) {
    await safeLog(msty, "error", "JSON Doctor report could not be saved", {
      message: errorMessage(error),
    });
    return {
      status: "failed",
      detail: `Report could not be saved: ${errorMessage(error)}`,
    };
  }
}

async function ensurePermission(msty, permission, reason) {
  try {
    if (typeof msty.permissions?.ensure !== "function") return true;
    const result = await msty.permissions.ensure({
      permissions: [permission],
      reason,
      openReview: true,
    });
    return result?.ok !== false;
  } catch {
    return false;
  }
}

async function safeLog(msty, level, message, data) {
  try {
    await msty.diagnostics?.[level]?.(message, data);
  } catch {
    /* diagnostics should never block the tool */
  }
}

async function readSecret(msty, key) {
  try {
    return (await msty.secrets?.get?.(key)) || "";
  } catch {
    return "";
  }
}

function maxBytes(settings) {
  const kb = Number(settings.maxBytesKb || 500);
  const clampedKb = Math.max(50, Math.min(2000, Number.isFinite(kb) ? kb : 500));
  return Math.trunc(clampedKb) * 1024;
}

function sourceMode(settings) {
  const configured = text(settings.sourceMode, "");
  if (configured === "url" || configured === "file" || configured === "pasted") return configured;
  return text(settings.jsonUrl, "") ? "url" : "pasted";
}

function inspectJson(source, settings) {
  const raw = source.text || "{}";
  const required = text(settings.requiredKeys, "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const expectObject = settings.expectObject !== false;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const parseError = describeJsonParseError(error, raw);
    return {
      ok: false,
      source,
      summary: "Invalid JSON",
      details: [
        `Parse error: ${parseError.message}`,
        ...(parseError.location ? [parseLocationDetail(parseError.location)] : []),
        `Characters checked: ${raw.length}`,
        ...(source.truncated ? ["Source was truncated at the configured read limit."] : []),
      ],
      parseError,
    };
  }

  // Track pass/fail from the checks themselves, not by re-reading the detail
  // strings. This keeps the result correct even when a key or value contains
  // words like "Missing" that the messages also use.
  let hasProblem = false;
  const details = [];
  if (source.truncated) details.push("Source was truncated at the configured read limit.");

  const isObject = parsed && typeof parsed === "object" && !Array.isArray(parsed);
  if (expectObject && !isObject) {
    details.push("Top-level value is not an object.");
    hasProblem = true;
  }

  if (isObject) {
    const keys = Object.keys(parsed);
    details.push(`Top-level keys: ${keys.length ? keys.join(", ") : "(none)"}`);
    const missing = required.filter((key) => !(key in parsed));
    if (missing.length) {
      details.push(`Missing required keys: ${missing.join(", ")}`);
      hasProblem = true;
    }
  }

  if (Array.isArray(parsed)) details.push(`Top-level array length: ${parsed.length}`);

  const ok = !hasProblem;
  return {
    ok,
    source,
    summary: ok ? "JSON looks valid for this check." : "JSON parsed, but shape checks need attention.",
    details,
  };
}

function reportExportPayload(report) {
  const sourceText = String(report.source.text || "");
  const source = {
    kind: report.source.kind,
    label: report.source.label,
    ...(report.source.status !== undefined ? { status: report.source.status } : {}),
    truncated: report.source.truncated === true,
    characters: sourceText.length,
  };

  return {
    checkedAt: new Date().toISOString(),
    ok: report.ok,
    summary: report.summary,
    details: report.details,
    source,
    sourcePreview: reportSourcePreview(report, 4000),
    ...(report.parseError
      ? {
          parseError: {
            message: report.parseError.message,
            ...(report.parseError.location ? { location: report.parseError.location } : {}),
            context: report.parseError.preview,
          },
        }
      : {}),
  };
}

function buildContent(report) {
  return [
    {
      type: "stats",
      title: "Validation",
      items: [
        {
          label: "Status",
          value: report.ok ? "Pass" : "Review",
          tone: report.ok ? "success" : "warning",
        },
        {
          label: "Source",
          value: sourceKindLabel(report.source.kind),
        },
        {
          label: "Bytes",
          value: String(report.source.text?.length || 0),
        },
      ],
    },
    {
      type: "progress",
      title: "Readiness",
      label: report.ok ? "Ready" : "Needs review",
      value: report.ok ? 100 : 45,
      max: 100,
      description: report.ok
        ? "The configured JSON passed the selected shape checks."
        : "The JSON needs attention before it should be trusted.",
      tone: report.ok ? "success" : "warning",
    },
    {
      type: "kv",
      title: "Source",
      items: [
        { label: "Location", value: report.source.label },
        ...(report.source.status
          ? [{ label: "HTTP status", value: String(report.source.status) }]
          : []),
        ...(report.source.truncated
          ? [{ label: "Read limit", value: "Source was truncated" }]
          : []),
      ],
    },
    {
      type: "callout",
      title: report.summary,
      tone: report.ok ? "success" : "warning",
    },
    ...(report.exportResult
      ? [
          {
            type: "callout",
            title: exportTitle(report.exportResult.status),
            body: report.exportResult.detail,
            tone: report.exportResult.status === "saved" ? "success" : "warning",
          },
        ]
      : []),
    {
      type: "list",
      title: "Details",
      items: report.details.map((line) => ({ title: line })),
    },
    ...(report.source.text
      ? [
          {
            type: "code",
            title: report.parseError ? "Source preview near error" : "Source preview",
            language: "json",
            code: reportSourcePreview(report),
            wrap: true,
          },
        ]
      : []),
  ];
}

function exportTitle(status) {
  if (status === "saved") return "Report saved";
  if (status === "cancelled") return "Report not saved";
  if (status === "needs_permission") return "Review file saving";
  if (status === "unavailable") return "Saving unavailable";
  return "Report export failed";
}

async function safeSettings(msty) {
  try {
    return (await msty.settings?.get?.()) ?? {};
  } catch {
    return {};
  }
}

async function safeLocalSet(msty, key, value) {
  try {
    await msty.storage?.local?.set?.(key, value);
  } catch {
    /* ignore optional storage failure */
  }
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sourceKindLabel(kind) {
  if (kind === "url") return "URL";
  if (kind === "file") return "Local file";
  return "Pasted text";
}

function errorMessage(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}

function describeJsonParseError(error, sourceText) {
  const message = errorMessage(error);
  const location = parseJsonErrorLocation(message, sourceText);
  return {
    message,
    ...(location ? { location } : {}),
    preview: location ? focusedErrorPreview(sourceText, location) : previewText(sourceText),
  };
}

function parseJsonErrorLocation(message, sourceText) {
  const positionMatch = String(message).match(/\bposition\s+(\d+)\b/i);
  const lineColumnMatch = String(message).match(/\bline\s+(\d+)\s+column\s+(\d+)\b/i);
  const parsedPosition = positionMatch ? Number(positionMatch[1]) : NaN;
  const position = Number.isFinite(parsedPosition)
    ? Math.max(0, Math.min(sourceText.length, Math.trunc(parsedPosition)))
    : null;

  if (lineColumnMatch) {
    const line = Math.max(1, Math.trunc(Number(lineColumnMatch[1])));
    const column = Math.max(1, Math.trunc(Number(lineColumnMatch[2])));
    return {
      ...(position !== null ? { position } : {}),
      line,
      column,
    };
  }

  if (position !== null) {
    return {
      position,
      ...lineColumnFromPosition(sourceText, position),
    };
  }

  return null;
}

function lineColumnFromPosition(sourceText, position) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < position; index += 1) {
    const char = sourceText[index];
    if (char === "\r") {
      line += 1;
      column = 1;
      if (sourceText[index + 1] === "\n") index += 1;
    } else if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function parseLocationDetail(location) {
  const character = typeof location.position === "number" ? ` (character ${location.position})` : "";
  return `Error location: line ${location.line}, column ${location.column}${character}.`;
}

function focusedErrorPreview(sourceText, location) {
  const lines = String(sourceText || "").split(/\r\n|\n|\r/);
  const lineIndex = Math.max(0, Math.min(lines.length - 1, Number(location.line || 1) - 1));
  const lineNumber = lineIndex + 1;
  const sourceLine = lines[lineIndex] || "";
  const column = Math.max(1, Number(location.column || 1));
  const contextRadius = 2;
  const firstLine = Math.max(0, lineIndex - contextRadius);
  const lastLine = Math.min(lines.length - 1, lineIndex + contextRadius);
  const width = String(lastLine + 1).length;
  const output = [];

  for (let index = firstLine; index <= lastLine; index += 1) {
    if (index === lineIndex) {
      const windowed = windowLineAroundColumn(sourceLine, column, 240);
      const prefix = `${String(lineNumber).padStart(width, " ")} | `;
      output.push(`${prefix}${windowed.text}`);
      output.push(`${" ".repeat(prefix.length + windowed.caretOffset)}^`);
      continue;
    }
    output.push(`${String(index + 1).padStart(width, " ")} | ${previewSingleLine(lines[index], 240)}`);
  }

  return output.join("\n");
}

function windowLineAroundColumn(line, column, maxLength) {
  const target = Math.max(0, column - 1);
  if (line.length <= maxLength) {
    return {
      text: line,
      caretOffset: Math.min(target, line.length),
    };
  }

  const half = Math.floor(maxLength / 2);
  let start = Math.max(0, target - half);
  let end = Math.min(line.length, start + maxLength);
  start = Math.max(0, end - maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";
  return {
    text: `${prefix}${line.slice(start, end)}${suffix}`,
    caretOffset: prefix.length + Math.max(0, Math.min(target - start, end - start)),
  };
}

function previewSingleLine(line, maxLength) {
  return line.length > maxLength ? `${line.slice(0, maxLength)}...` : line;
}

function reportSourcePreview(report, maxLength = 2000) {
  return report.parseError?.preview || previewText(report.source.text, maxLength);
}

function previewText(value, maxLength = 2000) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
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
