import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  apiCancelJob,
  apiCreateScan,
  apiGetJob,
  apiStartBackgroundRemoval,
  apiSubmitScan,
  apiUploadImage,
  buildFileUrl,
  buildRgbaUrl,
} from '../api/scansApi';
import { getApiKey } from '../api/config';
import { theme } from '../lib/theme';
import {
  deleteScanBackgroundOutputs,
  deleteScanSession,
  getScanBgDirectoryPath,
  getScanBgFinalPath,
  getScanBgPreviewPath,
  getScanSession,
  upsertScanSession,
} from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { BackgroundOutput, ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Preview'>;

const BG_UPLOAD_CONCURRENCY = 3;
const BG_FAST_POLL_MS = 1500;
const BG_SLOW_POLL_MS = 3000;
const BG_LEGACY_MAX_POLLS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeProgress(progress: number | undefined) {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  const raw = progress ?? 0;
  const asPercent = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(asPercent)));
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

function getBackgroundCardTitle(scan: ScanSession) {
  switch (scan.bgStatus) {
    case 'uploading':
      return 'Uploading Images';
    case 'queued':
    case 'processing':
      return 'Generating First Preview';
    case 'partial':
      return 'Preview Ready';
    case 'ready':
      return 'Completed';
    case 'canceled':
      return 'Background Removal Canceled';
    case 'error':
      return 'Background Removal Error';
    default:
      return 'Background Removal';
  }
}

function getBackgroundPreviewUri(output: BackgroundOutput) {
  const path = output.finalPath ?? output.previewPath;
  if (!path) {
    return null;
  }

  return path.startsWith('file://') ? path : `file://${path}`;
}

function hasFinalBackgroundOutputs(scan: ScanSession | undefined) {
  if (!scan?.bgOutputs) {
    return false;
  }

  return Object.values(scan.bgOutputs).some(output => Boolean(output.finalPath));
}

function hasAnyBackgroundOutputs(scan: ScanSession | undefined) {
  if (!scan?.bgOutputs) {
    return false;
  }

  return Object.values(scan.bgOutputs).some(output => Boolean(output.finalPath || output.previewPath));
}

function isNetworkOrTimeoutError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('network error') || message.includes('timed out') || message.includes('timeout');
}

function isLegacyBackgroundJob(jobId: string | undefined) {
  return typeof jobId === 'string' && jobId.startsWith('legacy:');
}

function isActiveJobStatus(status: string | undefined) {
  return ['queued', 'processing', 'partial', 'uploading'].includes(status ?? '');
}

