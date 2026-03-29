import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { CAPTURE_PATTERNS, getDefaultCapturePattern } from '../lib/captureGuidance';
import { AppTheme, useAppTheme } from '../lib/theme';
import { createScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ScanCaptureMode, ScanTargetType } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Setup'>;

const DEFAULT_OBJECT_TYPE: ScanTargetType = 'dish';
const DEFAULT_CAPTURE_MODE: ScanCaptureMode = 'orbit';
const DEFAULT_OBJECT_SIZES: Record<ScanTargetType, number> = {
  dish: 0.24,
  juice: 0.08,
};
const OBJECT_SIZE_PRESETS: Record<ScanTargetType, number[]> = {
  dish: [0.18, 0.24, 0.3],
  juice: [0.06, 0.08, 0.1],
};
const MIN_OBJECT_SIZE = 0.04;
const MAX_OBJECT_SIZE = 2.0;

export function SetupScreen({ navigation }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [selectedTargetType, setSelectedTargetType] = useState<ScanTargetType>(DEFAULT_OBJECT_TYPE);
  const [selectedCaptureMode, setSelectedCaptureMode] = useState<ScanCaptureMode>(DEFAULT_CAPTURE_MODE);
  const [dishSizeInput, setDishSizeInput] = useState(String(DEFAULT_OBJECT_SIZES[DEFAULT_OBJECT_TYPE]));
  const [selectedPatternTotal, setSelectedPatternTotal] = useState(getDefaultCapturePattern().totalShots);

  const parsedSize = useMemo(() => Number.parseFloat(dishSizeInput), [dishSizeInput]);
  const isValid =
    Number.isFinite(parsedSize) &&
    parsedSize >= MIN_OBJECT_SIZE &&
    parsedSize <= MAX_OBJECT_SIZE;
  const selectedPattern = useMemo(
    () => CAPTURE_PATTERNS.find(pattern => pattern.totalShots === selectedPatternTotal) ?? getDefaultCapturePattern(),
    [selectedPatternTotal],
  );
  const sizeLabel = selectedTargetType === 'dish' ? 'Dish Size (meters)' : 'Juice Width (meters)';
  const objectTypeDescription =
    selectedTargetType === 'dish'
      ? 'Use a wider framing guide that fits plates and bowls.'
      : 'Use the standard guide shape for bottles, cans, and glasses.';
  const captureModeDescription =
    selectedCaptureMode === 'turntable'
      ? 'Keep the phone fixed and let the object rotate. The app captures every 500 ms.'
      : 'Move the phone around the object and let the guided capture flow choose each angle.';

  useEffect(() => {
    setDishSizeInput(String(DEFAULT_OBJECT_SIZES[selectedTargetType]));
  }, [selectedTargetType]);

  const helperText = isValid
    ? `${selectedTargetType === 'dish' ? 'Dish size' : 'Juice width'}: ${parsedSize.toFixed(2)} meters`
    : `Enter a value between ${MIN_OBJECT_SIZE} and ${MAX_OBJECT_SIZE} meters`;

  const createSession = async () => {
    if (!isValid) {
      return;
    }
    const session = await createScanSession(
      parsedSize,
      selectedPattern.totalShots,
      selectedTargetType,
      selectedCaptureMode,
    );
    navigation.replace('Scan', { scanId: session.id });
  };

  return (
    <Screen
      title="Setup Scan"
      subtitle="Choose the object type, capture mode, and object size before scanning.">
      <View style={styles.card}>
        <Text style={styles.label}>Object Type</Text>
        <Text style={styles.helper}>{objectTypeDescription}</Text>
        <View style={styles.optionList}>
          {([
            {
              id: 'dish',
              title: 'Dish',
              description: 'Plates, bowls, and flat food containers.',
            },
            {
              id: 'juice',
              title: 'Juice',
              description: 'Juice bottles, cans, cups, and glasses.',
            },
          ] as const).map(option => {
            const isSelected = option.id === selectedTargetType;

            return (
              <Pressable
                key={option.id}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                onPress={() => setSelectedTargetType(option.id)}>
                <Text style={styles.optionTitle}>{option.title}</Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Capture Mode</Text>
        <Text style={styles.helper}>{captureModeDescription}</Text>
        <View style={styles.optionList}>
          {([
            {
              id: 'orbit',
              title: 'Move Phone',
              description: 'Walk around the object and follow the ghost-box guidance.',
            },
            {
              id: 'turntable',
              title: 'Rotate Object',
              description: 'Keep the phone fixed while the object rotates and capture every 500 ms.',
            },
          ] as const).map(option => {
            const isSelected = option.id === selectedCaptureMode;

            return (
              <Pressable
                key={option.id}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                onPress={() => setSelectedCaptureMode(option.id)}>
                <Text style={styles.optionTitle}>{option.title}</Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{sizeLabel}</Text>
        <TextInput
          value={dishSizeInput}
          onChangeText={setDishSizeInput}
          keyboardType="decimal-pad"
          placeholder="0.24"
          placeholderTextColor={theme.colors.textMuted}
          selectionColor={theme.colors.primary}
          style={styles.input}
        />
        <Text style={[styles.helper, !isValid && styles.helperError]}>{helperText}</Text>
        <View style={styles.quickRow}>
          {OBJECT_SIZE_PRESETS[selectedTargetType].map(size => (
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
          {selectedCaptureMode === 'turntable'
            ? 'Choose how many photos to capture while the object rotates. The app takes one photo every 500 ms until the full total is reached.'
            : 'Choose how many guided photos the scan will require. Finish unlocks only after the full pattern is captured.'}
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
                  {selectedCaptureMode === 'turntable'
                    ? `${pattern.totalShots} timed captures`
                    : pattern.stages
                        .map(stage => `${stage.shots} ${stage.shortTitle.toLowerCase()}`)
                        .join(' • ')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AppButton
        title={`Create ${selectedPattern.title} ${selectedCaptureMode === 'turntable' ? 'Rotate Object' : 'Move Phone'} Scan`}
        onPress={createSession}
        disabled={!isValid}
      />
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
    optionList: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    optionCard: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    optionCardSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primarySoft,
      ...theme.shadows.highlight,
    },
    optionTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: 0.2,
    },
    optionDescription: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    patternList: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    patternCard: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    patternCardSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primarySoft,
      ...theme.shadows.highlight,
    },
    patternHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    patternTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    patternDescription: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    patternStages: {
      color: theme.colors.primary,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: '500',
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    recommendedBadge: {
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      backgroundColor: theme.colors.primarySoft,
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    recommendedBadgeText: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
    },
  });
}
