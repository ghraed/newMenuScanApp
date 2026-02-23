export const theme = {
  colors: {
    background: '#0B1020',
    surface: '#121A30',
    surfaceAlt: '#1A2340',
    border: '#2B365D',
    text: '#F3F6FF',
    textMuted: '#AAB5D7',
    primary: '#5CB4FF',
    danger: '#FF6B6B',
    success: '#4ADE80',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
} as const;

export type AppTheme = typeof theme;
