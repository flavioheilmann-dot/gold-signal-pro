import tailwindcssAnimate from "tailwindcss-animate";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Anchor content globs to this config file's directory (forward slashes for
// fast-glob) so scanning works no matter which cwd the dev server runs from.
const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [`${dir}/index.html`, `${dir}/src/**/*.{ts,tsx}`],
  theme: {
    extend: {
      fontFamily: {
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // trading palette
        up: "hsl(var(--up))",
        down: "hsl(var(--down))",
        gold: "hsl(var(--gold))",
        info: "hsl(var(--info))",
        violet: "hsl(var(--violet))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "flash-up": {
          "0%,100%": { backgroundColor: "transparent" },
          "40%": { backgroundColor: "hsl(var(--up) / 0.18)" },
        },
        "flash-down": {
          "0%,100%": { backgroundColor: "transparent" },
          "40%": { backgroundColor: "hsl(var(--down) / 0.18)" },
        },
        "pulse-glow": {
          "0%,100%": { opacity: "1", boxShadow: "0 0 0 0 hsl(var(--up) / 0.4)" },
          "50%": { opacity: "0.85", boxShadow: "0 0 0 6px hsl(var(--up) / 0)" },
        },
        "live-dot": {
          "0%,100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.6)", opacity: "0.4" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "glow-up": {
          "0%,100%": { boxShadow: "0 0 0 0 hsl(var(--up) / 0)" },
          "50%": { boxShadow: "0 0 30px 2px hsl(var(--up) / 0.45)" },
        },
        "glow-down": {
          "0%,100%": { boxShadow: "0 0 0 0 hsl(var(--down) / 0)" },
          "50%": { boxShadow: "0 0 30px 2px hsl(var(--down) / 0.45)" },
        },
        "glow-warn": {
          "0%,100%": { boxShadow: "0 0 0 0 hsl(var(--gold) / 0)" },
          "50%": { boxShadow: "0 0 32px 3px hsl(var(--gold) / 0.55)" },
        },
      },
      animation: {
        "flash-up": "flash-up 0.7s ease",
        "flash-down": "flash-down 0.7s ease",
        "pulse-glow": "pulse-glow 1.8s ease-in-out infinite",
        "live-dot": "live-dot 1.4s ease-in-out infinite",
        "slide-up": "slide-up 0.25s ease",
        shimmer: "shimmer 1.5s infinite",
        marquee: "marquee 44s linear infinite",
        "glow-up": "glow-up 1.5s ease-in-out infinite",
        "glow-down": "glow-down 1.5s ease-in-out infinite",
        "glow-warn": "glow-warn 1.3s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
