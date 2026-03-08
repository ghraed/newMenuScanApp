import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../components/AppButton';
import { CaptureRing } from '../components/CaptureRing';
import { ObjectSelectionOverlay } from '../components/ObjectSelectionOverlay';
import { useAutoCapture } from '../hooks/useAutoCapture';
import { useHeading } from '../hooks/useHeading';
import { theme } from '../lib/theme';
import { getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ObjectSelection, ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

export function ScanScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const isFocused = useIsFocused();
  const camera = React.useRef<Camera | null>(null);
  const device = useCameraDevice('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [session, setSession] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const [isSavingSelection, setIsSavingSelection] = useState(false);
  const heading = useHeading({ enabled: isFocused });

  const reloadSession = useCallback(() => {
    setSession(getScanSession(scanId));
  }, [scanId]);

  useFocusEffect(
    useCallback(() => {
      reloadSession();
    }, [reloadSession]),
  );

  const requestCameraPermission = useCallback(async () => {
    const current = await Camera.getCameraPermissionStatus();
    if (current === 'granted') {
      setPermissionGranted(true);
      return;
    }
    const requested = await Camera.requestCameraPermission();
    setPermissionGranted(requested === 'granted');
  }, []);

  React.useEffect(() => {
    requestCameraPermission().catch(() => {
      setPermissionGranted(false);
    });
  }, [requestCameraPermission]);

  const hasObjectSelection = Boolean(session?.objectSelection);

  const autoCapture = useAutoCapture({
    cameraRef: camera,
    enabled: Boolean(isFocused && permissionGranted && device && isCameraReady && hasObjectSelection),
    session,
    heading,
    onSessionUpdated: setSession,
  });

  const capturedCount = session?.images.length ?? 0;
  const slotsTotal = session?.slotsTotal ?? 24;
  const capturedSlots = useMemo(() => {
    const slots = session?.images.map(image => image.slot) ?? [];
    return Array.from(new Set(slots)).sort((a, b) => a - b);
  }, [session]);
  const finishEnabled = hasObjectSelection && capturedCount >= 12;
  const currentSlotLabel =
    hasObjectSelection && autoCapture.currentSlot !== null ? `Slot ${autoCapture.currentSlot + 1}` : null;

  const onCaptureMissingSlot = useCallback(() => {
    autoCapture.captureCurrentMissingSlot().catch(() => undefined);
  }, [autoCapture]);

  const onConfirmObjectSelection = useCallback(
    async (selection: ObjectSelection) => {
      if (!session) {
        return;
      }

      try {
        setIsSavingSelection(true);
        const nextSession: ScanSession = {
          ...session,
          objectSelection: selection,
          status: 'draft',
          message: undefined,
        };
        await upsertScanSession(nextSession);
        setSession(nextSession);
      } finally {
        setIsSavingSelection(false);
      }
    },
    [session],
  );

  const onResetObjectSelection = useCallback(async () => {
    if (!session) {
      return;
    }

    try {
      setIsSavingSelection(true);
      const nextSession: ScanSession = {
        ...session,
        objectSelection: undefined,
        status: 'draft',
        message: undefined,
      };
      await upsertScanSession(nextSession);
      setSession(nextSession);
    } finally {
      setIsSavingSelection(false);
    }
  }, [session]);

  if (!session) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Scan session not found</Text>
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {permissionGranted && device ? (
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused}
          photo
          onInitialized={() => setIsCameraReady(true)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraFallback]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.topHud}>
          <Text style={styles.hudTitle}>
            {hasObjectSelection ? 'Auto capture is on' : 'Select object before capture'}
          </Text>
          <Text style={styles.hudSubtitle}>
            {hasObjectSelection
              ? `Captured ${capturedCount}/${slotsTotal}. Manual capture only fills missing slots.`
              : 'Tap object or place a bounding box'}
          </Text>
          {hasObjectSelection && autoCapture.holdSteady ? (
            <Text style={styles.hudWarning}>Hold steady...</Text>
          ) : null}
          {hasObjectSelection && currentSlotLabel ? (
            <Text style={styles.hudSlotStatus}>
              {autoCapture.currentSlotCaptured
                ? `${currentSlotLabel} already captured`
                : `${currentSlotLabel} is missing`}
            </Text>
          ) : null}
          {!permissionGranted ? (
            <Pressable
              style={styles.permissionChip}
              onPress={() => {
                requestCameraPermission().catch(() => {
                  setPermissionGranted(false);
                });
              }}>
              <Text style={styles.permissionChipText}>Grant Camera Access</Text>
            </Pressable>
          ) : null}
          {hasObjectSelection ? (
            <Pressable
              style={[styles.permissionChip, styles.selectionChip]}
              onPress={() => {
                onResetObjectSelection().catch(() => undefined);
              }}
              disabled={isSavingSelection}>
              <Text style={styles.permissionChipText}>
                {isSavingSelection ? 'Updating...' : 'Reselect Object'}
              </Text>
            </Pressable>
          ) : null}
          {permissionGranted && !device ? (
            <Text style={styles.hudWarning}>No back camera device found.</Text>
          ) : null}
        </View>

        <View style={styles.bottomHud}>
          <View style={styles.captureArea}>
            <CaptureRing
              slotsTotal={slotsTotal}
              capturedSlots={capturedSlots}
              size={190}
              activeSlot={hasObjectSelection ? autoCapture.currentSlot : null}
            />
            <View style={styles.captureIndicatorOuter}>
              <View
                style={[
                  styles.captureIndicatorInner,
                  autoCapture.isCapturing && styles.captureIndicatorBusy,
                  !hasObjectSelection && styles.captureIndicatorDisabled,
                ]}>
                {autoCapture.isCapturing ? <ActivityIndicator color="#0B1020" /> : null}
              </View>
            </View>
          </View>

          {hasObjectSelection ? (
            <AppButton
              title={
                autoCapture.isCapturing
                  ? 'Capturing...'
                  : autoCapture.currentSlotCaptured
                    ? `${currentSlotLabel ?? 'Current slot'} Captured`
                    : `Capture ${currentSlotLabel ?? 'Missing Slot'}`
              }
              variant="secondary"
              onPress={onCaptureMissingSlot}
              disabled={
                !permissionGranted ||
                !device ||
                !isCameraReady ||
                autoCapture.isCapturing ||
                autoCapture.currentSlot === null ||
                autoCapture.currentSlotCaptured
              }
              style={styles.manualCaptureButton}
            />
          ) : null}

          <AppButton
            title="Finish"
            onPress={() => navigation.navigate('Preview', { scanId })}
            disabled={!finishEnabled}
            style={styles.finishButton}
          />
        </View>

        {!hasObjectSelection ? (
          <ObjectSelectionOverlay onConfirm={onConfirmObjectSelection} disabled={isSavingSelection} />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraFallback: {
    backgroundColor: '#060A16',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topHud: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  hudTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  hudSubtitle: {
    color: '#E8ECFA',
    fontSize: 14,
    textAlign: 'center',
  },
  hudWarning: {
    color: '#FFD166',
    fontSize: 13,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  hudSlotStatus: {
    color: '#9FD3FF',
    fontSize: 13,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  permissionChip: {
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
    backgroundColor: 'rgba(18,26,48,0.9)',
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  permissionChipText: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  selectionChip: {
    marginTop: theme.spacing.xs,
  },
  bottomHud: {
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  captureArea: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIndicatorOuter: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  captureIndicatorInner: {
    width: 62,
    height: 62,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIndicatorBusy: {
    backgroundColor: '#B5F1C5',
  },
  captureIndicatorDisabled: {
    opacity: 0.5,
  },
  finishButton: {
    width: '100%',
    maxWidth: 280,
  },
  manualCaptureButton: {
    width: '100%',
    maxWidth: 280,
  },
  fallback: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  fallbackTitle: {
    color: theme.colors.text,
    fontWeight: '700',
    fontSize: 18,
    textAlign: 'center',
  },
});
