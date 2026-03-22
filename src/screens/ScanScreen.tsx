import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../components/AppButton';
import { CaptureRing } from '../components/CaptureRing';
import { ObjectSelectionOverlay } from '../components/ObjectSelectionOverlay';
import { AutoCaptureIssue, useAutoCapture } from '../hooks/useAutoCapture';
import {
  CaptureStageProgress,
  getActiveCaptureStage,
  getCapturePattern,
  validateSelectionFraming,
} from '../lib/captureGuidance';
import { useHeading } from '../hooks/useHeading';
import { theme } from '../lib/theme';
import { getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ObjectSelection, ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;
type GuidanceTone = 'ready' | 'info' | 'warning' | 'error';

type GuidanceCard = {
  tone: GuidanceTone;
  title: string;
  message: string;
};

function buildIssueGuidance(issue: AutoCaptureIssue, activeStage: CaptureStageProgress | null): GuidanceCard {
  switch (issue) {
    case 'complete':
      return {
        tone: 'ready',
        title: 'Capture Pattern Complete',
        message: 'All required photos are captured. Review the scan and continue to the preview screen.',
      };
    case 'stage_locked':
      return {
        tone: 'warning',
        title: activeStage?.promptTitle ?? 'Follow The Stage Guide',
        message:
          activeStage?.promptMessage ??
          'Acknowledge the current ring instruction before the app allows new captures.',
      };
    case 'slot_captured':
      return {
        tone: 'info',
        title: 'Angle Already Captured',
        message:
          'This angle is already saved. Rotate to the next open marker before taking another photo.',
      };
    case 'align_to_marker':
      return {
        tone: 'info',
        title: 'Rotate To The Highlighted Marker',
        message:
          'Keep moving around the object until the current angle marker is centered, then stop and let the app capture.',
      };
    case 'move_to_next_angle':
      return {
        tone: 'warning',
        title: 'Move To A New Angle',
        message:
          'The camera has not changed viewpoint enough. Rotate farther around the object before the next shot.',
      };
    case 'hold_steady':
      return {
        tone: 'warning',
        title: 'Hold Steady',
        message:
          'Stop moving for a moment. The object guide turns light blue only when the shot is stable enough to capture.',
      };
    case 'cooldown':
    case 'capturing':
      return {
        tone: 'info',
        title: 'Wait For The Current Shot',
        message: 'Do not move yet. Let the current capture finish before rotating to the next angle.',
      };
    case 'camera_unavailable':
    default:
      return {
        tone: 'error',
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
  const [acknowledgedStageIndex, setAcknowledgedStageIndex] = useState<number | null>(null);
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
  const stagePromptVisible = Boolean(
    hasObjectSelection && activeStage && acknowledgedStageIndex !== activeStage.stageIndex,
  );
  const stageReady = Boolean(hasObjectSelection && activeStage && !selectionIssue && !stagePromptVisible);

  const autoCapture = useAutoCapture({
    cameraRef: camera,
    enabled: Boolean(isFocused && permissionGranted && device && isCameraReady && hasObjectSelection),
    session,
    stageReady,
    heading,
    onSessionUpdated: setSession,
  });

  const finishEnabled = hasObjectSelection && capturedCount >= slotsTotal;
  const currentShotLabel =
    activeStage && autoCapture.currentStageSlotIndex !== null
      ? `${activeStage.shortTitle} ${autoCapture.currentStageSlotIndex + 1}/${activeStage.shots}`
      : null;

  useEffect(() => {
    if (!hasObjectSelection) {
      setAcknowledgedStageIndex(null);
    }
  }, [hasObjectSelection]);

  const guidanceCard = useMemo<GuidanceCard>(() => {
    if (!hasObjectSelection) {
      return {
        tone: 'info',
        title: 'Select The Object First',
        message:
          'Tap Start Selection, place the guide on the object, then use - and + to size it before confirming.',
      };
    }

    if (selectionIssue) {
      return {
        tone: 'error',
        title: selectionIssue.title,
        message: selectionIssue.message,
      };
    }

    if (stagePromptVisible && activeStage) {
      return {
        tone: 'warning',
        title: activeStage.promptTitle,
        message: activeStage.promptMessage,
      };
    }

    if (autoCapture.canCaptureNow) {
      return {
        tone: 'ready',
        title: 'Good Framing',
        message:
          'The guide is light blue. Keep the object inside it and let the app capture this angle automatically.',
      };
    }

    if (autoCapture.issue) {
      return buildIssueGuidance(autoCapture.issue, activeStage);
    }

    return {
      tone: 'info',
      title: 'Follow The Guide',
      message: 'Keep rotating evenly around the object while maintaining the same object size inside the guide.',
    };
  }, [activeStage, autoCapture.canCaptureNow, autoCapture.issue, hasObjectSelection, selectionIssue, stagePromptVisible]);

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

  const onCaptureMissingSlot = useCallback(() => {
    autoCapture.captureCurrentMissingSlot().then(result => {
      if (!result.ok) {
        const nextGuidance = buildIssueGuidance(result.issue, activeStage);
        Alert.alert(nextGuidance.title, nextGuidance.message);
      }
    });
  }, [activeStage, autoCapture]);

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
        setAcknowledgedStageIndex(null);
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
      setAcknowledgedStageIndex(null);
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
          photoQualityBalance="speed"
          onInitialized={() => setIsCameraReady(true)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraFallback]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.topHud}>
          <Text style={styles.hudTitle}>
            {hasObjectSelection ? `${pattern.title} Guided Capture` : 'Select Object Before Capture'}
          </Text>
          <Text style={styles.hudSubtitle}>
            {hasObjectSelection
              ? `${capturedCount}/${slotsTotal} photos captured. ${activeStage ? `${activeStage.title}: ${activeStage.capturedCount}/${activeStage.shots}.` : 'All stages completed.'}`
              : 'Read the framing tips, tap Start Selection, then place the guide around the object.'}
          </Text>
          {hasObjectSelection && activeStage ? (
            <Text style={styles.hudSlotStatus}>
              {activeStage.moveLabel} • {currentShotLabel ?? `${activeStage.shortTitle} ring`}
            </Text>
          ) : null}
          {hasObjectSelection ? (
            <Text style={styles.hudRequirement}>
              Finish unlocks only after all {slotsTotal} required photos are captured.
            </Text>
          ) : null}
          {permissionGranted && !device ? (
            <Text style={styles.hudWarning}>No back camera device found.</Text>
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
        </View>

        {selectionGuideStyle ? (
          <View style={styles.selectionGuideLayer} pointerEvents="none">
            <View
              style={[
                styles.selectionGuideBox,
                selectionGuideStyle,
                guidanceCard.tone === 'ready' && styles.selectionGuideBoxReady,
                guidanceCard.tone === 'warning' && styles.selectionGuideBoxWarning,
                guidanceCard.tone === 'error' && styles.selectionGuideBoxError,
              ]}>
              <View
                style={[
                  styles.selectionGuideLabel,
                  guidanceCard.tone === 'ready' && styles.selectionGuideLabelReady,
                  guidanceCard.tone === 'warning' && styles.selectionGuideLabelWarning,
                  guidanceCard.tone === 'error' && styles.selectionGuideLabelError,
                ]}>
                <Text
                  style={[
                    styles.selectionGuideLabelText,
                    guidanceCard.tone === 'ready' && styles.selectionGuideLabelTextDark,
                  ]}>
                  {guidanceCard.tone === 'ready'
                    ? 'Aligned - ready to capture'
                    : activeStage?.moveLabel ?? 'Keep object inside guide'}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.bottomHud}>
          <View style={styles.captureArea}>
            <CaptureRing
              slotsTotal={slotsTotal}
              capturedSlots={capturedSlots}
              size={200}
              activeSlot={hasObjectSelection && !autoCapture.allCaptured ? autoCapture.currentSlot : null}
            />
            <View style={styles.captureIndicatorOuter}>
              <View
                style={[
                  styles.captureIndicatorInner,
                  autoCapture.canCaptureNow && styles.captureIndicatorReady,
                  autoCapture.isCapturing && styles.captureIndicatorBusy,
                  !hasObjectSelection && styles.captureIndicatorDisabled,
                ]}>
                {autoCapture.isCapturing ? (
                  <ActivityIndicator color="#0B1020" />
                ) : (
                  <>
                    <Text style={styles.captureIndicatorCount}>{capturedCount}</Text>
                    <Text style={styles.captureIndicatorMeta}>/ {slotsTotal}</Text>
                  </>
                )}
              </View>
            </View>
          </View>

          <View
            style={[
              styles.guidanceCard,
              guidanceCard.tone === 'ready' && styles.guidanceCardReady,
              guidanceCard.tone === 'warning' && styles.guidanceCardWarning,
              guidanceCard.tone === 'error' && styles.guidanceCardError,
            ]}>
            <Text style={styles.guidanceEyebrow}>{activeStage?.title ?? pattern.title}</Text>
            <Text style={styles.guidanceTitle}>{guidanceCard.title}</Text>
            <Text style={styles.guidanceMessage}>{guidanceCard.message}</Text>
            {stagePromptVisible && activeStage ? (
              <AppButton
                title={activeStage.confirmLabel}
                onPress={() => setAcknowledgedStageIndex(activeStage.stageIndex)}
                style={styles.guidanceAction}
              />
            ) : null}
          </View>

          {hasObjectSelection ? (
            <AppButton
              title={
                autoCapture.isCapturing
                  ? 'Capturing...'
                  : autoCapture.allCaptured
                    ? 'Pattern Complete'
                    : autoCapture.currentSlotCaptured
                      ? `${currentShotLabel ?? 'Current Angle'} Captured`
                      : `Capture ${currentShotLabel ?? 'Current Angle'}`
              }
              variant="secondary"
              onPress={onCaptureMissingSlot}
              disabled={
                !permissionGranted ||
                !device ||
                !isCameraReady ||
                autoCapture.isCapturing ||
                autoCapture.allCaptured ||
                autoCapture.currentSlot === null
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
    lineHeight: 20,
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
    fontWeight: '700',
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  hudRequirement: {
    color: '#FFD88A',
    fontSize: 12,
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
  selectionGuideLabel: {
    alignSelf: 'flex-start',
    margin: theme.spacing.xs,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(11,16,32,0.82)',
  },
  selectionGuideLabelReady: {
    backgroundColor: '#8FDFFF',
  },
  selectionGuideLabelWarning: {
    backgroundColor: 'rgba(255,209,102,0.18)',
  },
  selectionGuideLabelError: {
    backgroundColor: 'rgba(255,107,107,0.18)',
  },
  selectionGuideLabelText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  selectionGuideLabelTextDark: {
    color: '#08101F',
  },
  bottomHud: {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  captureArea: {
    width: 236,
    height: 236,
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
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  captureIndicatorReady: {
    backgroundColor: '#8FDFFF',
  },
  captureIndicatorBusy: {
    backgroundColor: '#B5F1C5',
  },
  captureIndicatorDisabled: {
    opacity: 0.5,
  },
  captureIndicatorCount: {
    color: '#0B1020',
    fontSize: 18,
    fontWeight: '800',
  },
  captureIndicatorMeta: {
    color: '#0B1020',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  guidanceCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(11,16,32,0.88)',
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  guidanceCardReady: {
    borderColor: 'rgba(143,223,255,0.7)',
    backgroundColor: 'rgba(7,25,39,0.94)',
  },
  guidanceCardWarning: {
    borderColor: 'rgba(255,209,102,0.5)',
  },
  guidanceCardError: {
    borderColor: 'rgba(255,107,107,0.6)',
  },
  guidanceEyebrow: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  guidanceTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  guidanceMessage: {
    color: '#E8ECFA',
    fontSize: 13,
    lineHeight: 19,
  },
  guidanceAction: {
    marginTop: theme.spacing.sm,
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
