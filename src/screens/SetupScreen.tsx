import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { CAPTURE_PATTERNS, getDefaultCapturePattern } from '../lib/captureGuidance';
import { theme } from '../lib/theme';
import { createScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

const DEFAULT_DISH_SIZE = 0.24;
const MIN_DISH_SIZE = 0.05;
const MAX_DISH_SIZE = 2.0;

export function SetupScreen({ navigation }: Props) {
  const [dishSizeInput, setDishSizeInput] = useState(String(DEFAULT_DISH_SIZE));
  const [selectedPatternTotal, setSelectedPatternTotal] = useState(getDefaultCapturePattern().totalShots);

  const parsedSize = useMemo(() => Number.parseFloat(dishSizeInput), [dishSizeInput]);
  const isValid =
    Number.isFinite(parsedSize) &&
    parsedSize >= MIN_DISH_SIZE &&
    parsedSize <= MAX_DISH_SIZE;
  const selectedPattern = useMemo(
    () => CAPTURE_PATTERNS.find(pattern => pattern.totalShots === selectedPatternTotal) ?? getDefaultCapturePattern(),
    [selectedPatternTotal],
  );

  const helperText = isValid
    ? `Dish size: ${parsedSize.toFixed(2)} meters`
    : `Enter a value between ${MIN_DISH_SIZE} and ${MAX_DISH_SIZE} meters`;

  const createSession = async () => {
    if (!isValid) {
      return;
    }
    const session = await createScanSession(parsedSize, selectedPattern.totalShots);
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

      <View style={styles.card}>
        <Text style={styles.label}>Capture Pattern</Text>
        <Text style={styles.helper}>
          Choose how many guided photos the scan will require. Finish unlocks only after the full pattern is captured.
        </Text>
        <View style={styles.patternList}>
          {CAPTURE_PATTERNS.map(pattern => {
            const isSelected = pattern.totalShots === selectedPatternTotal;

            return (
              <Pressable
                key={pattern.id}
                style={[styles.patternCard, isSelected && styles.patternCardSelected]}
                onPress={() => setSelectedPatternTotal(pattern.totalShots)}>
                <View style={styles.patternHeader}>
                  <Text style={styles.patternTitle}>{pattern.title}</Text>
                  {pattern.recommended ? (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedBadgeText}>Recommended</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.patternDescription}>{pattern.description}</Text>
                <Text style={styles.patternStages}>
                  {pattern.stages.map(stage => `${stage.shots} ${stage.shortTitle.toLowerCase()}`).join(' • ')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AppButton
        title={`Create ${selectedPattern.title} Scan`}
        onPress={createSession}
        disabled={!isValid}
      />
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
  patternList: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  patternCard: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  patternCardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(92,180,255,0.12)',
  },
  patternHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  patternTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  patternDescription: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  patternStages: {
    color: '#D8E6FF',
    fontSize: 13,
    fontWeight: '600',
  },
  recommendedBadge: {
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: 'rgba(74,222,128,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.45)',
  },
  recommendedBadgeText: {
    color: theme.colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
});
