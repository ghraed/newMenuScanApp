import React, { useState } from 'react';
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

  if (!scan) {
    return (
      <Screen title="Preview" subtitle="Scan session not found.">
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
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
    Alert.alert('Discard Scan', 'Delete this scan session and all captured images?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard Scan',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteScanSession(scanId);
            navigation.navigate('Home');
          })();
        },
      },
    ]);
  };

  return (
    <Screen
      title="Preview"
      subtitle="Review your captured images before creating a 3D model.">
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Scale (meters)</Text>
          <Text style={styles.summaryValue}>{scan.scaleMeters.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Captured</Text>
          <Text style={styles.summaryValue}>
            {scan.images.length} / {scan.slotsTotal}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Status</Text>
          <Text style={styles.summaryValue}>{scan.status}</Text>
        </View>
      </View>

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
        <AppButton title="Discard Scan" variant="danger" onPress={onDiscard} disabled={isSubmitting} />
        {isSubmitting ? <ActivityIndicator color={theme.colors.primary} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  summaryLabel: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  summaryValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
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
