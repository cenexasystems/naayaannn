/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          hover:   'rgb(var(--primary-hover) / <alpha-value>)',
          muted:   'rgb(var(--primary-muted) / <alpha-value>)',
          soft:    'rgb(var(--primary-soft) / <alpha-value>)',
          200:     'rgb(var(--primary-200) / <alpha-value>)',
          100:     'rgb(var(--primary-100) / <alpha-value>)',
          50:      'rgb(var(--primary-50) / <alpha-value>)',
          ink:     'rgb(var(--primary-ink) / <alpha-value>)',
        },
        bgMain:    '#F9FAFB', // Clean light slate canvas
        cardBg:    '#FFFFFF', // Crisp white card
        'brand-blue': {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)', // Primary charcoal grey
          nav:     'rgb(var(--primary) / <alpha-value>)',
          primary: 'rgb(var(--primary) / <alpha-value>)',
          hover:   'rgb(var(--primary-hover) / <alpha-value>)', // Charcoal
          light:   '#F9FAFB',
          surface: '#F3F4F6',
        },
        'brand-gold': {
          DEFAULT: 'rgb(var(--primary-soft) / <alpha-value>)', // Silver grey accent
          rich:    'rgb(var(--primary-soft) / <alpha-value>)',
          hover:   'rgb(var(--primary-muted) / <alpha-value>)',
          deep:    'rgb(var(--primary-hover) / <alpha-value>)', // Dark grey (text & borders)
          glow:    'rgb(var(--primary-50) / <alpha-value>)', // Soft grey highlight
        },
        brand: {
          blue:       'rgb(var(--primary) / <alpha-value>)',
          blueHover:  'rgb(var(--primary-hover) / <alpha-value>)',
          blueLight:  '#F9FAFB',
          gold:       'rgb(var(--primary-soft) / <alpha-value>)',
          goldHover:  'rgb(var(--primary-muted) / <alpha-value>)',
          goldDeep:   'rgb(var(--primary-hover) / <alpha-value>)',
          goldLight:  'rgb(var(--primary-50) / <alpha-value>)',
          goldBorder: '#F3F4F6',
          black:      '#111111', // Primary black
          dark:       '#000000',
        },
        gold: {
          DEFAULT: 'rgb(var(--primary-soft) / <alpha-value>)',
          dark:    'rgb(var(--primary-hover) / <alpha-value>)',
          light:   'rgb(var(--primary-50) / <alpha-value>)',
          border:  'rgb(var(--primary-200) / <alpha-value>)',
        },
        maroon: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          dark:    '#000000',
          light:   '#F9FAFB',
        },
        textMain:  '#1F1F1F', // Slate 900
        textMuted: '#6B7280', // Slate 600
        borderLight: '#F3F4F6', // Card borders with subtle slate/gold
      },
      fontFamily: {
        sans:      ['"DM Sans"', '"Outfit"', '"Noto Sans Tamil"', 'system-ui', '-apple-system', 'sans-serif'],
        dmsans:    ['"DM Sans"', 'sans-serif'],
        'dm-sans': ['"DM Sans"', 'sans-serif'],
        outfit:    ['"Outfit"', 'sans-serif'],
        brand:     ['"Cinzel"', '"DM Sans"', '"Outfit"', '"Noto Sans Tamil"', 'serif'],
        headline:  ['"DM Sans"', '"Outfit"', '"Noto Sans Tamil"', 'sans-serif'],
      },
      boxShadow: {
        soft:   '0 1px 3px rgba(0,0,0,0.05)',
        gold:   '0 4px 20px -2px rgb(var(--primary) / 0.25)',
      },
      borderRadius: {
        'card': '12px',
        'btn': '10px',
        'input': '10px',
        'table': '12px',
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
        'floatDelay': 'float 4s ease-in-out 1.5s infinite',
        'slideUp': 'slideUp 0.6s ease forwards',
        'fadeIn': 'fadeIn 0.5s ease forwards',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
