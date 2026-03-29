import React, {
  PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DefaultTheme, Theme as NavigationTheme } from '@react-navigation/native';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';

export type ResolvedThemeMode = 'light' | 'dark';
export type ThemeMode = ResolvedThemeMode | 'system';

type LuxuryTheme = {
  id: ResolvedThemeMode;
  isDark: boolean;
  statusBarStyle: 'light-content' | 'dark-content';
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    surfaceRaised: string;
    chrome: string;
    text: string;
    textMuted: string;
    textSubtle: string;
    primary: string;
    primarySoft: string;
    primaryContrast: string;
    border: string;
    borderSoft: string;
    shadow: string;
    success: string;
    successSoft: string;
    danger: string;
    dangerSoft: string;
    cameraBackdrop: string;
    cameraPanel: string;
    cameraPanelSoft: string;
    cameraGuide: string;
    cameraGuideSoft: string;
    cameraReady: string;
    cameraReadySoft: string;
    cameraControlOuter: string;
    cameraControlOuterSoft: string;
    cameraControlInner: string;
    cameraText: string;
    scrim: string;
  };
  spacing: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    xxxl: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
  typography: {
    display: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '600' | '700';
    };
    title: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '600' | '700';
    };
    sectionTitle: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '600';
    };
    body: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '400';
    };
    bodySmall: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '400' | '500';
    };
    label: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '600';
      textTransform: 'uppercase';
    };
    button: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '600';
    };
    navTitle: {
      fontFamily: string | undefined;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      fontWeight: '600';
    };
  };
  shadows: {
    soft: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
    card: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
    floating: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
    highlight: {
      shadowColor: string;
      shadowOffset: { width: number; height: number };
      shadowOpacity: number;
      shadowRadius: number;
      elevation: number;
    };
  };
  motion: {
    duration: {
      quick: number;
      standard: number;
      gentle: number;
      reveal: number;
    };
    scale: {
      pressed: number;
    };
    easing: {
      standard: (value: number) => number;
      emphasized: (value: number) => number;
    };
  };
  navigationTheme: NavigationTheme;
};

type ThemeContextValue = {
  theme: LuxuryTheme;
  mode: ThemeMode;
  resolvedMode: ResolvedThemeMode;
  setMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
};

const displayFontFamily = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

const sansFontFamily = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  default: 'System',
});

const highlightEasing = Easing.bezier(0.22, 1, 0.36, 1);
const standardEasing = Easing.bezier(0.25, 0.1, 0.25, 1);

function buildNavigationTheme(theme: LuxuryTheme): NavigationTheme {
  return {
    ...DefaultTheme,
    dark: theme.isDark,
    colors: {
      ...DefaultTheme.colors,
      background: theme.colors.background,
      card: theme.colors.chrome,
      text: theme.colors.text,
      primary: theme.colors.primary,
      border: theme.colors.border,
      notification: theme.colors.primary,
    },
  };
}

function createTheme(mode: ResolvedThemeMode): LuxuryTheme {
  const isDark = mode === 'dark';

  const theme: LuxuryTheme = {
    id: mode,
    isDark,
    statusBarStyle: isDark ? 'light-content' : 'dark-content',
    colors: {
      background: isDark ? '#0B0B0C' : '#F6F2EB',
      surface: isDark ? 'rgba(255,255,255,0.045)' : '#FFFFFF',
      surfaceAlt: isDark ? 'rgba(255,255,255,0.07)' : '#FCFAF5',
      surfaceRaised: isDark ? 'rgba(255,255,255,0.09)' : '#FFFEFB',
      chrome: isDark ? '#141315' : '#FFFCF7',
      text: isDark ? '#F8F5EF' : '#1A1A1A',
      textMuted: isDark ? '#B8AC96' : '#6E6255',
      textSubtle: isDark ? '#8E8475' : '#908273',
      primary: isDark ? '#D4AF37' : '#B89A5E',
      primarySoft: isDark ? 'rgba(212,175,55,0.15)' : 'rgba(184,154,94,0.12)',
      primaryContrast: isDark ? '#141109' : '#2B2214',
      border: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
      borderSoft: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      shadow: '#000000',
      success: isDark ? '#A4BF8A' : '#6B8454',
      successSoft: isDark ? 'rgba(164,191,138,0.16)' : 'rgba(107,132,84,0.12)',
      danger: isDark ? '#D08E80' : '#9B6158',
      dangerSoft: isDark ? 'rgba(208,142,128,0.16)' : 'rgba(155,97,88,0.12)',
      cameraBackdrop: isDark ? '#070708' : '#171310',
      cameraPanel: isDark ? 'rgba(10,10,12,0.82)' : 'rgba(249,245,238,0.82)',
      cameraPanelSoft: isDark ? 'rgba(17,17,19,0.72)' : 'rgba(252,250,245,0.72)',
      cameraGuide: isDark ? '#D4AF37' : '#B89A5E',
      cameraGuideSoft: isDark ? 'rgba(212,175,55,0.16)' : 'rgba(184,154,94,0.15)',
      cameraReady: isDark ? '#F6E8C2' : '#F5E7C5',
      cameraReadySoft: isDark ? 'rgba(246,232,194,0.18)' : 'rgba(245,231,197,0.18)',
      cameraControlOuter: 'rgba(248,245,239,0.92)',
      cameraControlOuterSoft: 'rgba(248,245,239,0.14)',
      cameraControlInner: isDark ? '#F8F5EF' : '#FFFEFB',
      cameraText: isDark ? '#F8F5EF' : '#2B2214',
      scrim: isDark ? 'rgba(4,4,6,0.68)' : 'rgba(35,28,20,0.34)',
    },
    spacing: {
      xxs: 2,
      xs: 6,
      sm: 10,
      md: 16,
      lg: 20,
      xl: 28,
      xxl: 40,
      xxxl: 56,
    },
    radius: {
      sm: 12,
      md: 18,
      lg: 24,
      xl: 32,
      pill: 999,
    },
    typography: {
      display: {
        fontFamily: displayFontFamily,
        fontSize: 34,
        lineHeight: 42,
        letterSpacing: 0.2,
        fontWeight: isDark ? '600' : '700',
      },
      title: {
        fontFamily: displayFontFamily,
        fontSize: 22,
        lineHeight: 30,
        letterSpacing: 0.1,
        fontWeight: '600',
      },
      sectionTitle: {
        fontFamily: sansFontFamily,
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: 0.4,
        fontWeight: '600',
      },
      body: {
        fontFamily: sansFontFamily,
        fontSize: 15,
        lineHeight: 24,
        letterSpacing: 0.15,
        fontWeight: '400',
      },
      bodySmall: {
        fontFamily: sansFontFamily,
        fontSize: 13,
        lineHeight: 20,
        letterSpacing: 0.2,
        fontWeight: '400',
      },
      label: {
        fontFamily: sansFontFamily,
        fontSize: 11,
        lineHeight: 16,
        letterSpacing: 1.4,
        fontWeight: '600',
        textTransform: 'uppercase',
      },
      button: {
        fontFamily: sansFontFamily,
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: 0.35,
        fontWeight: '600',
      },
      navTitle: {
        fontFamily: displayFontFamily,
        fontSize: 18,
        lineHeight: 24,
        letterSpacing: 0.15,
        fontWeight: '600',
      },
    },
    shadows: {
      soft: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: isDark ? 18 : 12 },
        shadowOpacity: isDark ? 0.35 : 0.05,
        shadowRadius: isDark ? 20 : 15,
        elevation: isDark ? 10 : 5,
      },
      card: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: isDark ? 18 : 12 },
        shadowOpacity: isDark ? 0.32 : 0.05,
        shadowRadius: isDark ? 20 : 15,
        elevation: isDark ? 9 : 4,
      },
      floating: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: isDark ? 25 : 20 },
        shadowOpacity: isDark ? 0.5 : 0.08,
        shadowRadius: isDark ? 30 : 25,
        elevation: isDark ? 14 : 8,
      },
      highlight: {
        shadowColor: isDark ? '#D4AF37' : '#B89A5E',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: isDark ? 0.28 : 0.16,
        shadowRadius: 22,
        elevation: 8,
      },
    },
    motion: {
      duration: {
        quick: 180,
        standard: 320,
        gentle: 460,
        reveal: 760,
      },
      scale: {
        pressed: 0.985,
      },
      easing: {
        standard: standardEasing,
        emphasized: highlightEasing,
      },
    },
    navigationTheme: DefaultTheme,
  };

  theme.navigationTheme = buildNavigationTheme(theme);
  return theme;
}

