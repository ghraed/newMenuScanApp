import React, { PropsWithChildren, useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppTheme, useAppTheme } from '../lib/theme';

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  scroll?: boolean;
}>;

export function Screen({ title, subtitle, children, scroll = true }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const content = (
    <View style={styles.canvas}>
      <View style={styles.ambientBottom} />
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', default: undefined })}
        style={styles.flex}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}>
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scroll: {
      paddingBottom: theme.spacing.xxl,
      flexGrow: 1,
    },
    canvas: {
      flex: 1,
    },
    ambientBottom: {
      position: 'absolute',
      bottom: -160,
      left: -80,
      width: 260,
      height: 260,
      borderRadius: 260,
      backgroundColor: theme.colors.surfaceAlt,
      opacity: theme.isDark ? 0.35 : 0.8,
    },
    inner: {
      flex: 1,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.xl,
      gap: theme.spacing.lg,
    },
    header: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    title: {
      color: theme.colors.text,
      fontFamily: theme.typography.display.fontFamily,
      fontSize: theme.typography.display.fontSize,
      lineHeight: theme.typography.display.lineHeight,
      fontWeight: theme.typography.display.fontWeight,
      letterSpacing: theme.typography.display.letterSpacing,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.body.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.body.fontWeight,
      letterSpacing: theme.typography.body.letterSpacing,
      maxWidth: 520,
    },
  });
}
