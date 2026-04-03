/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Deep charcoal surfaces (E8 Markets CRM style) ────────────────────
        bg:       '#0B0E18',   // page background — near-black charcoal
        surface:  '#121627',   // card / panel surface
        surface2: '#181D30',   // secondary surface, hover states
        surface3: '#1E2438',   // tertiary / grouped rows
        border:   '#252D45',   // subtle blue-tinted border
        // ── Teal primary (E8 brand) ───────────────────────────────────────────
        brand: {
          DEFAULT: '#00C4AD',
          dim:     'rgba(0,196,173,0.10)',
          glow:    'rgba(0,196,173,0.22)',
        },
        // ── Semantic trading colors ──────────────────────────────────────────
        green: {
          DEFAULT: '#00C07B',  // bullish / gain / positive
          dim:     'rgba(0,192,123,0.10)',
          glow:    'rgba(0,192,123,0.18)',
        },
        red: {
          DEFAULT: '#FF3D57',  // bearish / loss / negative
          dim:     'rgba(255,61,87,0.10)',
          glow:    'rgba(255,61,87,0.18)',
        },
        yellow: {
          DEFAULT: '#FFB020',  // warning / neutral / caution
          dim:     'rgba(255,176,32,0.10)',
          glow:    'rgba(255,176,32,0.15)',
        },
        blue: {
          DEFAULT: '#00C4AD',  // alias → brand teal
          dim:     'rgba(0,196,173,0.10)',
          glow:    'rgba(0,196,173,0.22)',
        },
        purple: {
          DEFAULT: '#9B59FF',  // secondary accent
          dim:     'rgba(155,89,255,0.12)',
          glow:    'rgba(155,89,255,0.20)',
        },
        // ── Text ─────────────────────────────────────────────────────────────
        text:   '#E2E8F6',   // primary text — crisp near-white
        muted:  '#667099',   // secondary text — cool grey-blue
        muted2: '#373F5E',   // tertiary text — dark blue-grey
      },
      fontFamily: {
        sans: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card:     '0 1px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
        glow:     '0 0 20px rgba(0,196,173,0.18)',
        'glow-sm':'0 0 10px rgba(0,196,173,0.14)',
        dropdown: '0 8px 32px rgba(0,0,0,0.65), 0 0 0 1px rgba(37,45,69,0.9)',
        modal:    '0 16px 64px rgba(0,0,0,0.75)',
      },
    },
  },
  plugins: [],
}
