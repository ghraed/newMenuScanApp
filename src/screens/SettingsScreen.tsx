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
import {
  getApiBaseUrl,
  getApiKey,
  getHealthUrl,
  getMenuApiBaseUrl,
  getMenuHealthUrl,
  resetApiKey,
  setApiBaseUrl,
  setApiKey,
  setMenuApiBaseUrl,
} from '../api/config';
import { AppTheme, useAppTheme } from '../lib/theme';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

type TestState =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type ConnectionTarget = 'scan' | 'menu';

export function SettingsScreen({ navigation }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [scanBaseUrlInput, setScanBaseUrlInput] = useState(() => getApiBaseUrl());
  const [menuBaseUrlInput, setMenuBaseUrlInput] = useState(() => getMenuApiBaseUrl());
  const [apiKeyInput, setApiKeyInput] = useState(() => getApiKey() ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState<ConnectionTarget | null>(null);
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });

  useFocusEffect(
    React.useCallback(() => {
      setScanBaseUrlInput(getApiBaseUrl());
      setMenuBaseUrlInput(getMenuApiBaseUrl());
      setApiKeyInput(getApiKey() ?? '');
    }, []),
  );

  const normalizedScanUrl = scanBaseUrlInput.trim().replace(/\/+$/, '');
  const normalizedMenuUrl = menuBaseUrlInput.trim().replace(/\/+$/, '');
  const normalizedApiKey = apiKeyInput.trim();
  const isValidScanUrl = /^https?:\/\/.+/i.test(normalizedScanUrl);
  const isValidMenuUrl = /^https?:\/\/.+/i.test(normalizedMenuUrl);

  const onSave = async () => {
    if (!isValidScanUrl || !isValidMenuUrl) {
      setTestState({
        kind: 'error',
        message: 'Enter valid http:// or https:// URLs for both APIs.',
      });
      return;
    }

    try {
      setIsSaving(true);
      const savedScanUrl = setApiBaseUrl(normalizedScanUrl);
      const savedMenuUrl = setMenuApiBaseUrl(normalizedMenuUrl);
      setScanBaseUrlInput(savedScanUrl);
      setMenuBaseUrlInput(savedMenuUrl);

      let keyStatus = 'Scan API key cleared';
      if (normalizedApiKey) {
        const savedKey = setApiKey(normalizedApiKey);
        setApiKeyInput(savedKey);
        keyStatus = 'Scan API key saved';
      } else {
        resetApiKey();
        setApiKeyInput('');
      }

      setTestState({
        kind: 'success',
        message: `Saved scan API: ${savedScanUrl} | menu API: ${savedMenuUrl} | ${keyStatus}`,
      });
    } catch (error) {
      setTestState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to save settings.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const onTestConnection = async (target: ConnectionTarget) => {
    const normalizedUrl = target === 'scan' ? normalizedScanUrl : normalizedMenuUrl;
    const isValidUrl = target === 'scan' ? isValidScanUrl : isValidMenuUrl;

    if (!isValidUrl) {
      setTestState({
        kind: 'error',
        message: `Enter a valid ${target === 'scan' ? 'scan' : 'menu'} API URL first.`,
      });
      return;
    }

    try {
      setIsTesting(target);
      setTestState({ kind: 'idle' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const defaultHealthUrl = target === 'scan' ? getHealthUrl() : getMenuHealthUrl();
        const savedBaseUrl = target === 'scan' ? getApiBaseUrl() : getMenuApiBaseUrl();
        const response = await fetch(
          normalizedUrl === savedBaseUrl ? defaultHealthUrl : `${normalizedUrl}/up`,
          {
            method: 'GET',
            signal: controller.signal,
          },
        );

        if (response.ok) {
          setTestState({
            kind: 'success',
            message: `${target === 'scan' ? 'Scan' : 'Menu'} API connection OK (${response.status})`,
          });
        } else {
          setTestState({
            kind: 'error',
            message: `${target === 'scan' ? 'Scan' : 'Menu'} API failed (HTTP ${response.status})`,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      setTestState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Connection test failed.',
      });
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <Screen
      title="Settings"
      subtitle="Configure the scan backend and the main menu API used for restaurant login and dish creation.">
      <View style={styles.card}>
        <Text style={styles.label}>Scan API Base URL</Text>
        <TextInput
          value={scanBaseUrlInput}
          onChangeText={setScanBaseUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://scan.rozer.fun"
          placeholderTextColor={theme.colors.textMuted}
          selectionColor={theme.colors.primary}
          style={styles.input}
        />
        <Text style={styles.helper}>Used for scan uploads, background removal, and model jobs.</Text>

        <Text style={styles.label}>Menu API Base URL</Text>
        <TextInput
          value={menuBaseUrlInput}
          onChangeText={setMenuBaseUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://rozer.fun"
          placeholderTextColor={theme.colors.textMuted}
          selectionColor={theme.colors.primary}
          style={styles.input}
        />
        <Text style={styles.helper}>Used for restaurant login, dish creation, and dish listing.</Text>

        <Text style={styles.label}>Optional Scan API Key</Text>
        <TextInput
          value={apiKeyInput}
          onChangeText={setApiKeyInput}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Enter scan API key if required"
          placeholderTextColor={theme.colors.textMuted}
          selectionColor={theme.colors.primary}
          secureTextEntry
          style={styles.input}
        />
        <Text style={styles.helper}>
          Leave empty unless the scan backend still expects `X-API-KEY`.
        </Text>

        <AppButton
          title={isSaving ? 'Saving...' : 'Save'}
          onPress={() => {
            onSave().catch(() => undefined);
          }}
          disabled={isSaving || Boolean(isTesting)}
        />

        <View style={styles.row}>
          <AppButton
            title={isTesting === 'scan' ? 'Testing Scan...' : 'Test Scan API'}
            variant="secondary"
            onPress={() => {
              onTestConnection('scan').catch(() => undefined);
            }}
            disabled={Boolean(isTesting) || isSaving}
            style={styles.rowButton}
          />
          <AppButton
            title={isTesting === 'menu' ? 'Testing Menu...' : 'Test Menu API'}
            variant="secondary"
            onPress={() => {
              onTestConnection('menu').catch(() => undefined);
            }}
            disabled={Boolean(isTesting) || isSaving}
            style={styles.rowButton}
          />
        </View>

        {(isSaving || isTesting) ? <ActivityIndicator color={theme.colors.primary} /> : null}

        {testState.kind !== 'idle' ? (
          <Text
            style={[
              styles.statusText,
              testState.kind === 'success' ? styles.statusSuccess : styles.statusError,
            ]}>
            {testState.message}
          </Text>
        ) : null}
      </View>

      <AppButton title="Back" variant="secondary" onPress={() => navigation.goBack()} />
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
    label: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
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
    row: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    rowButton: {
      flex: 1,
    },
    statusText: {
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: '500',
      letterSpacing: theme.typography.bodySmall.letterSpacing,
      marginTop: theme.spacing.xs,
    },
    statusSuccess: {
      color: theme.colors.success,
    },
    statusError: {
      color: theme.colors.danger,
    },
  });
}
