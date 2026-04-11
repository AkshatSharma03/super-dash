/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border:      "hsl(var(--border))",
        input:       "hsl(var(--input))",
        ring:        "hsl(var(--ring))",
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        /* Memphis Bold Colors */
        memphis: {
          pink:    "#FF006E",
          cyan:    "#00D9FF",
          orange:  "#FB5607",
          yellow:  "#FFBE0B",
          lime:    "#00F5D4",
          purple:  "#8338EC",
          black:   "#1A1A2E",
          white:   "#FFFFFF",
          offwhite:"#FAFAFA",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      /* Sharp Memphis corners - 0 to 4px max */
      borderRadius: {
        lg: "0px",
        md: "0px",
        sm: "0px",
        none: "0px",
        xs: "2px",
      },
      /* Hard offset shadows for Memphis style */
      boxShadow: {
        'hard': '4px 4px 0 #1A1A2E',
        'hard-sm': '2px 2px 0 #1A1A2E',
        'hard-lg': '6px 6px 0 #1A1A2E',
        'hard-xl': '8px 8px 0 #1A1A2E',
        'hard-pink': '4px 4px 0 #FF006E',
        'hard-cyan': '4px 4px 0 #00D9FF',
        'hard-orange': '4px 4px 0 #FB5607',
        'hard-yellow': '4px 4px 0 #FFBE0B',
      },
      /* Snappy transitions */
      transitionDuration: {
        'snap': '100ms',
        'instant': '0ms',
      },
      transitionTimingFunction: {
        'hard': 'steps(1)',
        'snap': 'cubic-bezier(0, 0, 0.2, 1)',
      },
      borderWidth: {
        '3': '3px',
        '4': '4px',
        'thick': '3px',
      },
    },
  },
  plugins: [],
};
