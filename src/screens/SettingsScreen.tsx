import React, { useState } from 'react';
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
import { getApiBaseUrl, setApiBaseUrl } from '../api/config';
import { theme } from '../lib/theme';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

type TestState =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export function SettingsScreen({ navigation }: Props) {
  const [baseUrlInput, setBaseUrlInput] = useState(() => getApiBaseUrl());
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });

  useFocusEffect(
    React.useCallback(() => {
      setBaseUrlInput(getApiBaseUrl());
    }, []),
  );

  const normalizedInput = baseUrlInput.trim().replace(/\/+$/, '');
  const isValidUrl = /^https?:\/\/.+/i.test(normalizedInput);

  const onSave = async () => {
    if (!isValidUrl) {
      setTestState({ kind: 'error', message: 'Enter a valid http:// or https:// URL.' });
      return;
    }

    try {
      setIsSaving(true);
      const saved = setApiBaseUrl(normalizedInput);
      setBaseUrlInput(saved);
      setTestState({ kind: 'success', message: `Saved: ${saved}` });
    } catch (error) {
      setTestState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to save API base URL.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const onTestConnection = async () => {
    if (!isValidUrl) {
      setTestState({ kind: 'error', message: 'Enter a valid http:// or https:// URL.' });
      return;
    }

    try {
      setIsTesting(true);
      setTestState({ kind: 'idle' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(`${normalizedInput}/`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (response.ok) {
          setTestState({
            kind: 'success',
            message: `Connection OK (${response.status})`,
          });
        } else {
          setTestState({
            kind: 'error',
            message: `Connection failed (HTTP ${response.status})`,
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
      setIsTesting(false);
    }
  };

  return (
    <Screen
      title="Settings"
      subtitle="Configure the backend API base URL used for scan uploads and job polling.">
      <View style={styles.card}>
        <Text style={styles.label}>Backend API Base URL</Text>
        <TextInput
          value={baseUrlInput}
          onChangeText={setBaseUrlInput}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.100:8000"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.helper}>Example: `http://192.168.1.100:8000`</Text>

        <View style={styles.row}>
          <AppButton
            title={isSaving ? 'Saving...' : 'Save'}
            onPress={() => void onSave()}
            disabled={isSaving || isTesting}
            style={styles.rowButton}
          />
          <AppButton
            title={isTesting ? 'Testing...' : 'Test Connection'}
            variant="secondary"
            onPress={() => void onTestConnection()}
            disabled={isTesting || isSaving}
            style={styles.rowButton}
          />
        </View>

        {(isSaving || isTesting) && <ActivityIndicator color={theme.colors.primary} />}

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  label: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 15,
  },
  helper: {
    color: theme.colors.textMuted,
    fontSize: 12,
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
    fontSize: 13,
    marginTop: theme.spacing.xs,
  },
  statusSuccess: {
    color: theme.colors.success,
  },
  statusError: {
    color: theme.colors.danger,
  },
});
