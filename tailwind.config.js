module.exports = {
  content: [
    "./index.html",
    "./viewer.html",
    "./pages/**/*.html",
    "./scripts/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        "lfu-surface": "#faf9fa",
        "lfu-surface-low": "#f4f3f4",
        "lfu-surface-card": "#ffffff",
        "lfu-primary": "#78555e",
        "lfu-primary-soft": "#ffd1dc",
        "lfu-secondary-soft": "#e6d6ff",
        "lfu-tertiary-soft": "#e8dea4",
        "lfu-ink": "#1a1c1d",
        "lfu-muted": "#675b7e",
        "lfu-outline": "#817476"
      },
      fontFamily: {
        headline: ["Plus Jakarta Sans", "sans-serif"],
        body: ["Manrope", "sans-serif"]
      },
      boxShadow: {
        haze: "0 28px 50px rgba(26, 28, 29, 0.10)",
        soft: "0 16px 32px rgba(26, 28, 29, 0.08)"
      },
      animation: {
        float: "lfuFloat 18s ease-in-out infinite",
        pulseSoft: "lfuPulse 2.2s ease-in-out infinite"
      },
      keyframes: {
        lfuFloat: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(0, -18px, 0) scale(1.04)" }
        },
        lfuPulse: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" }
        }
      }
    }
  },
  plugins: [
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
    require("@tailwindcss/container-queries")
  ]
};
