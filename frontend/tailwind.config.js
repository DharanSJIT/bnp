/** Clean Ledger — OneRecon design tokens (mandatory per spec §3) */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ledger: {
          white: '#FFFFFF',
          panel: '#FAFAFA',
          ink: '#0F1115',
          meta: '#4B5563',
          line: '#E5E7EB',
          accent: '#1D4ED8',
          accentHover: '#1E40AF',
          accentDisabled: '#93C5FD',
          match: '#16A34A',
          potential: '#84CC16',
          brk: '#DC2626',
          reconcile: '#CA8A04',
          skeleton: '#F3F4F6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        'header-xl': ['28px', { letterSpacing: '-0.02em' }],
        'header-lg': ['24px', { letterSpacing: '-0.015em' }],
        'header-md': ['20px', { letterSpacing: '-0.01em' }],
        base: ['14px', '1.5'],
        table: ['13px', '1.45'],
        small: ['12px', '1.4'],
      },
      boxShadow: {
        hover: '0 1px 2px rgba(0,0,0,0.04)',
        panel: '0 1px 2px rgba(0,0,0,0.04)',
      },
      borderRadius: {
        panel: '10px',
      },
    },
  },
  plugins: [],
};