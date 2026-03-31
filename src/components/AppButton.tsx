import React, { useMemo } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import { AppTheme, useAppTheme } from '../lib/theme';

type Variant = 'primary' | 'secondary' | 'danger';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  title,
  onPress,
  disabled = false,
  variant = 'primary',
  style,
}: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const rippleColor = variant === 'danger' ? theme.colors.dangerSoft : theme.colors.primarySoft;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: rippleColor }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        variant === 'danger' && !theme.isDark ? styles.dangerLightFlat : null,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel,
          variant === 'danger' ? styles.dangerLabel : null,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    base: {
      minHeight: 56,
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      ...theme.shadows.soft,
    },
    primary: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
      ...theme.shadows.highlight,
    },
    secondary: {
      backgroundColor: theme.colors.surfaceAlt,
      borderColor: theme.colors.border,
    },
    danger: {
      backgroundColor: theme.isDark ? theme.colors.dangerSoft : '#E7D2CD',
      borderColor: theme.isDark ? theme.colors.danger : '#B88479',
    },
    dangerLightFlat: {
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    disabled: {
      opacity: 0.45,
      shadowOpacity: 0,
      elevation: 0,
    },
    pressed: {
      opacity: 0.96,
      transform: [{ scale: theme.motion.scale.pressed }],
    },
    label: {
      fontFamily: theme.typography.button.fontFamily,
      fontSize: theme.typography.button.fontSize,
      lineHeight: theme.typography.button.lineHeight,
      fontWeight: theme.typography.button.fontWeight,
      letterSpacing: theme.typography.button.letterSpacing,
    },
    primaryLabel: {
      color: theme.colors.primaryContrast,
    },
    secondaryLabel: {
      color: theme.colors.text,
    },
    dangerLabel: {
      color: theme.isDark ? theme.colors.danger : '#6F3832',
    },
  });
}
