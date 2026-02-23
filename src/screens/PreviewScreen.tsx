import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { create3DModel } from '../api/modelApi';
import { useScan } from '../hooks/useScans';
import { theme } from '../lib/theme';
import { deleteScan, setScanStatus } from '../storage/scanStore';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Preview'>;

export function PreviewScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const scan = useScan(scanId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const captureCountLabel = useMemo(() => {
    if (!scan) {
      return '0 captures';
    }
    return `${scan.captures.length} capture${scan.captures.length === 1 ? '' : 's'}`;
  }, [scan]);

  if (!scan) {
    return (
      <Screen title="Preview" subtitle="Scan session not found.">
        <AppButton title="My Scans" onPress={() => navigation.navigate('MyScans')} />
      </Screen>
    );
  }

  const onCreateModel = async () => {
    setIsSubmitting(true);
    setScanStatus(scanId, 'processing');
    try {
      const result = await create3DModel(scan);
      setScanStatus(scanId, 'model_created');
      Alert.alert(
        '3D Model Requested',
        result.mocked
          ? 'Backend is mocked right now. Request simulated successfully.'
          : 'Request sent to backend successfully.',
      );
    } catch {
      setScanStatus(scanId, 'draft');
      Alert.alert('Request Failed', 'Could not create a 3D model request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onDiscard = () => {
    deleteScan(scanId);
    navigation.navigate('MyScans');
  };

  return (
    <Screen
      title="Preview"
      subtitle={`${captureCountLabel} • Status: ${scan.status.replace('_', ' ')}`}>
      <View style={styles.thumbGrid}>
        {scan.captures.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No captures yet. Add captures from Scan screen.</Text>
          </View>
        ) : (
          scan.captures.map((capture, index) => (
            <View key={capture.id} style={styles.thumbCard}>
              <View style={[styles.thumbSwatch, { backgroundColor: capture.thumbnailColor }]} />
              <Text style={styles.thumbLabel}>Capture {scan.captures.length - index}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.actions}>
        <AppButton
          title={isSubmitting ? 'Creating 3D Model...' : 'Create 3D Model'}
          onPress={onCreateModel}
          disabled={isSubmitting || scan.captures.length === 0}
        />
        <AppButton title="Discard" variant="danger" onPress={onDiscard} disabled={isSubmitting} />
        {isSubmitting ? <ActivityIndicator color={theme.colors.primary} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  thumbCard: {
    width: '47%',
    minWidth: 140,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  thumbSwatch: {
    height: 90,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  thumbLabel: {
    color: theme.colors.text,
    fontWeight: '600',
  },
  emptyState: {
    width: '100%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
  },
  emptyStateText: {
    color: theme.colors.textMuted,
  },
  actions: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
});
