import { Platform } from 'react-native';

// Color palette
export const colors = {
  // Primary colors
  primary: '#4CAF50',
  primaryDark: '#388E3C',
  primaryLight: '#81C784',

  // Secondary colors
  secondary: '#2196F3',
  secondaryDark: '#1976D2',
  secondaryLight: '#64B5F6',

  // Success/Error/Warning
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
  info: '#2196F3',

  // Neutral colors
  white: '#FFFFFF',
  black: '#000000',

  // Gray scale
  gray50: '#FAFAFA',
  gray100: '#F5F5F5',
  gray200: '#EEEEEE',
  gray300: '#E0E0E0',
  gray400: '#BDBDBD',
  gray500: '#9E9E9E',
  gray600: '#757575',
  gray700: '#616161',
  gray800: '#424242',
  gray900: '#212121',

  // Background colors
  background: '#FFFFFF',
  surface: '#F8F9FA',
  overlay: 'rgba(0, 0, 0, 0.5)',

  // Text colors
  textPrimary: '#1A1A1A',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textInverse: '#FFFFFF',
  textError: '#F44336',
  textSuccess: '#4CAF50',

  // Border colors
  border: '#E1E5E9',
  borderLight: '#F0F0F0',
  borderDark: '#D1D5DB',

  // Confidence indicator colors
  confidenceHigh: '#4CAF50',
  confidenceMedium: '#FF9800',
  confidenceLow: '#F44336',
};

// Dark mode colors
export const darkColors = {
  ...colors,

  // Override for dark mode
  background: '#121212',
  surface: '#1E1E1E',

  textPrimary: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textTertiary: '#808080',
  textInverse: '#000000',

  border: '#333333',
  borderLight: '#2A2A2A',
  borderDark: '#404040',

  gray50: '#2A2A2A',
  gray100: '#333333',
  gray200: '#404040',
  gray300: '#4D4D4D',
  gray400: '#666666',
  gray500: '#808080',
  gray600: '#999999',
  gray700: '#B3B3B3',
  gray800: '#CCCCCC',
  gray900: '#E6E6E6',
};

// Typography
export const typography = {
  // Font families
  fontFamily: Platform.select({
    ios: 'System',
    android: 'Roboto',
    default: 'System',
  }),

  fontFamilyMono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'monospace',
  }),

  // Font sizes
  fontSize: {
    'xs': 12,
    'sm': 14,
    'base': 16,
    'lg': 18,
    'xl': 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
    '5xl': 48,
  },

  // Font weights
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },

  // Line heights
  lineHeight: {
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
};

// Spacing scale
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
};

// Border radius
export const borderRadius = {
  'none': 0,
  'sm': 4,
  'base': 8,
  'lg': 12,
  'xl': 16,
  '2xl': 20,
  '3xl': 24,
  'full': 9999,
};

// Shadows
export const shadows = {
  sm: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  base: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  xl: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
};

// Component-specific styles
export const components = {
  // Buttons
  button: {
    primary: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.base,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[4],
    },
    secondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.base,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[4],
    },
    text: {
      primary: {
        color: colors.white,
        fontSize: typography.fontSize.base,
        fontWeight: typography.fontWeight.semibold,
      },
      secondary: {
        color: colors.textPrimary,
        fontSize: typography.fontSize.base,
        fontWeight: typography.fontWeight.medium,
      },
    },
  },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },

  // Input fields
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.base,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    fontSize: typography.fontSize.base,
    color: colors.textPrimary,
  },

  // Headers
  header: {
    backgroundColor: colors.primary,
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
  },

  // Sections
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
  },
};

// Layout constants
export const layout = {
  // Screen padding
  screenPadding: spacing[4],

  // Safe areas
  safeAreaTop: Platform.select({
    ios: 44,
    android: 24,
    default: 24,
  }),

  // Header heights
  headerHeight: Platform.select({
    ios: 44,
    android: 56,
    default: 56,
  }),

  // Tab bar height
  tabBarHeight: Platform.select({
    ios: 83,
    android: 60,
    default: 60,
  }),

  // Action bar height
  actionBarHeight: 72,

  // Minimum touch target
  minTouchTarget: 44,
};

// Animation timing
export const animation = {
  timing: {
    fast: 150,
    normal: 250,
    slow: 350,
  },

  easing: {
    easeInOut: 'ease-in-out',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    linear: 'linear',
  },
};

// Theme interface
export interface Theme {
  colors: typeof colors;
  typography: typeof typography;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  shadows: typeof shadows;
  components: typeof components;
  layout: typeof layout;
  animation: typeof animation;
  isDark: boolean;
}

// Light theme
export const lightTheme: Theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  components,
  layout,
  animation,
  isDark: false,
};

// Dark theme
export const darkTheme: Theme = {
  colors: darkColors,
  typography,
  spacing,
  borderRadius,
  shadows: {
    ...shadows,
    // Adjust shadows for dark mode
    sm: {
      ...shadows.sm,
      shadowColor: colors.white,
      shadowOpacity: 0.1,
    },
    base: {
      ...shadows.base,
      shadowColor: colors.white,
      shadowOpacity: 0.15,
    },
    lg: {
      ...shadows.lg,
      shadowColor: colors.white,
      shadowOpacity: 0.2,
    },
    xl: {
      ...shadows.xl,
      shadowColor: colors.white,
      shadowOpacity: 0.25,
    },
  },
  components: {
    ...components,
    // Override component styles for dark mode
    card: {
      ...components.card,
      backgroundColor: darkColors.surface,
      borderColor: darkColors.border,
    },
    input: {
      ...components.input,
      backgroundColor: darkColors.surface,
      borderColor: darkColors.border,
      color: darkColors.textPrimary,
    },
    section: {
      ...components.section,
      backgroundColor: darkColors.surface,
      borderColor: darkColors.border,
    },
  },
  layout,
  animation,
  isDark: true,
};

// Default export
export default {
  light: lightTheme,
  dark: darkTheme,
  colors,
  darkColors,
  typography,
  spacing,
  borderRadius,
  shadows,
  components,
  layout,
  animation,
};
