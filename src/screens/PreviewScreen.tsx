import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import {
  apiAttachScanDish,
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
import {
  menuCopyDishModel,
  menuCreateDish,
  menuGetDish,
  menuListDishes,
  menuUploadDishPreviewImage,
  MenuDish,
} from '../api/menuApi';
import {
  cropFileToSelectionInPlace,
  getSelectionUploadUri,
} from '../lib/objectSelectionImage';
import { AppTheme, useAppTheme } from '../lib/theme';
import { AuthUser, getAuthToken, getAuthUser } from '../storage/authStore';
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

type DishState =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

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

function canRetryModelWithoutUpload(scan: ScanSession) {
  return Boolean(
    scan.remoteScanId &&
      scan.jobId &&
      (scan.status === 'error' || scan.status === 'canceled'),
  );
}

function buildDownloadHeaders() {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  const apiKey = getApiKey();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (apiKey) {
    headers['X-API-KEY'] = apiKey;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function dishHasReusableModel(dish: MenuDish) {
  return dish.assets.some(asset => asset.asset_type === 'glb');
}

function getDishModelPreviewUrl(dish: MenuDish) {
  return (
    dish.assets.find(asset => asset.asset_type === 'preview_image')?.file_url ??
    dish.image_url ??
    undefined
  );
}

export function PreviewScreen({ route, navigation }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { scanId } = route.params;
  const [scan, setScan] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const [authUser, setAuthUser] = useState<AuthUser | undefined>(() => getAuthUser());
  const [dishes, setDishes] = useState<MenuDish[]>([]);
  const [isLoadingDishes, setIsLoadingDishes] = useState(false);
  const [isCreatingDish, setIsCreatingDish] = useState(false);
  const [isCopyingModel, setIsCopyingModel] = useState(false);
  const [isUpdatingPreviewImage, setIsUpdatingPreviewImage] = useState(false);
  const [dishState, setDishState] = useState<DishState>({ kind: 'idle' });
  const [newDishName, setNewDishName] = useState('');
  const [newDishDescription, setNewDishDescription] = useState('');
  const [newDishPrice, setNewDishPrice] = useState('');
  const [newDishCategory, setNewDishCategory] = useState('');
  const [publishNewDish, setPublishNewDish] = useState<boolean>(
    () => getScanSession(scanId)?.publishOnCreate ?? false,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const bgRunningRef = useRef(false);

  const reload = React.useCallback(() => {
    setScan(getScanSession(scanId));
  }, [scanId]);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;

      const loadContext = async () => {
        const nextScan = getScanSession(scanId);
        const nextAuthUser = getAuthUser();

        if (isActive) {
          setScan(nextScan);
          setAuthUser(nextAuthUser);
          setPublishNewDish(nextScan?.publishOnCreate ?? false);
        }

        if (!nextAuthUser?.restaurant) {
          if (isActive) {
            setDishes([]);
          }
          return;
        }

        try {
          if (isActive) {
            setIsLoadingDishes(true);
            setDishState({ kind: 'idle' });
          }

          const loadedDishes = await menuListDishes();
          if (!isActive) {
            return;
          }

          setDishes(loadedDishes);

          if (!nextScan) {
            return;
          }

          const selectedDish = nextScan.dishId
            ? loadedDishes.find(dish => dish.id === nextScan.dishId)
            : undefined;
          const selectedModelSource = nextScan.modelSourceDishId
            ? loadedDishes.find(dish => dish.id === nextScan.modelSourceDishId)
            : undefined;
          let nextSession = nextScan;
          let shouldPersist = false;

          if (
            selectedDish &&
            (nextScan.dishName !== selectedDish.name ||
              nextScan.restaurantId !== nextAuthUser.restaurant.id)
          ) {
            nextSession = {
              ...nextSession,
              restaurantId: nextAuthUser.restaurant.id,
              dishId: selectedDish.id,
              dishName: selectedDish.name,
            };
            shouldPersist = true;
          } else if (!nextScan.restaurantId) {
            nextSession = {
              ...nextSession,
              restaurantId: nextAuthUser.restaurant.id,
            };
            shouldPersist = true;
          }

          if (
            selectedModelSource &&
            (nextSession.modelSourceDishName !== selectedModelSource.name ||
              !dishHasReusableModel(selectedModelSource))
          ) {
            nextSession = {
              ...nextSession,
              modelSourceDishId: dishHasReusableModel(selectedModelSource)
                ? selectedModelSource.id
                : undefined,
              modelSourceDishName: dishHasReusableModel(selectedModelSource)
                ? selectedModelSource.name
                : undefined,
            };
            shouldPersist = true;
          } else if (nextSession.modelSourceDishId && !selectedModelSource) {
            nextSession = {
              ...nextSession,
              modelSourceDishId: undefined,
              modelSourceDishName: undefined,
            };
            shouldPersist = true;
          }

          if (shouldPersist) {
            await upsertScanSession(nextSession);
            if (isActive) {
              setScan(getScanSession(scanId));
            }
          }
        } catch (error) {
          if (!isActive) {
            return;
          }

          setDishState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not load dishes.',
          });
        } finally {
          if (isActive) {
            setIsLoadingDishes(false);
          }
        }
      };

      loadContext().catch(() => undefined);

      return () => {
        isActive = false;
      };
    }, [scanId]),
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
        targetType: session.targetType,
        scaleMeters: session.scaleMeters,
        slotsTotal: session.slotsTotal,
        dishId: session.dishId,
      });

      return commitSession({
        ...session,
        remoteScanId: remote.scanId,
        dishId: remote.dishId ?? session.dishId,
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
          const imageUri = await getSelectionUploadUri(image.path, objectSelection);
          await apiUploadImage({
            scanId: remoteScanId,
            slot: image.slot,
            heading: image.heading,
            objectSelection,
            image: {
              uri: imageUri,
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
              glbUrl: job.outputs?.glbUrl ?? buildFileUrl(remoteScanId, 'glb'),
              glbSignedUrl: job.outputs?.glbSignedUrl,
              usdzUrl: job.outputs?.usdzUrl,
              usdzSignedUrl: job.outputs?.usdzSignedUrl,
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

      const result = await RNFS.downloadFile({
        fromUrl: buildRgbaUrl(remoteScanId, slot),
        toFile: targetPath,
        headers: buildDownloadHeaders(),
      }).promise;

      if (result.statusCode < 200 || result.statusCode >= 300) {
        const exists = await RNFS.exists(targetPath);
        if (exists) {
          await RNFS.unlink(targetPath);
        }
        return null;
      }

      const exists = await RNFS.exists(targetPath);
      if (!exists) {
        return null;
      }

      await cropFileToSelectionInPlace(targetPath, session.objectSelection);
      return targetPath;
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
    [commitSession, syncBackgroundState],
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

        const nextStatus =
          completedCount >= capturedSlots.length
            ? 'ready'
            : completedCount > 0
              ? 'partial'
              : 'processing';
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

  const selectTargetDish = React.useCallback(
    async (dish: MenuDish) => {
      const latest = getScanSession(scanId) ?? scan;
      if (!latest) {
        return;
      }

      const keepModelSelection = latest.dishId === dish.id;

      const next = await commitSession({
        ...latest,
        restaurantId: authUser?.restaurant?.id ?? latest.restaurantId,
        dishId: dish.id,
        dishName: dish.name,
        modelSourceDishId: keepModelSelection ? latest.modelSourceDishId : undefined,
        modelSourceDishName: keepModelSelection ? latest.modelSourceDishName : undefined,
      });

      setScan(next);
      setDishState({ kind: 'success', message: `Target dish selected: ${dish.name}` });
    },
    [authUser?.restaurant?.id, commitSession, scan, scanId],
  );

  const applyExistingModel = React.useCallback(
    async (sourceDish: MenuDish) => {
      const latest = getScanSession(scanId) ?? scan;
      if (!latest) {
        return;
      }

      if (!authUser?.restaurant) {
        setDishState({
          kind: 'error',
          message: 'Log in from Home before applying an existing 3D model.',
        });
        return;
      }

      if (!latest.dishId) {
        setDishState({
          kind: 'error',
          message: 'Choose or create the target dish before selecting an existing 3D model.',
        });
        return;
      }

      if (latest.dishId === sourceDish.id) {
        setDishState({
          kind: 'error',
          message: 'The target dish already owns this model. Pick a different reusable model.',
        });
        return;
      }

      try {
        setIsCopyingModel(true);
        setDishState({ kind: 'idle' });

        const updatedDish = await menuCopyDishModel(latest.dishId, sourceDish.id);
        const next = await commitSession({
          ...latest,
          dishId: updatedDish.id,
          dishName: updatedDish.name,
          modelSourceDishId: sourceDish.id,
          modelSourceDishName: sourceDish.name,
        });

        setDishes(current =>
          current.map(dish => (dish.id === updatedDish.id ? updatedDish : dish)),
        );
        setScan(next);
        setDishState({
          kind: 'success',
          message: `Copied the 3D model from ${sourceDish.name} to ${updatedDish.name}.`,
        });
      } catch (error) {
        setDishState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not apply the selected 3D model.',
        });
      } finally {
        setIsCopyingModel(false);
      }
    },
    [authUser?.restaurant, commitSession, scan, scanId],
  );

  const togglePublishPreference = React.useCallback(
    async (value: boolean) => {
      setPublishNewDish(value);
      const latest = getScanSession(scanId) ?? scan;
      if (!latest) {
        return;
      }

      await commitSession({
        ...latest,
        publishOnCreate: value,
      });
    },
    [commitSession, scan, scanId],
  );

  const createDish = React.useCallback(async () => {
    if (!authUser?.restaurant) {
      setDishState({
        kind: 'error',
        message: 'Log in from Home before creating dishes from the scanner app.',
      });
      return;
    }

    const name = newDishName.trim();
    const category = newDishCategory.trim();
    const price = Number.parseFloat(newDishPrice);

    if (!name) {
      setDishState({ kind: 'error', message: 'Enter a dish name.' });
      return;
    }

    if (!category) {
      setDishState({ kind: 'error', message: 'Enter a category for the new dish.' });
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setDishState({ kind: 'error', message: 'Enter a valid price.' });
      return;
    }

    try {
      setIsCreatingDish(true);
      setDishState({ kind: 'idle' });

      const createdDish = await menuCreateDish({
        name,
        description: newDishDescription.trim() || undefined,
        price,
        category,
        status: publishNewDish ? 'published' : 'draft',
      });

      setDishes(current => [createdDish, ...current.filter(dish => dish.id !== createdDish.id)]);
      await selectTargetDish(createdDish);
      setNewDishName('');
      setNewDishDescription('');
      setNewDishPrice('');
      setNewDishCategory('');
      setDishState({
        kind: 'success',
        message: publishNewDish
          ? 'Dish created and published. It will stay hidden from guests until the model is ready.'
          : 'Dish created as draft. It now appears in the website admin view.',
      });
    } catch (error) {
      setDishState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not create dish.',
      });
    } finally {
      setIsCreatingDish(false);
    }
  }, [
    authUser?.restaurant,
    newDishCategory,
    newDishDescription,
    newDishName,
    newDishPrice,
    publishNewDish,
    selectTargetDish,
  ]);

  const ensureDishAttached = React.useCallback(
    async (session: ScanSession): Promise<ScanSession> => {
      if (!session.dishId) {
        throw new Error('Select or create a dish before generating the 3D model.');
      }

      let current = await ensureRemoteScan(session);
      const remoteScanId = current.remoteScanId;

      if (!remoteScanId) {
        throw new Error('Missing remote scan id');
      }

      const attached = await apiAttachScanDish(remoteScanId, session.dishId);
      current = await commitSession({
        ...current,
        dishId: attached.dishId ?? session.dishId,
      });

      return current;
    },
    [commitSession, ensureRemoteScan],
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
    if (!authUser?.restaurant) {
      Alert.alert('Login Required', 'Log in from Home before generating a 3D model.');
      return;
    }
    if (!latest.dishId) {
      Alert.alert(
        'Dish Required',
        'Select or create the target dish before generating the 3D model.',
      );
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
      let current = await ensureDishAttached(latest);
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

      if (canRetryModelWithoutUpload(current)) {
        current = await commitSession({
          ...current,
          status: 'processing',
          progress: 0,
          message: 'Retrying 3D model generation with existing uploaded images',
        });
      } else {
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
  }, [
    authUser?.restaurant,
    commitSession,
    ensureDishAttached,
    pollJobUntilDone,
    scan,
    scanId,
    uploadWithRetry,
  ]);

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
      if (!authUser?.restaurant) {
        Alert.alert('Login Required', 'Log in from Home before generating background-removed images.');
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

          await deleteScanBackgroundOutputs(current.id);

          current = await commitSession({
            ...current,
            bgJobId: undefined,
            bgStatus: 'uploading',
            bgProgress: 0,
            bgMessage: 'Uploading images for background removal',
            bgAvailableSlots: [],
            bgPreviewAvailable: false,
            bgPreviewReadyAt: undefined,
            bgUploadCompleted: 0,
            bgUploadTotal: totalUploads,
            bgOutputs: undefined,
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
      authUser?.restaurant,
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
        await cropFileToSelectionInPlace(targetPath, scan.objectSelection);
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

  const onDownloadModel = React.useCallback(async () => {
    const modelUrl = scan?.outputs?.glbSignedUrl ?? scan?.outputs?.glbUrl;
    if (!scan || !modelUrl || isSubmitting || isExporting || isDownloadingModel) {
      return;
    }

    if (Platform.OS !== 'android') {
      Alert.alert('Not Supported', 'Model download is currently implemented for Android only.');
      return;
    }

    const hasPermission = await ensureExportPermission();
    if (!hasPermission) {
      Alert.alert('Permission Needed', 'Storage permission is required to save the model file.');
      return;
    }

    setIsDownloadingModel(true);

    try {
      const baseDir = RNFS.DownloadDirectoryPath || RNFS.PicturesDirectoryPath;
      if (!baseDir) {
        throw new Error('No public download directory found on this device.');
      }

      const exportDir = `${baseDir}/MenuScanApp/${scan.id}/model`;
      await RNFS.mkdir(exportDir);

      const targetPath = `${exportDir}/model.glb`;
      const result = await RNFS.downloadFile({
        fromUrl: modelUrl,
        toFile: targetPath,
        headers: scan.outputs?.glbSignedUrl ? undefined : buildDownloadHeaders(),
      }).promise;

      if (result.statusCode < 200 || result.statusCode >= 300) {
        const exists = await RNFS.exists(targetPath);
        if (exists) {
          await RNFS.unlink(targetPath);
        }

        throw new Error(`Failed to download model (HTTP ${result.statusCode}).`);
      }

      try {
        await RNFS.scanFile(targetPath);
      } catch {
        // Some Android versions/devices may not support media scan through RNFS typings/runtime.
      }

      Alert.alert('Model Saved', `GLB model saved to:\n${targetPath}`);
    } catch (error) {
      Alert.alert(
        'Download Failed',
        error instanceof Error ? error.message : 'Could not download the model.',
      );
    } finally {
      if (mountedRef.current) {
        setIsDownloadingModel(false);
      }
    }
  }, [ensureExportPermission, isDownloadingModel, isExporting, isSubmitting, scan]);

  const selectedTargetDish = useMemo(
    () => dishes.find(dish => dish.id === scan?.dishId),
    [dishes, scan?.dishId],
  );
  const orderedCapturedImages = useMemo(
    () => [...(scan?.images ?? [])].sort((a, b) => a.slot - b.slot),
    [scan?.images],
  );
  const selectedPreviewCapture = useMemo(() => {
    if (orderedCapturedImages.length === 0) {
      return undefined;
    }

    if (scan?.previewImageSlot !== undefined) {
      const matched = orderedCapturedImages.find(image => image.slot === scan.previewImageSlot);
      if (matched) {
        return matched;
      }
    }

    return orderedCapturedImages[0];
  }, [orderedCapturedImages, scan?.previewImageSlot]);
  const reusableModelDishes = useMemo(
    () => dishes.filter(dishHasReusableModel),
    [dishes],
  );
  const availableSourceModels = useMemo(
    () => reusableModelDishes.filter(dish => dish.id !== scan?.dishId),
    [reusableModelDishes, scan?.dishId],
  );
  const selectedSourceModel = useMemo(
    () => dishes.find(dish => dish.id === scan?.modelSourceDishId),
    [dishes, scan?.modelSourceDishId],
  );
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
  const isAuthenticated = Boolean(authUser?.restaurant);
  const selectedDishName = selectedTargetDish?.name ?? scan?.dishName;
  const selectedSourceModelName = selectedSourceModel?.name ?? scan?.modelSourceDishName;
  const selectedPreviewLabel = selectedPreviewCapture
    ? `Photo ${selectedPreviewCapture.slot + 1}`
    : 'Choose a captured photo below.';
  const modelDownloadUrl = scan?.outputs?.glbSignedUrl ?? scan?.outputs?.glbUrl;
  const usdzOpenUrl = scan?.outputs?.usdzSignedUrl ?? scan?.outputs?.usdzUrl;

  const selectPreviewImageSlot = React.useCallback(
    async (slot: number) => {
      const latest = getScanSession(scanId) ?? scan;
      if (!latest) {
        return;
      }

      await commitSession({
        ...latest,
        previewImageSlot: slot,
      });
    },
    [commitSession, scan, scanId],
  );

  const applyPreviewImageToDish = React.useCallback(async () => {
    const latest = getScanSession(scanId) ?? scan;
    if (!latest) {
      return;
    }

    if (!authUser?.restaurant) {
      setDishState({
        kind: 'error',
        message: 'Log in from Home before setting a preview image.',
      });
      return;
    }

    if (!latest.dishId) {
      setDishState({
        kind: 'error',
        message: 'Choose or create the target dish before setting its preview image.',
      });
      return;
    }

    const previewCapture =
      orderedCapturedImages.find(image => image.slot === latest.previewImageSlot) ??
      orderedCapturedImages[0];

    if (!previewCapture) {
      setDishState({
        kind: 'error',
        message: 'Capture at least one image before setting a preview image.',
      });
      return;
    }

    try {
      setIsUpdatingPreviewImage(true);
      setDishState({ kind: 'idle' });

      await menuUploadDishPreviewImage(latest.dishId, previewCapture.path);
      const updatedDish = await menuGetDish(latest.dishId);

      setDishes(current =>
        current.map(dish => (dish.id === updatedDish.id ? updatedDish : dish)),
      );

      const next = await commitSession({
        ...latest,
        dishId: updatedDish.id,
        dishName: updatedDish.name,
        previewImageSlot: previewCapture.slot,
      });

      setScan(next);
      setDishState({
        kind: 'success',
        message: `Preview image updated from photo ${previewCapture.slot + 1}.`,
      });
    } catch (error) {
      setDishState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not update the preview image.',
      });
    } finally {
      setIsUpdatingPreviewImage(false);
    }
  }, [authUser?.restaurant, commitSession, orderedCapturedImages, scan, scanId]);

  return (
    <Screen
      title="Preview"
      subtitle={
        scan
          ? 'Review your captured images, choose the target dish, and optionally reuse an existing 3D model before generating a new one.'
          : 'Scan session not found.'
      }>
      {!scan ? (
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
      ) : (
        <>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Size (cm)</Text>
              <Text style={styles.summaryValue}>{Math.round(scan.scaleMeters * 100)} cm</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Captured</Text>
              <Text style={styles.summaryValue}>
                {scan.images.length} / {scan.slotsTotal}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Target Dish</Text>
              <Text style={styles.summaryValue}>{selectedDishName ?? 'Not selected'}</Text>
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

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Target Dish & Model</Text>
            <View style={styles.dishCard}>
              <Text style={styles.label}>Selected Target Dish</Text>
              <Text style={styles.selectedDishName}>
                {selectedDishName ?? 'Choose an existing dish here or open the dish builder.'}
              </Text>
              <Text style={styles.helper}>
                This is the dish that will receive the generated 3D model from the scan pipeline.
              </Text>
              <Text style={styles.label}>Selected Reusable 3D Model</Text>
              <Text style={styles.selectedDishName}>
                {selectedSourceModelName ?? 'None selected yet.'}
              </Text>
              <Text style={styles.helper}>
                Creating a brand-new published dish and assigning an existing model has moved to a separate page.
              </Text>

              {!isAuthenticated ? (
                <View style={styles.inlineNotice}>
                  <Text style={styles.inlineNoticeText}>
                    Log in from Home to load your dishes and reusable 3D models.
                  </Text>
                </View>
              ) : null}

              {dishState.kind !== 'idle' ? (
                <Text
                  style={[
                    styles.statusText,
                    dishState.kind === 'success' ? styles.statusSuccess : styles.statusError,
                  ]}>
                  {dishState.message}
                </Text>
              ) : null}
              <AppButton
                title="Open Dish Builder"
                onPress={() => {
                  navigation.navigate('CreateDish', { scanId });
                }}
                disabled={!isAuthenticated}
              />
            </View>

            <View style={styles.dishCard}>
              <Text style={styles.label}>Use Existing Dish As Target</Text>
              {isLoadingDishes ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : dishes.length === 0 ? (
                <Text style={styles.helper}>
                  {isAuthenticated
                    ? 'No dishes found for this restaurant yet.'
                    : 'Log in to load your restaurant dishes.'}
                </Text>
              ) : (
                <View style={styles.dishList}>
                  {dishes.map(dish => {
                    const isSelected = dish.id === scan.dishId;
                    return (
                      <Pressable
                        key={dish.id}
                        style={[styles.dishRow, isSelected && styles.dishRowSelected]}
                        onPress={() => {
                          selectTargetDish(dish).catch(() => undefined);
                        }}>
                        <View style={styles.dishRowCopy}>
                          <Text style={styles.dishRowTitle}>{dish.name}</Text>
                          <Text style={styles.dishRowMeta}>
                            {dish.category} • ${dish.price.toFixed(2)} • {dish.status}
                          </Text>
                          <Text style={styles.dishRowMeta}>Model: {dish.model_state ?? 'none'}</Text>
                        </View>
                        <Text style={styles.dishRowTag}>{isSelected ? 'Target' : 'Use'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dish Preview Image</Text>
            <View style={styles.dishCard}>
              <Text style={styles.label}>Selected Preview Photo</Text>
              <Text style={styles.selectedDishName}>{selectedPreviewLabel}</Text>
              <Text style={styles.helper}>
                Pick one of your captured photos. This image will be uploaded as the dish preview and can be changed later.
              </Text>

              {orderedCapturedImages.length === 0 ? (
                <Text style={styles.helper}>
                  Capture at least one image from the Scan screen before choosing a preview photo.
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.previewPickerRow}
                  keyboardShouldPersistTaps="handled">
                  {orderedCapturedImages.map(capture => {
                    const isSelected = capture.slot === selectedPreviewCapture?.slot;
                    const uri = capture.path.startsWith('file://') ? capture.path : `file://${capture.path}`;

                    return (
                      <Pressable
                        key={`${capture.slot}_${capture.timestamp}`}
                        style={styles.previewPickerItem}
                        onPress={() => {
                          selectPreviewImageSlot(capture.slot).catch(() => undefined);
                        }}>
                        <Image
                          source={{ uri }}
                          style={[
                            styles.previewPickerImage,
                            isSelected && styles.previewPickerImageSelected,
                          ]}
                        />
                        <Text style={styles.previewPickerLabel}>
                          {isSelected ? `Preview ${capture.slot + 1}` : `Photo ${capture.slot + 1}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <AppButton
                title={isUpdatingPreviewImage ? 'Updating Preview Image...' : 'Apply Preview Image to Dish'}
                onPress={() => {
                  applyPreviewImageToDish().catch(() => undefined);
                }}
                disabled={
                  !isAuthenticated ||
                  isSubmitting ||
                  isExporting ||
                  isUpdatingPreviewImage ||
                  orderedCapturedImages.length === 0 ||
                  !scan.dishId
                }
              />
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

          {scan.status === 'ready' && modelDownloadUrl ? (
            <View style={styles.actions}>
              <AppButton
                title={isDownloadingModel ? 'Downloading GLB...' : 'Download GLB'}
                variant="primary"
                onPress={() => {
                  onDownloadModel().catch(() => undefined);
                }}
                disabled={isDownloadingModel || isSubmitting || isExporting}
              />
              <AppButton
                title="Open GLB"
                variant="secondary"
                onPress={() => {
                  Linking.openURL(modelDownloadUrl).catch(() => undefined);
                }}
              />
              {usdzOpenUrl ? (
                <AppButton
                  title="Open USDZ"
                  variant="secondary"
                  onPress={() => {
                    Linking.openURL(usdzOpenUrl).catch(() => undefined);
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
              disabled={!isAuthenticated || isSubmitting || isExporting || scan.images.length === 0}
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
                !scan.dishId
                  ? 'Select Target Dish to Create 3D Model'
                  : isSubmitting
                    ? scan.status === 'uploading'
                      ? 'Uploading...'
                      : 'Creating 3D Model...'
                    : scan.status === 'error' || scan.status === 'canceled'
                      ? 'Retry Create 3D Model'
                      : 'Create 3D Model'
              }
              onPress={onCreateModel}
              disabled={!isAuthenticated || isSubmitting || isExporting || scan.images.length === 0 || !scan.dishId}
            />
            <AppButton
              title="Discard Scan"
              variant="danger"
              onPress={onDiscard}
              disabled={isSubmitting || isExporting}
            />
            {isSubmitting || isExporting || isDownloadingModel ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    summaryCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
      ...theme.shadows.card,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
    },
    summaryLabel: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    summaryValue: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: 0.2,
      textAlign: 'right',
      flexShrink: 1,
    },
    section: {
      gap: theme.spacing.md,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    dishCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
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
    selectedDishName: {
      color: theme.colors.text,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: theme.typography.title.fontSize,
      lineHeight: theme.typography.title.lineHeight,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    helper: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    inlineNotice: {
      backgroundColor: theme.colors.primarySoft,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      padding: theme.spacing.sm,
    },
    inlineNoticeText: {
      color: theme.colors.text,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      marginTop: theme.spacing.xs,
    },
    switchCopy: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    switchLabel: {
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
    textArea: {
      minHeight: 92,
      textAlignVertical: 'top',
    },
    inlineFields: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    inlineInput: {
      flex: 1,
    },
    dishList: {
      gap: theme.spacing.sm,
    },
    dishRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surfaceAlt,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      padding: theme.spacing.md,
    },
    dishRowSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primarySoft,
    },
    dishRowCopy: {
      flex: 1,
      gap: theme.spacing.xxs,
    },
    modelPreviewFrame: {
      width: 72,
      height: 72,
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modelPreviewImage: {
      width: '100%',
      height: '100%',
    },
    modelPreviewFallback: {
      flex: 1,
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primarySoft,
    },
    modelPreviewFallbackText: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
    },
    dishRowTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    dishRowMeta: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    dishRowTag: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
    },
    previewPickerRow: {
      gap: theme.spacing.sm,
      paddingRight: theme.spacing.xs,
    },
    previewPickerItem: {
      width: 112,
      gap: theme.spacing.xs,
    },
    previewPickerImage: {
      width: 112,
      height: 112,
      borderRadius: theme.radius.md,
      borderWidth: 2,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    previewPickerImageSelected: {
      borderColor: theme.colors.primary,
    },
    previewPickerLabel: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
      textAlign: 'center',
    },
    progressCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
      ...theme.shadows.card,
    },
    progressTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    progressMeta: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    progressTrack: {
      height: 8,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceAlt,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
    },
    progressFill: {
      height: '100%',
      backgroundColor: theme.colors.primary,
    },
    progressMessage: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    errorCard: {
      backgroundColor: theme.colors.dangerSoft,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.danger,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    errorTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    errorText: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
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
      ...theme.shadows.card,
    },
    thumbImage: {
      height: 90,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    thumbMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    thumbLabel: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: 0.2,
    },
    thumbBadge: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
    },
    emptyState: {
      width: '100%',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      ...theme.shadows.card,
    },
    emptyStateText: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.body.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.body.fontWeight,
      letterSpacing: theme.typography.body.letterSpacing,
    },
    actions: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    bgRemovedButton: {
      backgroundColor: theme.colors.success,
      borderColor: theme.colors.success,
    },
    statusText: {
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: '500',
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    statusSuccess: {
      color: theme.colors.success,
    },
    statusError: {
      color: theme.colors.danger,
    },
  });
}
