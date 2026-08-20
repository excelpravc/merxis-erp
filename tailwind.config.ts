import type { Config } from "tailwindcss";

// Sistema de design "Livro-Caixa" (Ledger):
// - Base de navegação em tinta profunda (ink), como a capa de um livro contábil.
// - Acento em latão/âmbar, remetendo ao metal das antigas máquinas registradoras.
// - Números e códigos sempre em monoespaçada tabular — SKU, dinheiro, datas de validade.
export default {
  content: ["./index.html", "./*.tsx", "./api/**/*.ts"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#EEF1F6",
          100: "#D8DEE9",
          200: "#B3BFD1",
          300: "#8496B3",
          400: "#576487",
          500: "#374361",
          600: "#232C46",
          700: "#1A2138",
          800: "#131B2E",
          900: "#0D1322",
          950: "#080C17",
        },
        brass: {
          50: "#FDF6E9",
          100: "#FAEACB",
          200: "#F3D592",
          300: "#EBBE5D",
          400: "#E8A33D",
          500: "#D68A22",
          600: "#B06E17",
          700: "#875316",
          800: "#5E3A13",
          900: "#3D2610",
        },
        canvas: "#F5F6F8",
        surface: "#FFFFFF",
        ledger: "#E4E8EF",
        success: "#2F9E6E",
        danger: "#D64545",
        warning: "#E8A33D",
        info: "#3B7DD8",
      },
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(13, 19, 34, 0.04), 0 1px 1px 0 rgba(13, 19, 34, 0.03)",
        popover: "0 12px 32px -8px rgba(13, 19, 34, 0.22)",
      },
      borderRadius: {
        xl2: "0.875rem",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        scan: "scan 2.4s ease-in-out infinite",
        "fade-in": "fade-in 0.18s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
