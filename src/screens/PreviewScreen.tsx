import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import {
  apiCreateScan,
  apiGetJob,
  apiSubmitScan,
  apiUploadImage,
  buildFileUrl,
} from '../api/scansApi';
import { theme } from '../lib/theme';
import { deleteScanSession, getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Preview'>;

export function PreviewScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const [scan, setScan] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);

  const reload = React.useCallback(() => {
    setScan(getScanSession(scanId));
  }, [scanId]);

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!scan) {
    return (
      <Screen title="Preview" subtitle="Scan session not found.">
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
      </Screen>
    );
  }

  const commitSession = React.useCallback(async (next: ScanSession) => {
    await upsertScanSession(next);
    if (mountedRef.current) {
      setScan(next);
    }
    return next;
  }, []);

  const uploadWithRetry = React.useCallback(
    async (
      remoteScanId: string,
      image: ScanSession['images'][number],
      retries: number = 2,
    ): Promise<void> => {
      let attempt = 0;
      let lastError: unknown;

      while (attempt <= retries) {
        try {
          await apiUploadImage({
            scanId: remoteScanId,
            slot: image.slot,
            heading: image.heading,
            image: {
              uri: image.path.startsWith('file://') ? image.path : `file://${image.path}`,
              name: `${image.slot}.jpg`,
              type: 'image/jpeg',
            },
          });
          return;
        } catch (error) {
          lastError = error;
          attempt += 1;
          if (attempt > retries) {
            break;
          }
          await new Promise<void>(resolve => setTimeout(resolve, 500 * attempt));
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Image upload failed');
    },
    [],
  );

  const pollJobUntilDone = React.useCallback(
    async (session: ScanSession, remoteScanId: string, jobId: string): Promise<ScanSession> => {
      let current = session;

      // Poll every 3 seconds until the backend reports a terminal state.
      for (;;) {
        const job = await apiGetJob(jobId);
        // Backend job progress is stored as a fraction (0..1), while UI renders 0..100.
        const rawProgress = Number.isFinite(job.progress) ? job.progress : 0;
        const progressPercent = rawProgress <= 1 ? rawProgress * 100 : rawProgress;
        const progress = Math.max(0, Math.min(100, Math.round(progressPercent)));

        if (job.status === 'ready') {
          const readyScan: ScanSession = {
            ...current,
            status: 'ready',
            progress: 100,
            message: job.message,
            outputs: {
              glbUrl: buildFileUrl(remoteScanId, 'glb'),
              usdzUrl: job.outputs?.usdzUrl ? buildFileUrl(remoteScanId, 'usdz') : undefined,
            },
          };
          return commitSession(readyScan);
        }

        if (job.status === 'error') {
          const errorScan: ScanSession = {
            ...current,
            status: 'error',
            progress,
            message: job.message || '3D model processing failed.',
          };
          await commitSession(errorScan);
          throw new Error(errorScan.message);
        }

        current = await commitSession({
          ...current,
          status: 'processing',
          progress,
          message: job.message,
        });

        await new Promise<void>(resolve => setTimeout(resolve, 3000));
      }
    },
    [commitSession],
  );

  const runCreateModelFlow = React.useCallback(async () => {
    if (runningRef.current) {
      return;
    }

    const latest = getScanSession(scanId);
    if (!latest) {
      Alert.alert('Scan Missing', 'This scan session could not be found.');
      return;
    }
    if (latest.images.length === 0) {
      Alert.alert('No Captures', 'Capture at least one image before creating a 3D model.');
      return;
    }

    runningRef.current = true;
    if (mountedRef.current) {
      setIsSubmitting(true);
    }

    try {
      let current = latest;

      if (!current.remoteScanId) {
        const remote = await apiCreateScan({
          deviceId: current.id,
          targetType: 'dish',
          scaleMeters: current.scaleMeters,
          slotsTotal: current.slotsTotal,
        });

        current = await commitSession({
          ...current,
          remoteScanId: remote.scanId,
          message: undefined,
        });
      }

      const remoteScanId = current.remoteScanId;
      if (!remoteScanId) {
        throw new Error('Missing remote scan id');
      }

      if (current.jobId && current.status === 'processing') {
        const existingJobId = current.jobId;
        current = await commitSession({
          ...current,
          status: 'processing',
          progress: current.progress ?? 0,
          message: current.message,
        });
        await pollJobUntilDone(current, remoteScanId, existingJobId);
        Alert.alert('3D Model Ready', 'Your model files are ready to open.');
        return;
      }

      const orderedImages = [...current.images].sort((a, b) => a.slot - b.slot);
      const totalUploads = orderedImages.length;

      current = await commitSession({
        ...current,
        status: 'uploading',
        progress: 0,
        uploadCompleted: 0,
        uploadTotal: totalUploads,
        message: undefined,
      });

      for (let index = 0; index < orderedImages.length; index += 1) {
        await uploadWithRetry(remoteScanId, orderedImages[index]);
        const completed = index + 1;
        current = await commitSession({
          ...current,
          status: 'uploading',
          progress: totalUploads === 0 ? 0 : Math.round((completed / totalUploads) * 100),
          uploadCompleted: completed,
          uploadTotal: totalUploads,
        });
      }

      const submitResult = await apiSubmitScan(remoteScanId);
      current = await commitSession({
        ...current,
        status: 'processing',
        jobId: submitResult.jobId,
        progress: 0,
      });

      await pollJobUntilDone(current, remoteScanId, submitResult.jobId);
      Alert.alert('3D Model Ready', 'Your model files are ready to open.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create 3D model.';
      const latestOnError = getScanSession(scanId) ?? scan;
      if (latestOnError) {
        await commitSession({
          ...latestOnError,
          status: 'error',
          message,
        });
      }
      Alert.alert('Request Failed', message);
    } finally {
      runningRef.current = false;
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [commitSession, pollJobUntilDone, scan, scanId, uploadWithRetry]);

  useEffect(() => {
    if (!scan || runningRef.current || isSubmitting) {
      return;
    }

    if (scan.status === 'uploading' && scan.images.length > 0) {
      void runCreateModelFlow();
      return;
    }

    if (scan.status === 'processing' && scan.remoteScanId && scan.jobId) {
      void runCreateModelFlow();
    }
  }, [isSubmitting, runCreateModelFlow, scan]);

  const onCreateModel = () => {
    void runCreateModelFlow();
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

  const ensureExportPermission = React.useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return true;
    }

    const sdk = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    if (Number.isFinite(sdk) && sdk >= 29) {
      return true;
    }

    const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
    if (!permission) {
      return true;
    }

    const granted = await PermissionsAndroid.request(permission, {
      title: 'Storage Permission',
      message: 'Allow access to save scan images to your gallery.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    });

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }, []);

  const onDownloadImages = React.useCallback(async () => {
    if (!scan || scan.images.length === 0 || isSubmitting || isExporting) {
      return;
    }

    if (Platform.OS !== 'android') {
      Alert.alert('Not Supported', 'Download to gallery is currently implemented for Android only.');
      return;
    }

    const hasPermission = await ensureExportPermission();
    if (!hasPermission) {
      Alert.alert('Permission Needed', 'Storage permission is required to save images to gallery.');
      return;
    }

    setIsExporting(true);

    try {
      const baseDir = RNFS.PicturesDirectoryPath || RNFS.DownloadDirectoryPath;
      if (!baseDir) {
        throw new Error('No public pictures/download directory found on this device.');
      }

      const exportDir = `${baseDir}/MenuScanApp/${scan.id}`;
      await RNFS.mkdir(exportDir);

      const sortedImages = [...scan.images].sort((a, b) => a.slot - b.slot);
      const exportedPaths: string[] = [];

      for (const capture of sortedImages) {
        const sourcePath = capture.path.startsWith('file://')
          ? capture.path.replace('file://', '')
          : capture.path;
        const slotLabel = String(capture.slot + 1).padStart(2, '0');
        const targetPath = `${exportDir}/slot-${slotLabel}.jpg`;

        const exists = await RNFS.exists(sourcePath);
        if (!exists) {
          throw new Error(`Missing source image for slot ${capture.slot + 1}`);
        }

        await RNFS.copyFile(sourcePath, targetPath);
        exportedPaths.push(targetPath);
      }

      try {
        for (const exportedPath of exportedPaths) {
          await RNFS.scanFile(exportedPath);
        }
      } catch {
        // Some Android versions/devices may not support media scan through RNFS typings/runtime.
      }

      Alert.alert(
        'Images Saved',
        `${exportedPaths.length} images were exported to:\n${exportDir}`,
      );
    } catch (error) {
      Alert.alert(
        'Export Failed',
        error instanceof Error ? error.message : 'Could not save images to gallery.',
      );
    } finally {
      if (mountedRef.current) {
        setIsExporting(false);
      }
    }
  }, [ensureExportPermission, isExporting, isSubmitting, scan]);

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

      {(scan.status === 'uploading' || scan.status === 'processing') && (
        <View style={styles.progressCard}>
          <Text style={styles.progressTitle}>
            {scan.status === 'uploading' ? 'Uploading Images' : 'Processing 3D Model'}
          </Text>
          {scan.status === 'uploading' ? (
            <Text style={styles.progressMeta}>
              {scan.uploadCompleted ?? 0} / {scan.uploadTotal ?? scan.images.length}
            </Text>
          ) : (
            <Text style={styles.progressMeta}>{Math.round(scan.progress ?? 0)}%</Text>
          )}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(0, Math.min(100, Math.round(scan.progress ?? 0)))}%` },
              ]}
            />
          </View>
          {scan.message ? <Text style={styles.progressMessage}>{scan.message}</Text> : null}
        </View>
      )}

      {scan.status === 'error' && scan.message ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Processing Error</Text>
          <Text style={styles.errorText}>{scan.message}</Text>
        </View>
      ) : null}

      {scan.status === 'ready' && scan.outputs?.glbUrl ? (
        <View style={styles.actions}>
          <AppButton
            title="Open GLB"
            variant="secondary"
            onPress={() => {
              void Linking.openURL(scan.outputs!.glbUrl!);
            }}
          />
          {scan.outputs?.usdzUrl ? (
            <AppButton
              title="Open USDZ"
              variant="secondary"
              onPress={() => {
                void Linking.openURL(scan.outputs!.usdzUrl!);
              }}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <AppButton
          title={isExporting ? 'Saving Images...' : 'Download Images'}
          variant="secondary"
          onPress={() => void onDownloadImages()}
          disabled={isSubmitting || isExporting || scan.images.length === 0}
        />
        <AppButton
          title={
            isSubmitting
              ? scan.status === 'uploading'
                ? 'Uploading...'
                : 'Creating 3D Model...'
              : scan.status === 'error'
                ? 'Retry Create 3D Model'
                : 'Create 3D Model'
          }
          onPress={onCreateModel}
          disabled={isSubmitting || isExporting || scan.images.length === 0}
        />
        <AppButton
          title="Discard Scan"
          variant="danger"
          onPress={onDiscard}
          disabled={isSubmitting || isExporting}
        />
        {isSubmitting || isExporting ? <ActivityIndicator color={theme.colors.primary} /> : null}
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
  progressCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  progressTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  progressMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceAlt,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
  },
  progressMessage: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  errorCard: {
    backgroundColor: '#2B1318',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  errorTitle: {
    color: theme.colors.text,
    fontWeight: '700',
  },
  errorText: {
    color: theme.colors.textMuted,
    fontSize: 13,
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
