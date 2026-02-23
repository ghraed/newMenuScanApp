import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { create3DModel } from '../api/modelApi';
import { theme } from '../lib/theme';
import { deleteScanSession, getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Preview'>;

export function PreviewScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const [scan, setScan] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reload = React.useCallback(() => {
    setScan(getScanSession(scanId));
  }, [scanId]);

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const captureCountLabel = useMemo(() => {
    if (!scan) {
      return '0 captures';
    }
    return `${scan.images.length} capture${scan.images.length === 1 ? '' : 's'}`;
  }, [scan]);

  if (!scan) {
    return (
      <Screen title="Preview" subtitle="Scan session not found.">
        <AppButton title="My Scans" onPress={() => navigation.navigate('MyScans')} />
      </Screen>
    );
  }

  const onCreateModel = async () => {
    if (!scan) {
      return;
    }
    setIsSubmitting(true);
    const processingScan: ScanSession = { ...scan, status: 'processing' };
    setScan(processingScan);
    await upsertScanSession(processingScan);
    try {
      const result = await create3DModel(processingScan);
      const readyScan: ScanSession = {
        ...processingScan,
        status: 'ready',
        outputs: processingScan.outputs ?? {},
      };
      setScan(readyScan);
      await upsertScanSession(readyScan);
      Alert.alert(
        '3D Model Requested',
        result.mocked
          ? 'Backend is mocked right now. Request simulated successfully.'
          : 'Request sent to backend successfully.',
      );
    } catch {
      const errorScan: ScanSession = { ...processingScan, status: 'error' };
      setScan(errorScan);
      await upsertScanSession(errorScan);
      Alert.alert('Request Failed', 'Could not create a 3D model request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onDiscard = () => {
    void deleteScanSession(scanId);
    navigation.navigate('MyScans');
  };

  return (
    <Screen
      title="Preview"
      subtitle={`${captureCountLabel} • Status: ${scan.status}`}>
      <View style={styles.thumbGrid}>
        {scan.images.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No captures yet. Add captures from Scan screen.</Text>
          </View>
        ) : (
          scan.images
            .slice()
            .sort((a, b) => a.slot - b.slot)
            .map(capture => (
            <View key={`${capture.slot}_${capture.timestamp}`} style={styles.thumbCard}>
              <Image
                source={{ uri: capture.path.startsWith('file://') ? capture.path : `file://${capture.path}` }}
                style={styles.thumbImage}
              />
              <Text style={styles.thumbLabel}>Slot {capture.slot + 1}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.actions}>
        <AppButton
          title={isSubmitting ? 'Creating 3D Model...' : 'Create 3D Model'}
          onPress={onCreateModel}
          disabled={isSubmitting || scan.images.length === 0}
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
  thumbImage: {
    height: 90,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#0E1428',
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
