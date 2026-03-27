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
import { useHeading } from '../hooks/useHeading';
import { theme } from '../lib/theme';
import { getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ObjectSelection, ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type GuidanceTone = 'ready' | 'info' | 'warning' | 'error';

type GuidanceMessage = {
  title: string;
  message: string;
};

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
    case 'camera_unavailable':
    default:
      return {
        title: 'Camera Not Ready',
        message: 'The camera is not ready for capture yet. Check permissions and wait for initialization.',
      };
  }
}

export function ScanScreen({ route, navigation }: Props) {
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
  const stageReady = Boolean(hasObjectSelection && activeStage && !selectionIssue);

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
                  {autoCapture.isCapturing ? <ActivityIndicator color="#0B1020" /> : null}
                </View>
              </View>
            </Pressable>
          </View>
        </View>

        {!hasObjectSelection ? (
          <ObjectSelectionOverlay
            onConfirm={onConfirmObjectSelection}
            targetType={session.targetType}
            disabled={isSavingSelection}
          />
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
  },
  selectionGuideLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  selectionGuideBox: {
    position: 'absolute',
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: 'rgba(255,209,102,0.8)',
    backgroundColor: 'rgba(255,209,102,0.08)',
  },
  ghostGuideBox: {
    position: 'absolute',
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(143,223,255,0.9)',
    backgroundColor: 'rgba(143,223,255,0.08)',
  },
  selectionGuideBoxReady: {
    borderColor: '#8FDFFF',
    backgroundColor: 'rgba(143,223,255,0.16)',
    shadowColor: '#8FDFFF',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  selectionGuideBoxWarning: {
    borderColor: 'rgba(255,209,102,0.9)',
    backgroundColor: 'rgba(255,209,102,0.12)',
  },
  selectionGuideBoxError: {
    borderColor: 'rgba(255,107,107,0.92)',
    backgroundColor: 'rgba(255,107,107,0.12)',
  },
  ghostArrowBadge: {
    position: 'absolute',
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(8,16,31,0.9)',
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
    color: '#C8F1FF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  captureHud: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: theme.spacing.lg,
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
    borderRadius: 999,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  captureIndicatorInner: {
    width: 66,
    height: 66,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
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
    fontWeight: '700',
    fontSize: 18,
    textAlign: 'center',
  },
});