export function PreviewScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const [scan, setScan] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const bgRunningRef = useRef(false);

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

  const commitSession = React.useCallback(async (next: ScanSession) => {
    await upsertScanSession(next);
    if (mountedRef.current) {
      setScan(next);
    }
    return next;
  }, []);

  const ensureRemoteScan = React.useCallback(
    async (session: ScanSession): Promise<ScanSession> => {
      if (session.remoteScanId) {
        return session;
      }

      const remote = await apiCreateScan({
        deviceId: session.id,
        targetType: 'dish',
        scaleMeters: session.scaleMeters,
        slotsTotal: session.slotsTotal,
      });

      return commitSession({
        ...session,
        remoteScanId: remote.scanId,
        message: undefined,
      });
    },
    [commitSession],
  );

  const uploadWithRetry = React.useCallback(
    async (
      remoteScanId: string,
      image: ScanSession['images'][number],
      objectSelection?: ScanSession['objectSelection'],
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
            objectSelection,
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
          await sleep(500 * attempt);
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Image upload failed');
    },
    [],
  );

  const pollJobUntilDone = React.useCallback(
    async (session: ScanSession, remoteScanId: string, jobId: string): Promise<ScanSession> => {
      let current = session;

      for (;;) {
        const job = await apiGetJob(jobId);
        const progress = normalizeProgress(job.progress);

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

        if (job.status === 'canceled') {
          return commitSession({
            ...current,
            status: 'canceled',
            progress,
            message: job.message || '3D model processing was canceled.',
          });
        }

        current = await commitSession({
          ...current,
          status: 'processing',
          progress,
          message: job.message,
        });

        await sleep(3000);
      }
    },
    [commitSession],
  );

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

  const downloadBackgroundSlot = React.useCallback(
    async (
      session: ScanSession,
      remoteScanId: string,
      slot: number,
      variant: 'preview' | 'final',
    ): Promise<string | null> => {
      const targetPath =
        variant === 'final'
          ? getScanBgFinalPath(session.id, slot)
          : getScanBgPreviewPath(session.id, slot);

      await RNFS.mkdir(getScanBgDirectoryPath(session.id));

      const apiKey = getApiKey();
      const headers = apiKey ? { 'X-API-KEY': apiKey } : undefined;
      const result = await RNFS.downloadFile({
        fromUrl: buildRgbaUrl(remoteScanId, slot),
        toFile: targetPath,
        headers,
      }).promise;

      if (result.statusCode < 200 || result.statusCode >= 300) {
        const exists = await RNFS.exists(targetPath);
        if (exists) {
          await RNFS.unlink(targetPath);
        }
        return null;
      }

      const exists = await RNFS.exists(targetPath);
      return exists ? targetPath : null;
    },
    [],
  );

  const syncBackgroundState = React.useCallback(
    async (
      session: ScanSession,
      remoteScanId: string,
      jobId: string,
      status: NonNullable<ScanSession['bgStatus']>,
      progress: number,
      availableSlots: number[],
      previewAvailable: boolean,
      message?: string,
    ): Promise<ScanSession> => {
      const capturedSlots = new Set(session.images.map(image => image.slot));
      const filteredSlots = availableSlots.filter(slot => capturedSlots.has(slot)).sort((a, b) => a - b);
      const nextOutputs: Record<string, BackgroundOutput> = { ...(session.bgOutputs ?? {}) };
      const isReady = status === 'ready';
      let previewReadyAt = session.bgPreviewReadyAt;

      for (const slot of filteredSlots) {
        const key = String(slot);
        const existing = nextOutputs[key];
        const needsFinal = isReady && !existing?.finalPath;
        const needsPreview = !isReady && !existing?.previewPath;

        if (!needsFinal && !needsPreview) {
          continue;
        }

        try {
          const savedPath = await downloadBackgroundSlot(
            session,
            remoteScanId,
            slot,
            isReady ? 'final' : 'preview',
          );

          if (!savedPath) {
            continue;
          }

          nextOutputs[key] = {
            slot,
            previewPath: isReady ? existing?.previewPath : savedPath,
            finalPath: isReady ? savedPath : existing?.finalPath,
            updatedAt: Date.now(),
          };

          if (!previewReadyAt) {
            previewReadyAt = Date.now();
          }
        } catch {
          // Keep polling; one missing slot should not block the rest.
        }
      }

      const phaseMessage =
        message ??
        (status === 'uploading'
          ? 'Uploading images for background removal'
          : status === 'queued'
            ? 'Queued for background removal'
            : status === 'processing' && filteredSlots.length === 0
              ? 'Generating first preview'
              : status === 'partial'
                ? 'Improving quality'
                : status === 'ready'
                  ? 'Completed'
                  : 'Background removal failed');

      const mappedProgress =
        status === 'uploading'
          ? progress
          : Math.round(30 + ((progress / 100) * 70));

      return commitSession({
        ...session,
        bgJobId: jobId,
        bgStatus: status,
        bgProgress: mappedProgress,
        bgMessage: phaseMessage,
        bgAvailableSlots: filteredSlots,
        bgPreviewAvailable: previewAvailable,
        bgPreviewReadyAt: previewReadyAt,
        bgOutputs: nextOutputs,
      });
    },
    [commitSession, downloadBackgroundSlot],
  );

  const pollBackgroundJobUntilDone = React.useCallback(
    async (session: ScanSession, remoteScanId: string, jobId: string): Promise<ScanSession> => {
      let current = session;

      for (;;) {
        const job = await apiGetJob(jobId);
        const progress = normalizeProgress(job.progress);
        const availableSlots = job.availableSlots ?? [];
        const previewAvailable = job.previewAvailable ?? availableSlots.length > 0;
        const status =
          job.status === 'processing' && availableSlots.length > 0 ? 'partial' : job.status;

        current = await syncBackgroundState(
          current,
          remoteScanId,
          jobId,
          status,
          progress,
          availableSlots,
          previewAvailable,
          job.message,
        );

        if (job.status === 'ready') {
          return current;
        }

        if (job.status === 'canceled') {
          return commitSession({
            ...current,
            bgStatus: 'canceled',
            bgProgress: progress,
            bgMessage: job.message || 'Background removal was canceled.',
          });
        }

        if (job.status === 'error') {
          throw new Error(job.message || 'Background removal failed.');
        }

        await sleep(availableSlots.length > 0 ? BG_SLOW_POLL_MS : BG_FAST_POLL_MS);
      }
    },
    [syncBackgroundState],
  );

  const pollLegacyBackgroundOutputs = React.useCallback(
    async (
      session: ScanSession,
      remoteScanId: string,
      initialMessage?: string,
    ): Promise<ScanSession> => {
      let current = session;
      const capturedSlots = current.images.map(image => image.slot).sort((a, b) => a - b);

      for (let attempt = 1; attempt <= BG_LEGACY_MAX_POLLS; attempt += 1) {
        const nextOutputs: Record<string, BackgroundOutput> = { ...(current.bgOutputs ?? {}) };
        let completedCount = 0;
        let hasNewDownloads = false;
        let previewReadyAt = current.bgPreviewReadyAt;

        for (const slot of capturedSlots) {
          const existing = nextOutputs[String(slot)];
          if (existing?.finalPath) {
            completedCount += 1;
            continue;
          }

          try {
            const savedPath = await downloadBackgroundSlot(current, remoteScanId, slot, 'final');
            if (!savedPath) {
              continue;
            }

            nextOutputs[String(slot)] = {
              slot,
              previewPath: existing?.previewPath ?? savedPath,
              finalPath: savedPath,
              updatedAt: Date.now(),
            };
            completedCount += 1;
            hasNewDownloads = true;

            if (!previewReadyAt) {
              previewReadyAt = Date.now();
            }
          } catch {
            // Keep probing other captured slots.
          }
        }

        const nextStatus = completedCount >= capturedSlots.length ? 'ready' : completedCount > 0 ? 'partial' : 'processing';
        const nextMessage =
          completedCount >= capturedSlots.length
            ? 'Completed'
            : completedCount > 0
              ? `Preview ready for ${completedCount}/${capturedSlots.length} images. Improving quality...`
              : initialMessage ?? 'Server is still processing background removal. Checking generated images...';

        current = await commitSession({
          ...current,
          bgJobId: current.bgJobId ?? `legacy:${current.id}`,
          bgStatus: nextStatus,
          bgProgress:
            capturedSlots.length === 0
              ? 30
              : 30 + Math.round((completedCount / capturedSlots.length) * 70),
          bgMessage: nextMessage,
          bgAvailableSlots: Object.keys(nextOutputs)
            .map(value => Number(value))
            .filter(value => Number.isFinite(value))
            .sort((a, b) => a - b),
          bgPreviewAvailable: completedCount > 0,
          bgPreviewReadyAt: previewReadyAt,
          bgOutputs: nextOutputs,
        });

        if (completedCount >= capturedSlots.length) {
          return current;
        }

        if (!hasNewDownloads && attempt === BG_LEGACY_MAX_POLLS) {
          throw new Error(
            'Background removal is still processing on the server. Try again in a moment.',
          );
        }

        await sleep(hasNewDownloads ? BG_SLOW_POLL_MS : BG_FAST_POLL_MS);
      }

      return current;
    },
    [commitSession, downloadBackgroundSlot],
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
      let current = await ensureRemoteScan(latest);
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
        await uploadWithRetry(remoteScanId, orderedImages[index], current.objectSelection);
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
  }, [commitSession, ensureRemoteScan, pollJobUntilDone, scan, scanId, uploadWithRetry]);

  const runBackgroundRemovalFlow = React.useCallback(
    async (showReadyAlert: boolean) => {
      if (bgRunningRef.current) {
        return;
      }

      const latest = getScanSession(scanId) ?? scan;
      if (!latest) {
        Alert.alert('Scan Missing', 'This scan session could not be found.');
        return;
      }
      if (latest.images.length === 0) {
        Alert.alert('No Captures', 'Capture at least one image before generating background-removed images.');
        return;
      }

      bgRunningRef.current = true;
      if (mountedRef.current) {
        setIsExporting(true);
      }

      try {
        let current = await ensureRemoteScan(latest);
        const remoteScanId = current.remoteScanId;

        if (!remoteScanId) {
          throw new Error('Missing remote scan id.');
        }

        if (current.bgJobId && isActiveJobStatus(current.bgStatus)) {
          current = isLegacyBackgroundJob(current.bgJobId)
            ? await pollLegacyBackgroundOutputs(current, remoteScanId, current.bgMessage)
            : await pollBackgroundJobUntilDone(current, remoteScanId, current.bgJobId);
        } else {
          const orderedImages = [...current.images].sort((a, b) => a.slot - b.slot);
          const totalUploads = orderedImages.length;
          let completedUploads = 0;

          current = await commitSession({
            ...current,
            bgStatus: 'uploading',
            bgProgress: 0,
            bgMessage: 'Uploading images for background removal',
            bgAvailableSlots: [],
            bgPreviewAvailable: false,
            bgUploadCompleted: 0,
            bgUploadTotal: totalUploads,
          });

          await runWithConcurrency(orderedImages, BG_UPLOAD_CONCURRENCY, async image => {
            await uploadWithRetry(remoteScanId, image, current.objectSelection);
            completedUploads += 1;
            const latestSession = getScanSession(scanId) ?? current;
            current = await commitSession({
              ...latestSession,
              bgStatus: 'uploading',
              bgProgress:
                totalUploads === 0 ? 0 : Math.round((completedUploads / totalUploads) * 30),
              bgMessage: `Uploading images ${completedUploads}/${totalUploads}`,
              bgUploadCompleted: completedUploads,
              bgUploadTotal: totalUploads,
            });
          });

          try {
            const start = await apiStartBackgroundRemoval(remoteScanId, {
              objectSelection: current.objectSelection,
            });

            if (start.legacyCompleted) {
              current = await commitSession({
                ...current,
                bgJobId: start.jobId,
                bgStatus: 'processing',
                bgProgress: 30,
                bgMessage: 'Legacy server detected. Checking generated images...',
                bgAvailableSlots: [],
                bgPreviewAvailable: false,
              });
              current = await pollLegacyBackgroundOutputs(current, remoteScanId, start.message);
            } else {
              current = await syncBackgroundState(
                current,
                remoteScanId,
                start.jobId,
                start.status,
                normalizeProgress(start.progress),
                start.availableSlots,
                start.previewAvailable,
                start.message,
              );

              current = await pollBackgroundJobUntilDone(current, remoteScanId, start.jobId);
            }
          } catch (error) {
            if (!isNetworkOrTimeoutError(error)) {
              throw error;
            }

            current = await commitSession({
              ...current,
              bgJobId: `legacy:${current.id}`,
              bgStatus: 'processing',
              bgProgress: 30,
              bgMessage: 'Server is still processing background removal. Checking generated images...',
              bgAvailableSlots: current.bgAvailableSlots ?? [],
              bgPreviewAvailable: current.bgPreviewAvailable ?? false,
            });
            current = await pollLegacyBackgroundOutputs(
              current,
              remoteScanId,
              'Server is still processing background removal. Checking generated images...',
            );
          }
        }

        if (showReadyAlert && current.bgStatus === 'ready') {
          Alert.alert(
            'Background Images Ready',
            'Background-removed images are ready below. Use Save BG-Removed Images to export them.',
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not generate background-removed images.';
        const latestOnError = getScanSession(scanId) ?? scan;
        if (latestOnError) {
          await commitSession({
            ...latestOnError,
            bgStatus: 'error',
            bgMessage: message,
          });
        }
      } finally {
        bgRunningRef.current = false;
        if (mountedRef.current) {
          setIsExporting(false);
        }
      }
    },
    [
      commitSession,
      ensureRemoteScan,
      pollLegacyBackgroundOutputs,
      pollBackgroundJobUntilDone,
      scan,
      scanId,
      syncBackgroundState,
      uploadWithRetry,
    ],
  );

  const exportCachedBackgroundImages = React.useCallback(async () => {
    if (!scan || !hasFinalBackgroundOutputs(scan) || isSubmitting || isExporting) {
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

      const exportDir = `${baseDir}/MenuScanApp/${scan.id}/bg-removed`;
      await RNFS.mkdir(exportDir);

      const outputs = Object.values(scan.bgOutputs ?? {})
        .filter(output => output.finalPath)
        .sort((a, b) => a.slot - b.slot);

      const exportedPaths: string[] = [];

      for (const output of outputs) {
        const sourcePath = output.finalPath!;
        const slotLabel = String(output.slot + 1).padStart(2, '0');
        const targetPath = `${exportDir}/slot-${slotLabel}-rgba.png`;

        const exists = await RNFS.exists(sourcePath);
        if (!exists) {
          continue;
        }

        await RNFS.copyFile(sourcePath, targetPath);
        exportedPaths.push(targetPath);
      }

      if (exportedPaths.length === 0) {
        throw new Error('No generated background-removed images were cached locally.');
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
        `${exportedPaths.length} background-removed images were exported to:\n${exportDir}`,
      );
    } catch (error) {
      Alert.alert(
        'Export Failed',
        error instanceof Error ? error.message : 'Could not save background-removed images.',
      );
    } finally {
      if (mountedRef.current) {
        setIsExporting(false);
      }
    }
  }, [ensureExportPermission, isExporting, isSubmitting, scan]);

  useEffect(() => {
    if (!scan || runningRef.current || isSubmitting) {
      return;
    }

    if (scan.status === 'uploading' && scan.images.length > 0) {
      runCreateModelFlow().catch(() => undefined);
      return;
    }

    if (scan.status === 'processing' && scan.remoteScanId && scan.jobId) {
      runCreateModelFlow().catch(() => undefined);
    }
  }, [isSubmitting, runCreateModelFlow, scan]);

  useEffect(() => {
    if (!scan || bgRunningRef.current || isSubmitting || isExporting) {
      return;
    }

    if (scan.bgJobId && isActiveJobStatus(scan.bgStatus)) {
      runBackgroundRemovalFlow(false).catch(() => undefined);
    }
  }, [isExporting, isSubmitting, runBackgroundRemovalFlow, scan]);

  const onCreateModel = () => {
    runCreateModelFlow().catch(() => undefined);
  };

  const onDiscard = () => {
    Alert.alert('Discard Scan', 'Delete this scan session and all captured images?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard Scan',
        style: 'destructive',
        onPress: () => {
          (async () => {
            await deleteScanSession(scanId);
            navigation.navigate('Home');
          })().catch(() => undefined);
        },
      },
    ]);
  };

  const onDeleteBackgroundImages = React.useCallback(() => {
    if (!scan || isSubmitting || isExporting || bgRunningRef.current) {
      return;
    }

    Alert.alert(
      'Delete BG-Removed Images',
      'Delete all cached background-removed images for this scan?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            (async () => {
              await deleteScanBackgroundOutputs(scan.id);
              await commitSession({
                ...scan,
                bgJobId: undefined,
                bgStatus: undefined,
                bgProgress: undefined,
                bgMessage: undefined,
                bgAvailableSlots: undefined,
                bgPreviewReadyAt: undefined,
                bgPreviewAvailable: undefined,
                bgUploadCompleted: undefined,
                bgUploadTotal: undefined,
                bgOutputs: undefined,
              });
            })().catch(error => {
              Alert.alert(
                'Delete Failed',
                error instanceof Error
                  ? error.message
                  : 'Could not delete background-removed images.',
              );
            });
          },
        },
      ],
    );
  }, [commitSession, isExporting, isSubmitting, scan]);

  const onCancelProcess = React.useCallback(() => {
    if (!scan) {
      return;
    }

    const isBackgroundActive = Boolean(scan.bgJobId) && isActiveJobStatus(scan.bgStatus);
    const isModelActive = Boolean(scan.jobId) && isActiveJobStatus(scan.status);
    const jobId = isBackgroundActive ? scan.bgJobId : isModelActive ? scan.jobId : undefined;

    if (!jobId) {
      return;
    }

    const title = isBackgroundActive ? 'Cancel Background Removal' : 'Cancel 3D Model';
    const message = isBackgroundActive
      ? 'Stop the current background-removal job?'
      : 'Stop the current 3D model job?';

    Alert.alert(title, message, [
      { text: 'Keep Running', style: 'cancel' },
      {
        text: 'Cancel Process',
        style: 'destructive',
        onPress: () => {
          (async () => {
            const result = await apiCancelJob(jobId);
            const latest = getScanSession(scanId) ?? scan;

            if (isBackgroundActive) {
              await commitSession({
                ...latest,
                bgStatus: 'canceled',
                bgProgress: normalizeProgress(result.progress),
                bgMessage: result.message ?? 'Background removal was canceled.',
              });
            } else {
              await commitSession({
                ...latest,
                status: 'canceled',
                progress: normalizeProgress(result.progress),
                message: result.message ?? '3D model processing was canceled.',
              });
            }
          })().catch(error => {
            Alert.alert(
              'Cancel Failed',
              error instanceof Error ? error.message : 'Could not cancel the active job.',
            );
          });
        },
      },
    ]);
  }, [commitSession, scan, scanId]);

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

      Alert.alert('Images Saved', `${exportedPaths.length} images were exported to:\n${exportDir}`);
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

  const backgroundOutputs = useMemo(
    () =>
      Object.values(scan?.bgOutputs ?? {})
        .filter(output => Boolean(output.previewPath || output.finalPath))
        .sort((a, b) => a.slot - b.slot),
    [scan?.bgOutputs],
  );

  const backgroundButtonTitle = useMemo(() => {
    if (isExporting) {
      return hasFinalBackgroundOutputs(scan)
        ? 'Saving BG-Removed...'
        : 'Preparing BG-Removed...';
    }

    if (hasFinalBackgroundOutputs(scan)) {
      return 'Save BG-Removed Images';
    }

    if (scan?.bgJobId && ['queued', 'processing', 'partial', 'uploading'].includes(scan.bgStatus ?? '')) {
      return 'Resume BG-Removed Images';
    }

    return hasAnyBackgroundOutputs(scan)
      ? 'Refresh BG-Removed Images'
      : 'Generate BG-Removed Images';
  }, [isExporting, scan]);

  return (
    <Screen
      title="Preview"
      subtitle={scan ? 'Review your captured images before creating a 3D model.' : 'Scan session not found.'}>
      {!scan ? (
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
      ) : (
        <>
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
            {scan.bgStatus ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>BG Removal</Text>
                <Text style={styles.summaryValue}>{scan.bgStatus}</Text>
              </View>
            ) : null}
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
                      source={{
                        uri: capture.path.startsWith('file://') ? capture.path : `file://${capture.path}`,
                      }}
                      style={styles.thumbImage}
                    />
                    <Text style={styles.thumbLabel}>Slot {capture.slot + 1}</Text>
                  </View>
                ))
            )}
          </View>

          {backgroundOutputs.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Background-Removed Preview</Text>
              <View style={styles.thumbGrid}>
                {backgroundOutputs.map(output => {
                  const uri = getBackgroundPreviewUri(output);
                  if (!uri) {
                    return null;
                  }

                  return (
                    <View key={`bg_${output.slot}_${output.updatedAt}`} style={styles.thumbCard}>
                      <Image source={{ uri }} style={styles.thumbImage} resizeMode="contain" />
                      <View style={styles.thumbMetaRow}>
                        <Text style={styles.thumbLabel}>Slot {output.slot + 1}</Text>
                        <Text style={styles.thumbBadge}>{output.finalPath ? 'Final' : 'Preview'}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

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

          {scan.bgStatus && !['idle', 'error'].includes(scan.bgStatus) ? (
            <View style={styles.progressCard}>
              <Text style={styles.progressTitle}>{getBackgroundCardTitle(scan)}</Text>
              {scan.bgStatus === 'uploading' ? (
                <Text style={styles.progressMeta}>
                  {scan.bgUploadCompleted ?? 0} / {scan.bgUploadTotal ?? scan.images.length}
                </Text>
              ) : (
                <Text style={styles.progressMeta}>{Math.round(scan.bgProgress ?? 0)}%</Text>
              )}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(0, Math.min(100, Math.round(scan.bgProgress ?? 0)))}%` },
                  ]}
                />
              </View>
              {scan.bgMessage ? <Text style={styles.progressMessage}>{scan.bgMessage}</Text> : null}
            </View>
          ) : null}

          {scan.status === 'error' && scan.message ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Processing Error</Text>
              <Text style={styles.errorText}>{scan.message}</Text>
            </View>
          ) : null}

          {scan.status === 'canceled' && scan.message ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>3D Model Canceled</Text>
              <Text style={styles.errorText}>{scan.message}</Text>
            </View>
          ) : null}

          {scan.bgStatus === 'error' && scan.bgMessage ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Background Removal Error</Text>
              <Text style={styles.errorText}>{scan.bgMessage}</Text>
            </View>
          ) : null}

          {scan.bgStatus === 'canceled' && scan.bgMessage ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Background Removal Canceled</Text>
              <Text style={styles.errorText}>{scan.bgMessage}</Text>
            </View>
          ) : null}

          {scan.status === 'ready' && scan.outputs?.glbUrl ? (
            <View style={styles.actions}>
              <AppButton
                title="Open GLB"
                variant="secondary"
                onPress={() => {
                  Linking.openURL(scan.outputs!.glbUrl!).catch(() => undefined);
                }}
              />
              {scan.outputs?.usdzUrl ? (
                <AppButton
                  title="Open USDZ"
                  variant="secondary"
                  onPress={() => {
                    Linking.openURL(scan.outputs!.usdzUrl!).catch(() => undefined);
                  }}
                />
              ) : null}
            </View>
          ) : null}

          <View style={styles.actions}>
            <AppButton
              title={isExporting ? 'Saving Images...' : 'Download Images'}
              variant="secondary"
              onPress={() => {
                onDownloadImages().catch(() => undefined);
              }}
              disabled={isSubmitting || isExporting || scan.images.length === 0}
            />
            <AppButton
              title={backgroundButtonTitle}
              variant="primary"
              style={styles.bgRemovedButton}
              onPress={() => {
                if (hasFinalBackgroundOutputs(scan)) {
                  exportCachedBackgroundImages().catch(() => undefined);
                  return;
                }

                runBackgroundRemovalFlow(true).catch(() => undefined);
              }}
              disabled={isSubmitting || isExporting || scan.images.length === 0}
            />
            {hasAnyBackgroundOutputs(scan) || scan.bgStatus ? (
              <AppButton
                title="Delete BG-Removed Images"
                variant="danger"
                onPress={onDeleteBackgroundImages}
                disabled={
                  isSubmitting ||
                  isExporting ||
                  bgRunningRef.current ||
                  isActiveJobStatus(scan.bgStatus)
                }
              />
            ) : null}
            {(isActiveJobStatus(scan.status) && scan.jobId) || (isActiveJobStatus(scan.bgStatus) && scan.bgJobId) ? (
              <AppButton
                title={isActiveJobStatus(scan.bgStatus) ? 'Cancel BG Process' : 'Cancel 3D Process'}
                variant="danger"
                onPress={onCancelProcess}
                disabled={false}
              />
            ) : null}
            <AppButton
              title={
                isSubmitting
                  ? scan.status === 'uploading'
                    ? 'Uploading...'
                    : 'Creating 3D Model...'
                  : scan.status === 'error' || scan.status === 'canceled'
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
        </>
      )}
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
  section: {
    gap: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
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
  thumbMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  thumbLabel: {
    color: theme.colors.text,
    fontWeight: '600',
  },
  thumbBadge: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '700',
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
  bgRemovedButton: {
    backgroundColor: '#3A8D5D',
    borderColor: '#3A8D5D',
  },
});
