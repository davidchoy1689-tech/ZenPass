/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./frontend/**/*.html"],
  theme: {
    extend: {
      colors: {
        zen: {
          orange: '#f06030',
          'orange-dark': '#c94420',
          'orange-light': '#ff8555',
          dark: '#1a1a2e',
        },
      },
      fontFamily: {
        sans: ['Inter', '"Noto Sans TC"', 'sans-serif'],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [{
      zenpass: {
        "primary": "#f06030",
        "primary-content": "#ffffff",
        "secondary": "#c94420",
        "accent": "#ff8555",
        "neutral": "#1a1a2e",
        "base-100": "#ffffff",
        "base-200": "#f9fafb",
        "base-300": "#f3f4f6",
        "info": "#3b82f6",
        "success": "#059669",
        "warning": "#f59e0b",
        "error": "#ef4444",
        "--rounded-box": "1rem",
        "--rounded-btn": "0.75rem",
      },
    }],
  },
};
