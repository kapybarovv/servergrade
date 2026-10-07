/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/index.js"],
  theme: {
    extend: {
      colors: {
        canvas: "#0b0c0d",
        panel: "#151617",
        accent: "#10a37f",
      },
      fontFamily: {
        sans: ["Manrope", "ui-sans-serif", "system-ui"],
        display: ["Montserrat", "Manrope", "ui-sans-serif"],
      },
    },
  },
  plugins: [],
};
