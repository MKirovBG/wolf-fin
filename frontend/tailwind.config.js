/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Deep dark navy surfaces (E8 Markets style) ───────────────────────
        bg:       '#08111E',   // page background — deepest dark navy
        surface:  '#0E1929',   // card / panel surface
        surface2: '#152035',   // secondary surface, hover states
        surface3: '#1A2840',   // tertiary / grouped rows
        border:   '#1E3352',   // subtle blue-tinted border
        // ── Teal accent (E8 brand) ───────────────────────────────────────────
        teal: {
          DEFAULT: '#00E5CC',
          dim:     'rgba(0,229,204,0.10)',
          glow:    'rgba(0,229,204,0.20)',
        },
        // ── Semantic trading colors ──────────────────────────────────────────
        green: {
          DEFAULT: '#20D68A',  // bullish / gain / positive
          dim:     'rgba(32,214,138,0.10)',
          glow:    'rgba(32,214,138,0.18)',
        },
        red: {
          DEFAULT: '#FF4757',  // bearish / loss / negative
          dim:     'rgba(255,71,87,0.10)',
          glow:    'rgba(255,71,87,0.18)',
        },
        yellow: {
          DEFAULT: '#FFB020',  // warning / neutral / caution
          dim:     'rgba(255,176,32,0.10)',
          glow:    'rgba(255,176,32,0.15)',
        },
        blue: {
          DEFAULT: '#00E5CC',  // alias → teal (keep for backward compat)
          dim:     'rgba(0,229,204,0.10)',
          glow:    'rgba(0,229,204,0.20)',
        },
        purple: {
          DEFAULT: '#9B59FF',  // secondary accent (leaderboard, specials)
          dim:     'rgba(155,89,255,0.12)',
          glow:    'rgba(155,89,255,0.20)',
        },
        // ── Text ─────────────────────────────────────────────────────────────
        text:   '#DDE6F4',   // primary text — cool near-white
        muted:  '#6B84A0',   // secondary text — blue-grey
        muted2: '#374F6B',   // tertiary text — darker blue-grey
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card:     '0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        glow:     '0 0 20px rgba(0,229,204,0.15)',
        'glow-sm':'0 0 10px rgba(0,229,204,0.12)',
        dropdown: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(30,51,82,0.8)',
        modal:    '0 16px 64px rgba(0,0,0,0.7)',
      },
    },
  },
  plugins: [],
}
