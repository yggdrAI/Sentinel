/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090d",
          900: "#0c1017",
          850: "#111722",
          800: "#161e2b",
          700: "#1e293b",
          600: "#334155",
        },
        mist: {
          100: "#e8eef7",
          200: "#c5d0e0",
          300: "#8b9bb3",
          400: "#64748b",
        },
        signal: {
          live: "#3dffa8",
          warn: "#f5b942",
          crit: "#ff5c5c",
          info: "#5b9cff",
          accent: "#7dd3c7",
        },
      },
      fontFamily: {
        display: ['"Instrument Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(125, 211, 199, 0.08), 0 20px 50px rgba(0,0,0,0.35)",
      },
      keyframes: {
        pulseLive: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseLive: "pulseLive 1.6s ease-in-out infinite",
        fadeUp: "fadeUp 0.35s ease-out",
      },
    },
  },
  plugins: [],
};
