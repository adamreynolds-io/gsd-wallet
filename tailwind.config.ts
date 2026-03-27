import type { Config } from 'tailwindcss';

export default {
  content: ['./src/popup/**/*.{tsx,ts,html}', './src/offscreen/**/*.html'],
  theme: {
    extend: {
      colors: {
        midnight: {
          900: '#000000',
          800: '#0a0a0f',
          700: '#0a0a0f',
          600: '#141414',
          500: '#1a1a1a',
          400: '#333333',
        },
        accent: {
          purple: '#0080ff',
          magenta: '#0066cc',
        },
        status: {
          green: '#00d66f',
          amber: '#f0ad4e',
          red: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Outfit', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Courier New', 'SF Mono', 'Monaco', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
