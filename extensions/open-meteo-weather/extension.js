// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
//
// Open-Meteo Weather adds one additive tool the assistant can call:
//   - get_weather: report the current weather for a place name.
//
// The tool chains two public Open-Meteo requests: first it looks up coordinates
// for the place name (geocoding), then it fetches the current conditions for
// those coordinates. Open-Meteo is free and needs no API key, so the only
// permissions are tools.provide and network.fetch.
//
// Each tool call returns { content, isError? }: content is the text shown to the
// assistant, and isError marks a failure the assistant should surface.

/** @typedef {{ content: string, isError?: boolean }} ToolResult */

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  return {
    /**
     * @param {string} command
     * @param {Record<string, unknown>} [input]
     * @returns {Promise<ToolResult | undefined>}
     */
    async run(command, input = {}) {
      if (command !== "weather.current") return undefined;

      const args = asObject(input);
      const location = str(args.location).trim();
      if (!location) return { content: "Provide a location.", isError: true };
      const imperial = args.units === "imperial";

      // Step 1: resolve the place name to coordinates.
      const geo = await fetchJson(msty, `${GEOCODE}?name=${encodeURIComponent(location)}&count=1`);
      if (!geo.ok) {
        return { content: errorMessage("Couldn't look up that location", geo.status), isError: true };
      }
      const results = asObject(geo.json).results;
      const place = asObject(Array.isArray(results) ? results[0] : undefined);
      const latitude = num(place.latitude);
      const longitude = num(place.longitude);
      if (latitude === undefined || longitude === undefined) {
        return { content: `Could not find a place called "${location}".`, isError: true };
      }

      // Step 2: fetch current conditions for the resolved coordinates.
      const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
        temperature_unit: imperial ? "fahrenheit" : "celsius",
        wind_speed_unit: imperial ? "mph" : "kmh",
      });
      const forecast = await fetchJson(msty, `${FORECAST}?${params.toString()}`);
      if (!forecast.ok) {
        return { content: errorMessage("Couldn't load the current weather", forecast.status), isError: true };
      }
      const current = asObject(asObject(forecast.json).current);
      if (Object.keys(current).length === 0) {
        return { content: "No current weather is available for that location.", isError: true };
      }

      const tempUnit = imperial ? "°F" : "°C";
      const windUnit = imperial ? "mph" : "km/h";
      const where = [str(place.name), str(place.admin1), str(place.country)].filter(Boolean).join(", ") || location;
      return {
        content: [
          `Current weather in ${where}:`,
          `- ${describeWeather(current.weather_code)}`,
          `- Temperature: ${value(current.temperature_2m)}${tempUnit}`,
          `- Humidity: ${value(current.relative_humidity_2m)}%`,
          `- Wind: ${value(current.wind_speed_10m)} ${windUnit}`,
        ].join("\n"),
      };
    },
    dispose() {},
  };
}

/**
 * Performs a JSON Open-Meteo request, turning network/timeout failures into a
 * normal response object so callers can return a friendly message instead of
 * throwing. A status of 0 signals a transport failure (offline, DNS, timeout)
 * rather than an HTTP error response.
 * @param {Msty.ExtensionApi} msty
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number, json?: unknown }>}
 */
async function fetchJson(msty, url) {
  try {
    return await msty.network.fetch({ url, responseType: "json" });
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Builds a user-facing error message. A status of 0 means the request never
 * reached Open-Meteo (offline, DNS, or timeout); anything else is an HTTP error.
 */
function errorMessage(action, status) {
  if (status === 0) return `${action}. Check your connection and try again.`;
  return `${action} (error ${status}).`;
}

/** Maps an Open-Meteo weather code to a short, human-readable description. */
function describeWeather(code) {
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Rain showers",
    95: "Thunderstorm",
  };
  return map[num(code) ?? -1] || "Unknown conditions";
}

/** Coerces a finite number, returning undefined for anything else. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Formats a numeric reading for display, falling back to "n/a" when missing. */
function value(input) {
  const n = num(input);
  return n === undefined ? "n/a" : n.toString();
}

/** Coerces a value to a string, returning "" for null/undefined/objects. */
function str(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Returns the value when it is a plain object, otherwise an empty object. */
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, any>} */ (value)
    : {};
}
