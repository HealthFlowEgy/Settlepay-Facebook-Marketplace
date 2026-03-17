/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teal:   { DEFAULT: '#0097A7', light: '#E0F7FA', dark: '#006978' },
        navy:   { DEFAULT: '#0D1B2A' },
        gold:   { DEFAULT: '#B8860B', light: '#FEF9E7' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
