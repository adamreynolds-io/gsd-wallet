import type { Config } from 'tailwindcss';

export default {
  content: ['./src/popup/**/*.{tsx,ts,html}', './src/offscreen/**/*.html'],
  theme: {
    extend: {
      colors: {
        midnight: {
          900: '#0d0d1a',
          800: '#16162a',
          700: '#1a1a2e',
          600: '#2a2a3e',
          500: '#3a3a52',
          400: '#555570',
        },
        accent: {
          purple: '#667eea',
          magenta: '#764ba2',
        },
        status: {
          green: '#4caf50',
          amber: '#f0ad4e',
          red: '#f44336',
        },
      },
      fontFamily: {
        mono: ['SF Mono', 'Monaco', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
