import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { menuLogin, menuLogout, menuMe, MenuAuthUser } from '../api/menuApi';
import { AppTheme, useAppTheme } from '../lib/theme';
import {
  clearAuthSession,
  getAuthToken,
  getAuthUser,
  saveAuthSession,
  setAuthUser,
} from '../storage/authStore';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type StatusState =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export function HomeScreen({ navigation }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authUser, setCurrentAuthUser] = useState<MenuAuthUser | undefined>(() => getAuthUser());
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [statusState, setStatusState] = useState<StatusState>({ kind: 'idle' });

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;

      const refreshAuthState = async () => {
        const token = getAuthToken();
        const storedUser = getAuthUser();

        if (!token) {
          if (isActive) {
            setCurrentAuthUser(undefined);
          }
          return;
        }

        if (storedUser && isActive) {
          setCurrentAuthUser(storedUser);
        }

        try {
          if (isActive) {
            setIsRefreshingSession(true);
          }

          const user = await menuMe();
          setAuthUser(user);

          if (!isActive) {
            return;
          }

          setCurrentAuthUser(user);
          setStatusState({ kind: 'idle' });
        } catch (error) {
          clearAuthSession();

          if (!isActive) {
            return;
          }

          setCurrentAuthUser(undefined);
          setStatusState({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Your restaurant session has expired. Please log in again.',
          });
        } finally {
          if (isActive) {
            setIsRefreshingSession(false);
          }
        }
      };

      refreshAuthState().catch(() => undefined);

      return () => {
        isActive = false;
      };
    }, []),
  );

  const onLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) {
      setStatusState({
        kind: 'error',
        message: 'Enter your restaurant email and password.',
      });
      return;
    }

    try {
      setIsAuthenticating(true);
      setStatusState({ kind: 'idle' });

      const result = await menuLogin(trimmedEmail, password);
      saveAuthSession(result.token, result.user);
      setCurrentAuthUser(result.user);
      setPassword('');
      setStatusState({
        kind: 'success',
        message: `Signed in for ${result.user.restaurant?.name ?? result.user.email}.`,
      });
    } catch (error) {
      setStatusState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not sign in.',
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const onLogout = async () => {
    try {
      setIsLoggingOut(true);
      await menuLogout();
    } catch {
      // Clear the local session even if the remote logout request fails.
    } finally {
      clearAuthSession();
      setCurrentAuthUser(undefined);
      setStatusState({ kind: 'success', message: 'Signed out successfully.' });
      setIsLoggingOut(false);
    }
  };

  return (
    <Screen
      title="Home"
      subtitle="Restaurant staff sign in here, then create scans that can become real dishes in the website.">
      {authUser?.restaurant ? (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Restaurant Account</Text>
            <Text style={styles.restaurantName}>{authUser.restaurant.name}</Text>
            <Text style={styles.helper}>Signed in as {authUser.name}</Text>
            <Text style={styles.helper}>{authUser.email}</Text>
            <Text style={styles.helper}>Slug: {authUser.restaurant.slug}</Text>
          </View>

          <View style={styles.group}>
            <AppButton
              title="Create Dish"
              variant="secondary"
              onPress={() => navigation.navigate('CreateDish')}
            />
            <AppButton title="New Scan" onPress={() => navigation.navigate('Setup')} />
            <AppButton
              title="My Scans"
              variant="secondary"
              onPress={() => navigation.navigate('MyScans')}
            />
            <AppButton
              title="Settings"
              variant="secondary"
              onPress={() => navigation.navigate('Settings')}
            />
            <AppButton
              title={isLoggingOut ? 'Signing Out...' : 'Logout'}
              variant="danger"
              onPress={() => {
                onLogout().catch(() => undefined);
              }}
              disabled={isLoggingOut}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Restaurant Login</Text>
            <Text style={styles.helper}>
              Use the same account you use for the website admin pages.
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="restaurant@example.com"
              placeholderTextColor={theme.colors.textMuted}
              selectionColor={theme.colors.primary}
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Password"
              placeholderTextColor={theme.colors.textMuted}
              selectionColor={theme.colors.primary}
              secureTextEntry
              style={styles.input}
            />
            <AppButton
              title={isAuthenticating ? 'Signing In...' : 'Login'}
              onPress={() => {
                onLogin().catch(() => undefined);
              }}
              disabled={isAuthenticating || isRefreshingSession}
            />
          </View>

          <View style={styles.group}>
            <AppButton
              title="Settings"
              variant="secondary"
              onPress={() => navigation.navigate('Settings')}
            />
          </View>
        </>
      )}

      {(isRefreshingSession || isAuthenticating || isLoggingOut) ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : null}

      {statusState.kind !== 'idle' ? (
        <Text
          style={[
            styles.statusText,
            statusState.kind === 'success' ? styles.statusSuccess : styles.statusError,
          ]}>
          {statusState.message}
        </Text>
      ) : null}
    </Screen>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      ...theme.shadows.card,
    },
    group: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    label: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    restaurantName: {
      color: theme.colors.text,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: theme.typography.title.fontSize,
      lineHeight: theme.typography.title.lineHeight,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    input: {
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      fontFamily: theme.typography.body.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.body.fontWeight,
      letterSpacing: theme.typography.body.letterSpacing,
    },
    helper: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    statusText: {
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: '500',
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    statusSuccess: {
      color: theme.colors.success,
    },
    statusError: {
      color: theme.colors.danger,
    },
  });
}
