import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { theme } from '../lib/theme';
import { useScan } from '../hooks/useScans';
import { addPlaceholderCapture } from '../storage/scanStore';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

export function ScanScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const scan = useScan(scanId);

  if (!scan) {
    return (
      <Screen title="Scan" subtitle="Scan session not found.">
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
      </Screen>
    );
  }

  const onCapture = () => {
    const capture = addPlaceholderCapture(scanId);
    if (!capture) {
      Alert.alert('Scan not found', 'Unable to add capture to this scan session.');
    }
  };

  return (
    <Screen
      title="Scan"
      subtitle={`Dish size: ${scan.dishSizeMeters.toFixed(2)}m • Guided auto capture UI placeholder`}>
      <View style={styles.cameraPlaceholder}>
        <Text style={styles.cameraTitle}>Camera Preview Placeholder</Text>
        <Text style={styles.cameraSubtitle}>Auto-capture guidance will be implemented here.</Text>
        <View style={styles.guideRow}>
          <View style={[styles.guideDot, styles.guideDotActive]} />
          <View style={styles.guideDot} />
          <View style={styles.guideDot} />
          <View style={styles.guideDot} />
        </View>
        <Text style={styles.captureCount}>Captured: {scan.captures.length}</Text>
      </View>

      <View style={styles.actions}>
        <AppButton title="Simulate Auto Capture" onPress={onCapture} />
        <AppButton
          title="Preview Captures"
          variant="secondary"
          onPress={() => navigation.navigate('Preview', { scanId })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraPlaceholder: {
    backgroundColor: '#060A16',
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  cameraTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cameraSubtitle: {
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  guideRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  guideDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.border,
  },
  guideDotActive: {
    backgroundColor: theme.colors.primary,
  },
  captureCount: {
    color: theme.colors.success,
    fontWeight: '600',
    marginTop: theme.spacing.sm,
  },
  actions: {
    gap: theme.spacing.md,
  },
});
