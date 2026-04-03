const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();
const port = 4000;

// --- Setup ---
const viewsPath = process.env.VERCEL ? path.join(__dirname) : path.join(__dirname, ".");
app.set("view engine", "ejs");
app.set("views", viewsPath);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve background images and static assets from /public folder
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------
// STEP 2 CONCEPT: DRY — Don't Repeat Yourself
//
// Both our page route (/) and our new API route (/api/weather)
// need to fetch weather data. Instead of copy-pasting the same
// code twice, we put it in ONE shared helper function below.
//
// This is called "extracting a function" — a key coding habit.
// ---------------------------------------------------------------

/**
 * fetchWeather(city)
 * ------------------
 * Given a city name string, returns an object with weather data.
 * Throws an error if the city is not found or the API fails.
 *
 * @param {string} city - e.g. "Mumbai" or "London"
 * @returns {object}    - { city, temp, feels, wind, precip, desc, time, forecast[] }
 *
 * forecast[] shape — one entry per day:
 *   { dayName, maxTemp, minTemp, precip, icon }
 */
async function fetchWeather(city) {
  // Step A: Geocoding — city name → lat/lon
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
  const geoRes = await axios.get(geoUrl, { timeout: 10000 });

  if (!geoRes.data.results || geoRes.data.results.length === 0) {
    const err = new Error(`City "${city}" not found`);
    err.notFound = true;
    throw err;
  }

  const { latitude, longitude, name, country } = geoRes.data.results[0];
  const displayCity = `${name}, ${country}`;

  // ---------------------------------------------------------------
  // STEP 4 CONCEPT: Requesting multiple data types in one API call
  //
  // We add TWO new parameters to the URL:
  //   &daily=...   → asks for day-by-day data (one row per day)
  //   &forecast_days=5  → gives us 5 days instead of 1
  //
  // The API will return extra fields inside data.daily:
  //   data.daily.time                       → ["2026-04-03", "2026-04-04", ...]
  //   data.daily.temperature_2m_max         → [38, 35, 33, ...]   (one per day)
  //   data.daily.temperature_2m_min         → [24, 22, 20, ...]
  //   data.daily.precipitation_probability_max → [5, 20, 60, ...]
  //   data.daily.weather_code               → [0, 1, 61, ...]  (WMO codes)
  // ---------------------------------------------------------------
  const weatherUrl = [
    `https://api.open-meteo.com/v1/forecast`,
    `?latitude=${latitude}&longitude=${longitude}`,
    `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m`,
    `&hourly=precipitation_probability`,
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`,
    `&timezone=auto`,
    `&forecast_days=5`,   // ← changed from 1 to 5
  ].join("");

  const weatherRes = await axios.get(weatherUrl, { timeout: 15000 });
  const data = weatherRes.data;

  // timezone is returned by the Open-Meteo weather API, not geocoding
  const timezone = data.timezone || 'UTC';

  // --- Current conditions ---
  const current = data.current;
  const temp = Math.round(current.temperature_2m);
  const feels = Math.round(current.apparent_temperature);
  const wind = Math.round(current.wind_speed_10m);
  const precip = data.hourly.precipitation_probability[0] || 0;

  // Open-Meteo returns current.time in the local timezone (since we use timezone=auto)
  // Format is "YYYY-MM-DDTHH:mm", e.g., "2026-04-03T16:45"
  let localHour = 12;
  let formattedLocalTime = "";
  if (current.time && current.time.includes("T")) {
    const timePart = current.time.split("T")[1];
    const [hStr, mStr] = timePart.split(":");
    
    localHour = parseInt(hStr, 10);
    
    // Format to 12-hour time
    let hour12 = localHour % 12 || 12; 
    const ampm = localHour >= 12 ? 'PM' : 'AM';
    formattedLocalTime = `${hour12}:${mStr} ${ampm}`;
  }

  // ---------------------------------------------------------------
  // STEP 4 CONCEPT: Iterating over an API array with .map()
  //
  // data.daily.time is an array like ["2026-04-03", "2026-04-04"...]
  // .map() loops over each item and transforms it into a new shape.
  // We use the index (i) to read matching values from the other arrays.
  //
  // Day names: JavaScript's Date object can give us "Mon", "Tue" etc.
  // ---------------------------------------------------------------
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const forecast = data.daily.time.map((dateStr, i) => {
    const date = new Date(dateStr);             // "2026-04-03" → Date object
    const dayName = i === 0
      ? "Today"                                   // first day = "Today"
      : DAY_NAMES[date.getDay()];                 // else → "Mon", "Tue" etc.

    const maxTemp = Math.round(data.daily.temperature_2m_max[i]);
    const minTemp = Math.round(data.daily.temperature_2m_min[i]);
    const rainPct = data.daily.precipitation_probability_max[i] || 0;
    const wmoCode = data.daily.weather_code[i];

    return {
      dayName,
      maxTemp,
      minTemp,
      precip: rainPct,
      icon: wmoCodeToIcon(wmoCode),   // convert WMO number → emoji
    };
  });

  return {
    city: displayCity,
    temp,
    feels,
    wind,
    precip,
    weatherCode: current.weather_code,
    localHour,
    localTime: formattedLocalTime,
    timezone,
    desc: getWeatherDesc(temp, precip),
    time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    forecast,
  };
}

// ---------------------------------------------------------------
// NEW ROUTE: GET /api/suggest
// Returns city suggestions for the autocomplete dropdown
// ---------------------------------------------------------------
app.get("/api/suggest", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 2) return res.json({ success: true, results: [] });

    const searchUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
    const response = await axios.get(searchUrl);

    if (!response.data.results) {
      return res.json({ success: true, results: [] });
    }

    const results = response.data.results.map(city => ({
      id: city.id,
      name: city.name,
      admin1: city.admin1 || '',
      country: city.country || ''
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error("Suggest Error:", error.message);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// ---------------------------------------------------------------
// ROUTE 1: GET /
// Returns a full HTML page (same as Step 1)
// ---------------------------------------------------------------
app.get("/", async (req, res) => {
  const city = req.query.city || "Hyderabad";

  try {
    const weather = await fetchWeather(city); // call our shared helper
    res.render("index", { ...weather, error: false });
  } catch (err) {
    console.error("Page Error:", err.message);
    res.status(err.notFound ? 404 : 500).render("index", {
      city,
      temp: "N/A", feels: "N/A", wind: "N/A", precip: "N/A",
      desc: err.notFound ? `City "${city}" not found ❌` : "Error loading weather",
      time: new Date().toLocaleString("en-IN"),
      forecast: [],   // empty array on error — template handles this gracefully
      error: true,
      localHour: 12,           
      localTime: "",           
      timezone: "UTC",         
    });
  }
});

// ---------------------------------------------------------------
// ROUTE 2: GET /api/weather?city=Delhi   ← NEW in Step 2!
//
// This is a REST API endpoint. It does NOT render any HTML.
// Instead it returns raw JSON data — like this:
//
// {
//   "city": "Delhi, India",
//   "temp": 32,
//   "feels": 35,
//   "wind": 14,
//   "precip": 10,
//   "desc": "Hot 🔥",
//   "time": "3/4/2026, 4:30:00 pm"
// }
//
// WHY is this useful?
//   → The frontend JavaScript can call this URL silently
//     (without reloading the page) and update only the parts
//     of the page that changed. This is called AJAX.
//   → Other apps / services can also consume this data.
// ---------------------------------------------------------------
app.get("/api/weather", async (req, res) => {
  const city = req.query.city || "Hyderabad";

  try {
    const weather = await fetchWeather(city);

    // res.json() automatically:
    // 1. Converts the JS object to a JSON string
    // 2. Sets the Content-Type header to "application/json"
    res.json({ success: true, data: weather });

  } catch (err) {
    console.error("API Error:", err.message);

    // Send a JSON error response (NOT HTML)
    res.status(err.notFound ? 404 : 500).json({
      success: false,
      error: err.message,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Helper — converts numbers into a human-readable description
function getWeatherDesc(temp, precip) {
  if (precip > 50) return "Rainy ☔";
  if (temp > 35) return "Hot 🔥";
  if (temp < 20) return "Cool ❄️";
  return "Sunny ☀️";
}

// ---------------------------------------------------------------
// STEP 4: WMO Weather Code → Emoji
//
// Open-Meteo uses WMO standard codes (World Meteorological Org).
// Each number means a specific weather condition.
// We map the most common ones to emojis here.
// Full list: https://open-meteo.com/en/docs#weathervariables
// ---------------------------------------------------------------
function wmoCodeToIcon(code) {
  if (code === 0) return "☀️";   // Clear sky
  if (code <= 3) return "🌤️";   // Partly cloudy
  if (code <= 48) return "🌫️";   // Fog
  if (code <= 55) return "🌦️";   // Drizzle
  if (code <= 65) return "🌧️";   // Rain
  if (code <= 77) return "❄️";   // Snow
  if (code <= 82) return "🌧️";   // Rain showers
  if (code <= 86) return "🌨️";   // Snow showers
  if (code === 95) return "⛈️";   // Thunderstorm
  return "🌡️";                                 // Unknown
}

if (process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;