const themes: Record<ResolvedThemeMode, LuxuryTheme> = {
  light: createTheme('light'),
  dark: createTheme('dark'),
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function ThemeRevealOverlay({
  fromTheme,
  toTheme,
}: {
  fromTheme: LuxuryTheme;
  toTheme: LuxuryTheme;
}) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: toTheme.motion.duration.reveal,
      easing: toTheme.motion.easing.emphasized,
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [progress, toTheme]);

  const maxRadius = Math.sqrt(width ** 2 + height ** 2);
  const diameter = maxRadius * 2;
  const overlayOpacity = progress.interpolate({
    inputRange: [0, 0.86, 1],
    outputRange: [1, 1, 0],
  });
  const circleScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.001, 1],
  });
  const ringOpacity = progress.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [0.9, 0.45, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: fromTheme.colors.background,
          opacity: overlayOpacity,
        },
      ]}>
      <Animated.View
        style={[
          styles.revealCircle,
          styles.revealCircleFill,
          toTheme.shadows.highlight,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            top: -diameter / 2,
            right: -diameter / 2,
            backgroundColor: toTheme.colors.background,
            borderColor: toTheme.colors.primary,
            transform: [{ scale: circleScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.revealCircle,
          styles.revealCircleRing,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            top: -diameter / 2,
            right: -diameter / 2,
            borderColor: toTheme.colors.primary,
            opacity: ringOpacity,
            transform: [{ scale: circleScale }],
          },
        ]}
      />
    </Animated.View>
  );
}

export function ThemeProvider({
  children,
  initialMode = 'system',
}: PropsWithChildren<{ initialMode?: ThemeMode }>) {
  const systemColorScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [transitionFrom, setTransitionFrom] = useState<ResolvedThemeMode | null>(null);

  const resolvedMode: ResolvedThemeMode =
    mode === 'system' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : mode;

  const previousModeRef = useRef<ResolvedThemeMode>(resolvedMode);

  useEffect(() => {
    if (previousModeRef.current === resolvedMode) {
      return;
    }

    setTransitionFrom(previousModeRef.current);

    const timeout = setTimeout(() => {
      setTransitionFrom(null);
    }, themes[resolvedMode].motion.duration.reveal);

    previousModeRef.current = resolvedMode;

    return () => clearTimeout(timeout);
  }, [resolvedMode]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme: themes[resolvedMode],
      mode,
      resolvedMode,
      setMode,
    }),
    [mode, resolvedMode],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
      {transitionFrom ? (
        <ThemeRevealOverlay fromTheme={themes[transitionFrom]} toTheme={themes[resolvedMode]} />
      ) : null}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }

  return context;
}

export type AppTheme = LuxuryTheme;

const styles = StyleSheet.create({
  revealCircle: {
    position: 'absolute',
  },
  revealCircleFill: {
    opacity: 0.98,
  },
  revealCircleRing: {
    borderWidth: 1.5,
  },
});
