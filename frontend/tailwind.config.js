/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d0d0d',
        surface: '#161616',
        surface2: '#1e1e1e',
        border: '#2a2a2a',
        green: { DEFAULT: '#00e676', dim: 'rgba(0,230,118,0.1)', border: 'rgba(0,230,118,0.3)' },
        red: { DEFAULT: '#ff5252', dim: 'rgba(255,82,82,0.1)', border: 'rgba(255,82,82,0.3)' },
        yellow: { DEFAULT: '#ffd740', dim: 'rgba(255,215,64,0.1)', border: 'rgba(255,215,64,0.3)' },
        muted: '#666',
        muted2: '#444',
      },
      fontFamily: {
        mono: ['"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
}
