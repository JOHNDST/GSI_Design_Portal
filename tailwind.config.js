/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['PixelOperatorSC', 'sans-serif'],
        title: ['PixelOperator', 'sans-serif']
      }
    },
  },
  plugins: [],
}