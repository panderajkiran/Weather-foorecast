const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const app = express();
const port = 4000;

// Set EJS as view engine with proper path resolution for Vercel
const viewsPath = process.env.VERCEL
  ? path.join(__dirname)
  : path.join(__dirname, ".");
app.set("view engine", "ejs");
app.set("views", viewsPath);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
  try {
    // Open-Meteo API: Hyderabad coords (no key needed) [web:24][web:5]
    const weatherUrl =
      "https://api.open-meteo.com/v1/forecast?latitude=17.3871&longitude=78.4917&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=precipitation_probability&timezone=Asia/Kolkata&forecast_days=1";

    const weatherRes = await axios.get(weatherUrl, { timeout: 15000 });
    const data = weatherRes.data;

    const current = data.current;
    const temp = Math.round(current.temperature_2m);
    const feels = Math.round(current.apparent_temperature);
    const wind = Math.round(current.wind_speed_10m);
    const precip = data.hourly.precipitation_probability[0] || 0;

    res.render("index", {
      temp,
      feels,
      wind,
      desc: getWeatherDesc(temp, precip),
      time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    });
  } catch (err) {
    console.error("Weather API Error:", err.message || err);
    res.status(500).render("index", {
      temp: "N/A",
      feels: "N/A",
      wind: "N/A",
      desc: "Error loading weather",
      time: new Date().toLocaleString("en-IN"),
    });
  }
});

// Health check endpoint for Vercel monitoring
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

function getWeatherDesc(temp, precip) {
  if (precip > 50) return "Rainy ☔";
  if (temp > 35) return "Hot 🔥";
  if (temp < 20) return "Cool ❄️";
  return "Sunny ☀️";
}

if (process.env.VERCEL !== "1") {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;
