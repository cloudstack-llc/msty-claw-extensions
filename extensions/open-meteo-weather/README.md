# Open-Meteo Weather

Lets the assistant look up the current weather for any place name using the free Open-Meteo API.

## What it does

Open-Meteo Weather gives the assistant a way to answer weather questions with live data instead of guessing. When you ask about conditions somewhere, the assistant can fetch the current weather for that place: a short description (clear, overcast, rain, snow, and so on), the temperature, relative humidity, and wind speed. You can get readings in metric (Celsius and km/h) or imperial (Fahrenheit and mph). It uses the public Open-Meteo service, which is free and needs no account or API key.

## Where it shows up

No visible UI. The assistant calls this tool automatically when your message is about current weather somewhere.

## How to use it

Just ask the assistant about the weather in plain language. When the request is about current conditions for a place, the assistant calls the tool, fetches the data, and works the answer into its reply. You don't run anything yourself.

Example asks:
- "What's the weather in Kathmandu right now?"
- "Is it cold in Austin, Texas today? Use Fahrenheit."
- "Current conditions in Reykjavik?"

If you don't say which units you want, the assistant gets metric readings by default.

## Permissions

- `tools.provide`: adds the weather lookup tool so the assistant can call it.
- `network.fetch`: looks up the place's coordinates and current weather from Open-Meteo. Network access is limited to `geocoding-api.open-meteo.com` and `api.open-meteo.com`.

## How it's built

The extension contributes a single additive tool (`contributes.tools`) named `get_weather`, mapped to the command `weather.current`. Its `inputSchema` takes a required `location` string and an optional `units` enum (`metric` or `imperial`).

`activate(msty)` returns a handler whose `run(command, input)` ignores anything other than `weather.current`, then chains two `msty.network.fetch` calls with `responseType: "json"`: first the Open-Meteo geocoding endpoint to resolve the place name to latitude/longitude, then the forecast endpoint with `current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` and the unit params. The result is returned as `{ content, isError? }`, where `content` is the text the assistant reads and `isError` flags failures it should surface.

The code is defensive throughout. `fetchJson` wraps each request in try/catch and reports transport failures (offline, DNS, timeout) as `status: 0`, which `errorMessage` turns into a "check your connection" message versus an HTTP error code. Small coercion helpers (`asObject`, `num`, `str`, `value`) guard against missing or unexpected fields in the API response so a malformed payload yields a friendly message rather than a crash, and `describeWeather` maps WMO weather codes to short readable phrases with an "Unknown conditions" fallback. Each early return produces a clear `isError` result: empty location, place not found, and no current data available.
