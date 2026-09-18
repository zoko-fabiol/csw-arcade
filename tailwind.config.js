/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        arcade: {
          dark: '#0a0a0c',
          card: '#121216',
          border: '#23232a',
          neon: '#00f0ff',
          red: '#ff003c',
          gold: '#f0c000'
        }
      },
      fontFamily: {
        arcade: ['"Press Start 2P"', 'monospace', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    },
  },
  plugins: [],
}
