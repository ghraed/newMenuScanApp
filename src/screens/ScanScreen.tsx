import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../components/AppButton';
import { CaptureRing } from '../components/CaptureRing';
import { ObjectSelectionOverlay } from '../components/ObjectSelectionOverlay';
import { useAutoCapture } from '../hooks/useAutoCapture';
import {
  AutoCaptureIssue,
  getActiveCaptureStage,
  getCapturePattern,
  getGhostGuideBoxRect,
  validateSelectionFraming,
} from '../lib/captureGuidance';
import {
  TURNTABLE_CALIBRATION_ROTATIONS,
  createDefaultTurntableConfig,
  getTurntableCaptureIntervalMs,
  getTurntableCaptureStartAt,
  getTurntableRotationPeriodMs,
  getTurntableSpeedPreset,
  getMedianRotationPeriodMs,
} from '../lib/turntable';
import { useHeading } from '../hooks/useHeading';
import { AppTheme, useAppTheme } from '../lib/theme';
import { getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ObjectSelection, ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type GuidanceTone = 'ready' | 'info' | 'warning' | 'error';

type GuidanceMessage = {
  title: string;
  message: string;
};

function formatDurationMs(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }

  return `${Math.round(value)} ms`;
}

function buildIssueGuidance(issue: AutoCaptureIssue): GuidanceMessage {
  switch (issue) {
    case 'complete':
      return {
        title: 'Capture Pattern Complete',
        message: 'All required photos are captured. Review the scan and continue to the preview screen.',
      };
    case 'stage_locked':
      return {
        title: 'Follow The Stage Guide',
        message: 'Adjust the camera position for the next ring before trying again.',
      };
    case 'slot_captured':
      return {
        title: 'Angle Already Captured',
        message:
          'This angle is already saved. Rotate to the next open marker before taking another photo.',
      };
    case 'align_to_marker':
      return {
        title: 'Match The Ghost Box',
        message:
          'Move around the object until the ghost box overlaps the main box, then hold still and let the app capture.',
      };
    case 'move_to_next_angle':
      return {
        title: 'Move To A New Angle',
        message:
          'The camera has not changed viewpoint enough yet. Keep rotating until the next ghost box becomes the new overlap target.',
      };
    case 'hold_steady':
      return {
        title: 'Hold Steady',
        message:
          'Stop moving for a moment. When the ghost box lines up and the main box turns light blue, the shot is stable enough to capture.',
      };
    case 'cooldown':
    case 'capturing':
      return {
        title: 'Wait For The Current Shot',
        message: 'Do not move yet. Let the current capture finish before rotating to the next angle.',
      };
    case 'turntable_calibrating':
      return {
        title: 'Calibrate Rotation',
        message: 'Align the mark, tap start, then tap once per full rotation so the app can measure the real loaded speed.',
      };
    case 'turntable_prespin':
      return {
        title: 'Let The Plate Stabilize',
        message: 'Keep the turntable spinning smoothly. Capture starts automatically after the pre-spin finishes.',
      };
    case 'camera_unavailable':
    default:
      return {
        title: 'Camera Not Ready',
        message: 'The camera is not ready for capture yet. Check permissions and wait for initialization.',
      };
  }
}

