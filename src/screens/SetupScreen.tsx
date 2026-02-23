import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { theme } from '../lib/theme';
import { createScanSession } from '../storage/scanStore';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

const DEFAULT_DISH_SIZE = 0.24;
const MIN_DISH_SIZE = 0.05;
const MAX_DISH_SIZE = 2.0;

export function SetupScreen({ navigation }: Props) {
  const [dishSizeInput, setDishSizeInput] = useState(String(DEFAULT_DISH_SIZE));

  const parsedSize = useMemo(() => Number.parseFloat(dishSizeInput), [dishSizeInput]);
  const isValid =
    Number.isFinite(parsedSize) &&
    parsedSize >= MIN_DISH_SIZE &&
    parsedSize <= MAX_DISH_SIZE;

  const helperText = isValid
    ? `Dish size: ${parsedSize.toFixed(2)} meters`
    : `Enter a value between ${MIN_DISH_SIZE} and ${MAX_DISH_SIZE} meters`;

  const createSession = () => {
    if (!isValid) {
      return;
    }
    const session = createScanSession(parsedSize);
    navigation.replace('Scan', { scanId: session.id });
  };

  return (
    <Screen
      title="Setup Scan"
      subtitle="Set the dish diameter before scanning. The default is 0.24m, and you can enter a custom value.">
      <View style={styles.card}>
        <Text style={styles.label}>Dish Size (meters)</Text>
        <TextInput
          value={dishSizeInput}
          onChangeText={setDishSizeInput}
          keyboardType="decimal-pad"
          placeholder="0.24"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
        />
        <Text style={[styles.helper, !isValid && styles.helperError]}>{helperText}</Text>
        <View style={styles.quickRow}>
          {[0.18, 0.24, 0.3].map(size => (
            <AppButton
              key={size}
              title={`${size}m`}
              variant="secondary"
              style={styles.quickButton}
              onPress={() => setDishSizeInput(String(size))}
            />
          ))}
        </View>
      </View>

      <AppButton title="Create Scan Session" onPress={createSession} disabled={!isValid} />
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
    fontSize: 16,
  },
  helper: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  helperError: {
    color: theme.colors.danger,
  },
  quickRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  quickButton: {
    flex: 1,
  },
});
