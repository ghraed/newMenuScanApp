import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { MyScansScreen } from '../screens/MyScansScreen';
import { PreviewScreen } from '../screens/PreviewScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { AppTheme, useAppTheme } from '../lib/theme';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { theme, resolvedMode, setMode } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const nextMode = resolvedMode === 'dark' ? 'light' : 'dark';

  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.chrome },
        headerShadowVisible: false,
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          color: theme.colors.text,
          fontFamily: theme.typography.navTitle.fontFamily,
          fontSize: theme.typography.navTitle.fontSize,
          fontWeight: theme.typography.navTitle.fontWeight,
        },
        contentStyle: { backgroundColor: theme.colors.background },
        // eslint-disable-next-line react/no-unstable-nested-components
        headerRight: () => (
          <ThemeToggleButton
            nextMode={nextMode}
            onPress={() => setMode(nextMode)}
            styles={styles}
          />
        ),
      }}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Menu App Scanner' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Setup Scan' }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan' }} />
      <Stack.Screen name="Preview" component={PreviewScreen} options={{ title: 'Preview' }} />
      <Stack.Screen name="MyScans" component={MyScansScreen} options={{ title: 'My Scans' }} />
    </Stack.Navigator>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    toggleButton: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      ...theme.shadows.soft,
    },
    toggleButtonPressed: {
      opacity: 0.92,
      transform: [{ scale: theme.motion.scale.pressed }],
    },
    iconFrame: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sunCore: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primarySoft,
    },
    sunRayVertical: {
      position: 'absolute',
      width: 1.5,
      height: 20,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.primary,
    },
    sunRayHorizontal: {
      position: 'absolute',
      width: 20,
      height: 1.5,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.primary,
    },
    sunRayDiagonalPositive: {
      transform: [{ rotate: '45deg' }],
    },
    sunRayDiagonalNegative: {
      transform: [{ rotate: '-45deg' }],
    },
    moonOuter: {
      color: theme.colors.primary,
      fontSize: 20,
      lineHeight: 20,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
}

function ThemeToggleButton({
  nextMode,
  onPress,
  styles,
}: {
  nextMode: 'light' | 'dark';
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        styles.toggleButton,
        pressed && styles.toggleButtonPressed,
      ]}>
      <ThemeModeIcon nextMode={nextMode} styles={styles} />
    </Pressable>
  );
}

function ThemeModeIcon({
  nextMode,
  styles,
}: {
  nextMode: 'light' | 'dark';
  styles: ReturnType<typeof createStyles>;
}) {
  if (nextMode === 'dark') {
    return (
      <View style={styles.iconFrame}>
        <View style={styles.sunRayVertical} />
        <View style={styles.sunRayHorizontal} />
        <View style={[styles.sunRayHorizontal, styles.sunRayDiagonalPositive]} />
        <View style={[styles.sunRayHorizontal, styles.sunRayDiagonalNegative]} />
        <View style={styles.sunCore} />
      </View>
    );
  }

  return (
    <View style={styles.iconFrame}>
      <Text style={styles.moonOuter}>{'☾'}</Text>
    </View>
  );
}