export function ScanScreen({ route, navigation }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { scanId } = route.params;
  const isFocused = useIsFocused();
  const camera = React.useRef<Camera | null>(null);
  const device = useCameraDevice('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [session, setSession] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const [isSavingSelection, setIsSavingSelection] = useState(false);
  const heading = useHeading({
    enabled: Boolean(isFocused && (session?.captureMode ?? 'orbit') === 'orbit'),
  });
  const autoPreviewTriggeredRef = React.useRef(false);

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

  const pattern = useMemo(() => getCapturePattern(session?.slotsTotal), [session?.slotsTotal]);
  const hasObjectSelection = Boolean(session?.objectSelection);
  const capturedCount = session?.images.length ?? 0;
  const slotsTotal = pattern.totalShots;
  const capturedSlots = useMemo(() => {
    const slots = session?.images.map(image => image.slot) ?? [];
    return Array.from(new Set(slots)).sort((a, b) => a - b);
  }, [session]);
  const activeStage = useMemo(
    () => (session ? getActiveCaptureStage(pattern, capturedSlots) : null),
    [capturedSlots, pattern, session],
  );
  const selectionIssue = useMemo(
    () => validateSelectionFraming(session?.objectSelection),
    [session?.objectSelection],
  );
  const stageReady = Boolean(
    hasObjectSelection &&
      !selectionIssue &&
      (session?.captureMode === 'turntable' ? true : activeStage),
  );
  const turntableConfig = session?.turntableConfig;
  const turntablePreset = useMemo(
    () => getTurntableSpeedPreset(turntableConfig?.speedPresetId),
    [turntableConfig?.speedPresetId],
  );
  const turntableRotationPeriodMs = useMemo(
    () => getTurntableRotationPeriodMs(turntableConfig),
    [turntableConfig],
  );
  const turntableIntervalMs = useMemo(
    () => getTurntableCaptureIntervalMs(turntableRotationPeriodMs, slotsTotal),
    [slotsTotal, turntableRotationPeriodMs],
  );
  const calibrationSamplesCount = turntableConfig?.calibrationSampleTimestamps?.length ?? 0;
  const turntableCaptureStartsInMs = turntableConfig?.captureStartAt
    ? Math.max(0, turntableConfig.captureStartAt - Date.now())
    : null;

  const autoCapture = useAutoCapture({
    cameraRef: camera,
    enabled: Boolean(isFocused && permissionGranted && device && isCameraReady && hasObjectSelection),
    session,
    stageReady,
    captureMode: session?.captureMode ?? 'orbit',
    heading,
    onSessionUpdated: setSession,
  });

  const finishEnabled = hasObjectSelection && capturedCount >= slotsTotal;

  useEffect(() => {
    if (!finishEnabled) {
      autoPreviewTriggeredRef.current = false;
      return;
    }

    if (!autoCapture.isCapturing && !autoPreviewTriggeredRef.current) {
      autoPreviewTriggeredRef.current = true;
      navigation.navigate('Preview', { scanId });
    }
  }, [autoCapture.isCapturing, finishEnabled, navigation, scanId]);

  const selectionGuideTone = useMemo<GuidanceTone>(() => {
    if (selectionIssue) {
      return 'error';
    }

    if (autoCapture.canCaptureNow) {
      return 'ready';
    }

    if (
      autoCapture.issue === 'move_to_next_angle' ||
      autoCapture.issue === 'hold_steady' ||
      autoCapture.issue === 'cooldown' ||
      autoCapture.issue === 'capturing'
    ) {
      return 'warning';
    }

    return 'info';
  }, [autoCapture.canCaptureNow, autoCapture.issue, selectionIssue]);

  const selectionGuideStyle = useMemo(() => {
    const selection = session?.objectSelection;
    if (!selection) {
      return null;
    }

    return {
      left: `${selection.bbox.x * 100}%`,
      top: `${selection.bbox.y * 100}%`,
      width: `${selection.bbox.width * 100}%`,
      height: `${selection.bbox.height * 100}%`,
    } as const;
  }, [session?.objectSelection]);

  const ghostGuideStyle = useMemo(() => {
    const selection = session?.objectSelection;
    if (
      !selection ||
      !activeStage ||
      !hasObjectSelection ||
      session?.captureMode === 'turntable' ||
      selectionIssue ||
      autoCapture.allCaptured ||
      autoCapture.targetDeltaDeg === null
    ) {
      return null;
    }

    const ghostBox = getGhostGuideBoxRect(selection.bbox, autoCapture.targetDeltaDeg, activeStage.shots);
    const opacity = 0.26 + (1 - autoCapture.targetAlignmentProgress) * 0.48;

    return {
      left: `${ghostBox.x * 100}%`,
      top: `${ghostBox.y * 100}%`,
      width: `${ghostBox.width * 100}%`,
      height: `${ghostBox.height * 100}%`,
      opacity,
    } as const;
  }, [
    activeStage,
    autoCapture.allCaptured,
    autoCapture.targetAlignmentProgress,
    autoCapture.targetDeltaDeg,
    hasObjectSelection,
    selectionIssue,
    session?.captureMode,
    session?.objectSelection,
  ]);

  const ghostArrowDirection = useMemo(() => {
    const targetDelta = autoCapture.targetDeltaDeg ?? 0;

    return {
      horizontal:
        targetDelta > 2 ? 'right' : targetDelta < -2 ? 'left' : null,
      vertical: activeStage?.id === 'high' ? 'up' : null,
    } as const;
  }, [activeStage?.id, autoCapture.targetDeltaDeg]);

  const onCaptureMissingSlot = useCallback(() => {
    autoCapture.captureCurrentMissingSlot().then(result => {
      if (!result.ok) {
        const nextGuidance = buildIssueGuidance(result.issue);
        Alert.alert(nextGuidance.title, nextGuidance.message);
      }
    });
  }, [autoCapture]);

  const updateSession = useCallback(
    async (updater: (current: ScanSession) => ScanSession) => {
      const current = getScanSession(scanId) ?? session;
      if (!current) {
        return;
      }

      const nextSession = updater(current);
      await upsertScanSession(nextSession);
      setSession(nextSession);
    },
    [scanId, session],
  );

  const onStartTurntableCalibration = useCallback(() => {
    updateSession(current => ({
      ...current,
      turntableConfig: {
        ...(current.turntableConfig ?? createDefaultTurntableConfig()),
        calibrationSampleStartedAt: Date.now(),
        calibrationSampleTimestamps: [Date.now()],
        measuredRotationPeriodMs: undefined,
        calibrationCompletedAt: undefined,
        preSpinStartedAt: undefined,
        captureStartAt: undefined,
      },
      images: [],
    })).catch(() => undefined);
  }, [updateSession]);

  const onMarkTurntableRotation = useCallback(() => {
    updateSession(current => {
      const existingConfig = current.turntableConfig ?? createDefaultTurntableConfig();
      if (!existingConfig.calibrationSampleStartedAt) {
        return current;
      }

      const now = Date.now();
      const sampleTimestamps = [...(existingConfig.calibrationSampleTimestamps ?? []), now];
      const rotationSamples = sampleTimestamps.slice(1).map((timestamp, index) => timestamp - sampleTimestamps[index]);

      if (rotationSamples.length < TURNTABLE_CALIBRATION_ROTATIONS) {
        return {
          ...current,
          turntableConfig: {
            ...existingConfig,
            calibrationSampleTimestamps: sampleTimestamps,
          },
        };
      }

      const measuredRotationPeriodMs =
        getMedianRotationPeriodMs(rotationSamples.slice(0, TURNTABLE_CALIBRATION_ROTATIONS)) ??
        existingConfig.targetRotationPeriodMs;
      const calibrationCompletedAt = now;

      return {
        ...current,
        turntableConfig: {
          ...existingConfig,
          calibrationSampleTimestamps: sampleTimestamps,
          measuredRotationPeriodMs,
          calibrationCompletedAt,
          preSpinStartedAt: calibrationCompletedAt,
          captureStartAt: getTurntableCaptureStartAt(calibrationCompletedAt, measuredRotationPeriodMs),
        },
      };
    }).catch(() => undefined);
  }, [updateSession]);

  const onResetTurntableCalibration = useCallback(() => {
    updateSession(current => ({
      ...current,
      images: [],
      turntableConfig: current.turntableConfig
        ? {
            ...current.turntableConfig,
            calibrationSampleStartedAt: undefined,
            calibrationSampleTimestamps: undefined,
            measuredRotationPeriodMs: undefined,
            calibrationCompletedAt: undefined,
            preSpinStartedAt: undefined,
            captureStartAt: undefined,
          }
        : createDefaultTurntableConfig(),
    })).catch(() => undefined);
  }, [updateSession]);

  const onFocusObjectPoint = useCallback(
    async ({
      x,
      y,
    }: {
      x: number;
      y: number;
      viewportSize?: ObjectSelection['viewportSize'];
    }): Promise<{ success?: boolean; message?: string }> => {
      if (!permissionGranted || !device || !isCameraReady || !camera.current) {
        return {
          success: false,
          message: 'Camera focus is not ready yet, but you can still adjust the guide manually.',
        };
      }

      if (!device.supportsFocus) {
        return {
          success: false,
          message: 'This camera does not support tap-to-focus, but you can still adjust the guide manually.',
        };
      }

      try {
        await camera.current.focus({ x, y });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message:
            error instanceof Error
              ? `${error.message} You can still adjust the guide manually.`
              : 'Focus failed, but you can still adjust the guide manually.',
        };
      }
    },
    [device, isCameraReady, permissionGranted],
  );

  const onConfirmObjectSelection = useCallback(
    async (selection: ObjectSelection) => {
      if (!session) {
        return;
      }

      const issue = validateSelectionFraming(selection);
      if (issue) {
        Alert.alert(issue.title, issue.message);
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
          photoQualityBalance="speed"
          onInitialized={() => setIsCameraReady(true)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraFallback]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        {selectionGuideStyle ? (
          <View style={styles.selectionGuideLayer} pointerEvents="none">
            {ghostGuideStyle ? (
              <View style={[styles.ghostGuideBox, ghostGuideStyle]}>
                {ghostArrowDirection.horizontal === 'left' ? (
                  <View style={[styles.ghostArrowBadge, styles.ghostArrowLeft]}>
                    <Text style={styles.ghostArrowText}>{'<<<'}</Text>
                  </View>
                ) : null}
                {ghostArrowDirection.horizontal === 'right' ? (
                  <View style={[styles.ghostArrowBadge, styles.ghostArrowRight]}>
                    <Text style={styles.ghostArrowText}>{'>>>'}</Text>
                  </View>
                ) : null}
                {ghostArrowDirection.vertical === 'up' ? (
                  <View style={[styles.ghostArrowBadge, styles.ghostArrowTop]}>
                    <Text style={styles.ghostArrowText}>{'^^^'}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View
              style={[
                styles.selectionGuideBox,
                selectionGuideStyle,
                selectionGuideTone === 'ready' && styles.selectionGuideBoxReady,
                selectionGuideTone === 'warning' && styles.selectionGuideBoxWarning,
                selectionGuideTone === 'error' && styles.selectionGuideBoxError,
              ]}
            />
          </View>
        ) : null}

        <View style={styles.captureHud} pointerEvents="box-none">
          {session.captureMode === 'turntable' && hasObjectSelection ? (
            <View style={styles.turntablePanel}>
              <Text style={styles.turntableTitle}>Turntable Capture</Text>
              <Text style={styles.turntableText}>
                {turntablePreset.title}: target {formatDurationMs(turntablePreset.fullRotationMs)} / rotation
              </Text>
              <Text style={styles.turntableText}>
                Measured {formatDurationMs(turntableRotationPeriodMs)} • {Math.round(turntableIntervalMs)} ms / shot
              </Text>
              <Text style={styles.turntableText}>
                {turntableConfig?.measuredRotationPeriodMs
                  ? turntableCaptureStartsInMs && turntableCaptureStartsInMs > 0
                    ? `Pre-spin running. Auto capture starts in ${formatDurationMs(turntableCaptureStartsInMs)}.`
                    : 'Calibration complete. Keep the plate rotating steadily.'
                  : calibrationSamplesCount === 0
                    ? 'Add a visible mark on the plate edge, align it once, then start calibration.'
                    : `Rotation marks: ${Math.max(0, calibrationSamplesCount - 1)} / ${TURNTABLE_CALIBRATION_ROTATIONS}`}
              </Text>
              <View style={styles.turntableActions}>
                {!turntableConfig?.calibrationSampleStartedAt || turntableConfig?.measuredRotationPeriodMs ? (
                  <AppButton
                    title={turntableConfig?.measuredRotationPeriodMs ? 'Recalibrate' : 'Start Calibration'}
                    variant="secondary"
                    onPress={onStartTurntableCalibration}
                    style={styles.turntableActionButton}
                  />
                ) : (
                  <AppButton
                    title="Mark Full Rotation"
                    variant="secondary"
                    onPress={onMarkTurntableRotation}
                    style={styles.turntableActionButton}
                  />
                )}
                <AppButton
                  title="Reset"
                  variant="danger"
                  onPress={onResetTurntableCalibration}
                  style={styles.turntableActionButton}
                />
              </View>
            </View>
          ) : null}
          <View style={styles.captureArea}>
            <CaptureRing
              slotsTotal={slotsTotal}
              capturedSlots={capturedSlots}
              size={200}
              activeSlot={hasObjectSelection && !autoCapture.allCaptured ? autoCapture.targetSlot : null}
            />
            <Pressable
              onPress={onCaptureMissingSlot}
              disabled={
                !hasObjectSelection ||
                !permissionGranted ||
                !device ||
                !isCameraReady ||
                autoCapture.isCapturing ||
                autoCapture.allCaptured ||
                autoCapture.targetSlot === null
              }
              style={styles.captureButton}>
              <View style={[styles.captureIndicatorOuter, !hasObjectSelection && styles.captureIndicatorDisabled]}>
                <View style={styles.captureIndicatorInner}>
                  {autoCapture.isCapturing ? (
                    <ActivityIndicator color={theme.colors.primaryContrast} />
                  ) : null}
                </View>
              </View>
            </Pressable>
          </View>
        </View>

        {!hasObjectSelection ? (
          <ObjectSelectionOverlay
            onConfirm={onConfirmObjectSelection}
            onFocusPoint={onFocusObjectPoint}
            targetType={session.targetType}
            disabled={isSavingSelection}
          />
        ) : null}
      </SafeAreaView>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.cameraBackdrop,
    },
    cameraFallback: {
      backgroundColor: theme.colors.cameraBackdrop,
    },
    overlay: {
      flex: 1,
    },
    selectionGuideLayer: {
      ...StyleSheet.absoluteFillObject,
    },
    selectionGuideBox: {
      position: 'absolute',
      borderRadius: theme.radius.md,
      borderWidth: 2,
      borderColor: theme.colors.cameraGuide,
      backgroundColor: theme.colors.cameraGuideSoft,
    },
    ghostGuideBox: {
      position: 'absolute',
      borderRadius: theme.radius.md,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: theme.colors.cameraReady,
      backgroundColor: theme.colors.cameraReadySoft,
    },
    selectionGuideBoxReady: {
      borderColor: theme.colors.cameraReady,
      backgroundColor: theme.colors.cameraReadySoft,
      shadowColor: theme.colors.cameraReady,
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 4,
    },
    selectionGuideBoxWarning: {
      borderColor: theme.colors.cameraGuide,
      backgroundColor: theme.colors.cameraGuideSoft,
    },
    selectionGuideBoxError: {
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.dangerSoft,
    },
    ghostArrowBadge: {
      position: 'absolute',
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      backgroundColor: theme.colors.cameraPanel,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
    },
    ghostArrowLeft: {
      left: theme.spacing.xs,
      top: '50%',
      transform: [{ translateY: -12 }],
    },
    ghostArrowRight: {
      right: theme.spacing.xs,
      top: '50%',
      transform: [{ translateY: -12 }],
    },
    ghostArrowTop: {
      top: theme.spacing.xs,
      alignSelf: 'center',
    },
    ghostArrowText: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: 12,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: 1,
    },
    captureHud: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingBottom: theme.spacing.lg,
    },
    turntablePanel: {
      width: '100%',
      marginBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.cameraPanel,
      gap: theme.spacing.xs,
    },
    turntableTitle: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    turntableText: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    turntableActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    turntableActionButton: {
      flex: 1,
    },
    captureArea: {
      width: 236,
      height: 236,
      alignItems: 'center',
      justifyContent: 'center',
    },
    captureButton: {
      position: 'absolute',
      width: 92,
      height: 92,
      alignItems: 'center',
      justifyContent: 'center',
    },
    captureIndicatorOuter: {
      position: 'absolute',
      width: 92,
      height: 92,
      borderRadius: theme.radius.pill,
      borderWidth: 4,
      borderColor: theme.colors.cameraControlOuter,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.cameraControlOuterSoft,
      ...theme.shadows.floating,
    },
    captureIndicatorInner: {
      width: 66,
      height: 66,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.cameraControlInner,
      alignItems: 'center',
      justifyContent: 'center',
    },
    captureIndicatorDisabled: {
      opacity: 0.5,
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
      fontFamily: theme.typography.title.fontFamily,
      fontSize: theme.typography.title.fontSize,
      lineHeight: theme.typography.title.lineHeight,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
      textAlign: 'center',
    },
  });
}
