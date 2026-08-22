/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ─── Brand ────────────────────────────────────────
        "midnight-ink": "#091426",
        "prussian-navy": "#1A2942",
        "ice-slate": "#E2E8F0",
        "hairline-border": "#E2E8F0",

        // ─── Material Design 3 Tokens (Light) ───────────
        primary: "#091426",
        secondary: "#6A6258",
        tertiary: "#091426",
        error: "#ba1a1a",

        surface: "#FFFFFF",
        background: "#FFFFFF",

        "surface-container": "#F4F1ED",
        "surface-container-low": "#FAF8F5",
        "surface-container-lowest": "#FFFFFF",
        "surface-container-high": "#EAE5DF",
        "surface-container-highest": "#EAE5DF",
        "surface-variant": "#EAE5DF",
        "surface-dim": "#EAE5DF",
        "surface-bright": "#FFFFFF",
        "surface-tint": "#6A6258",

        "on-surface": "#091426",
        "on-surface-variant": "#6A6258",
        "on-background": "#091426",
        "on-primary": "#ffffff",
        "on-primary-container": "#E2E8F0",
        "on-primary-fixed": "#FFFFFF",
        "on-primary-fixed-variant": "#1A2942",
        "on-secondary": "#ffffff",
        "on-secondary-container": "#4A443C",
        "on-secondary-fixed": "#091426",
        "on-secondary-fixed-variant": "#4A443C",
        "on-tertiary": "#ffffff",
        "on-tertiary-container": "#E2E8F0",
        "on-tertiary-fixed": "#FFFFFF",
        "on-tertiary-fixed-variant": "#091426",
        "on-error": "#ffffff",
        "on-error-container": "#93000a",
        "inverse-surface": "#1A2942",
        "inverse-on-surface": "#FFFFFF",
        "inverse-primary": "#1A2942",

        outline: "#6A6258",
        "outline-variant": "#E2E8F0",

        "primary-container": "#1A2942",
        "primary-fixed": "#E2E8F0",
        "primary-fixed-dim": "#C9C4BC",
        "secondary-container": "#EAE5DF",
        "secondary-fixed": "#EAE5DF",
        "secondary-fixed-dim": "#D9D4CC",
        "tertiary-container": "#1A2942",
        "tertiary-fixed": "#E2E8F0",
        "tertiary-fixed-dim": "#C9C4BC",
        "error-container": "#ffdad6",

        // ─── Dark Mode Overrides (True Black / AMOLED) ──
        "dark-surface": "#000000",
        "dark-surface-dim": "#000000",
        "dark-surface-container": "#0A0A0F",
        "dark-surface-container-low": "#050508",
        "dark-surface-container-high": "#111118",
        "dark-surface-container-highest": "#1A1A22",
        "dark-on-surface": "#FFFFFF",
        "dark-on-surface-variant": "#9A9AA0",
        "dark-outline": "#3A3A42",
        "dark-outline-variant": "#1E1E26",
        "dark-primary": "#E0E0E4",
        "dark-on-primary": "#FFFFFF",
        "dark-primary-container": "#1A1A22",
        "dark-secondary": "#B0B0B8",
        "dark-on-secondary": "#0A0A0F",
        "dark-tertiary": "#909098",
        "dark-error": "#FFB4AB",
      },

      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px",
      },

      spacing: {
        "panel-width-fixed": "320px",
        "panel-width": "72px",
        "margin-page": "32px",
        "grid-gap": "24px",
        unit: "4px",
        gutter: "16px",
      },

      fontFamily: {
        sans: ["Inter", "sans-serif"],
        serif: ["'Playfair Display'", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "monospace"],
        display: ["'Playfair Display'", "Georgia", "serif"],
        "headline-md": ["Inter", "sans-serif"],
        "body-sm": ["Inter", "sans-serif"],
        "body-md": ["Inter", "sans-serif"],
        "label-caps": ["Inter", "sans-serif"],
        "title-sm": ["Inter", "sans-serif"],
        "display-lg": ["'Playfair Display'", "Georgia", "serif"],
        "mono-data": ["'JetBrains Mono'", "monospace"],
      },

      fontSize: {
        "headline-md": [
          "24px",
          { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        "body-sm": ["13px", { lineHeight: "18px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-caps": [
          "11px",
          { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "700" },
        ],
        "title-sm": ["16px", { lineHeight: "24px", fontWeight: "600" }],
        "display-lg": [
          "36px",
          { lineHeight: "44px", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        "mono-data": ["12px", { lineHeight: "16px", fontWeight: "400" }],
      },

      boxShadow: {
        soft: "0 1px 3px rgba(9, 20, 38, 0.04), 0 4px 16px -2px rgba(9, 20, 38, 0.06)",
        "soft-md": "0 2px 6px rgba(9, 20, 38, 0.05), 0 8px 24px -4px rgba(9, 20, 38, 0.08)",
        "soft-lg": "0 4px 12px rgba(9, 20, 38, 0.06), 0 12px 36px -6px rgba(9, 20, 38, 0.10)",
        "soft-xl": "0 8px 24px rgba(9, 20, 38, 0.08), 0 20px 60px -12px rgba(9, 20, 38, 0.14)",
        "inner-glow": "inset 0 1px 2px rgba(255, 255, 255, 0.6)",
        "dark-soft": "0 1px 3px rgba(0, 0, 0, 0.2), 0 4px 16px -2px rgba(0, 0, 0, 0.25)",
        "dark-soft-md": "0 2px 6px rgba(0, 0, 0, 0.25), 0 8px 24px -4px rgba(0, 0, 0, 0.3)",
        "dark-soft-lg": "0 4px 12px rgba(0, 0, 0, 0.3), 0 12px 36px -6px rgba(0, 0, 0, 0.35)",
        "ring-primary": "0 0 0 3px rgba(9, 20, 38, 0.12)",
        "ring-dark": "0 0 0 3px rgba(224, 224, 228, 0.15)",
      },

      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },

      animation: {
        "fade-in": "fade-in 0.3s ease-out",
        "fade-in-up": "fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in-down": "fade-in-down 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        shimmer: "shimmer 2s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
      },

    },
  },
  plugins: [],
};
