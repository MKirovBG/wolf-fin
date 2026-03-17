/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#09090b',
        surface:  '#111113',
        surface2: '#1a1a1f',
        surface3: '#222228',
        border:   '#2a2a32',
        green: {
          DEFAULT: '#22c55e',
          dim:     '#0f2a1a',
          glow:    'rgba(34,197,94,0.15)',
        },
        red: {
          DEFAULT: '#ef4444',
          dim:     '#2a0f0f',
          glow:    'rgba(239,68,68,0.15)',
        },
        yellow: {
          DEFAULT: '#f59e0b',
          dim:     '#2a1f0a',
          glow:    'rgba(245,158,11,0.15)',
        },
        blue: {
          DEFAULT: '#3b82f6',
          dim:     '#0a1628',
          glow:    'rgba(59,130,246,0.15)',
        },
        purple: {
          DEFAULT: '#a855f7',
          dim:     '#1a0a28',
        },
        muted:  '#6b7280',
        muted2: '#4b5563',
        text:   '#f4f4f5',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
