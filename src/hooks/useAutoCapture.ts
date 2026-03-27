import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import RNFS from 'react-native-fs';
import { Camera } from 'react-native-vision-camera';
import {
  AutoCaptureIssue,
  CaptureGuidanceState,
  CaptureStageProgress,
  evaluateCaptureGuidanceState,
  getActiveCaptureStage,
  getCapturePattern,
  normalizeHeading,
} from '../lib/captureGuidance';
import {
  ensureScanSessionDirectories,
  getScanImagesDirectoryPath,
  upsertScanSession,
} from '../storage/scansStore';
import { ScanCaptureMode, ScanImageSlot, ScanSession } from '../types/scanSession';
import { HeadingState } from './useHeading';

const TURNTABLE_CAPTURE_INTERVAL_MS = 500;

type CaptureAttemptResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      issue: AutoCaptureIssue;
    };

type Params = {
  cameraRef: RefObject<Camera | null>;
  enabled: boolean;
  session?: ScanSession;
  stageReady: boolean;
  captureMode: ScanCaptureMode;
  heading: HeadingState;
  onSessionUpdated: (session: ScanSession) => void;
};

type CaptureStatus = CaptureGuidanceState & {
  stageReady: boolean;
};

type Result = {
  currentSlot: number | null;
  currentStageSlotIndex: number | null;
  currentSlotCaptured: boolean;
  currentStage: CaptureStageProgress | null;
  targetSlot: number | null;
  targetStageSlotIndex: number | null;
  targetHeading: number | null;
  targetDeltaDeg: number | null;
  targetAlignmentProgress: number;
  holdSteady: boolean;
  isCapturing: boolean;
  canCaptureNow: boolean;
  issue: AutoCaptureIssue | null;
  nearCenter: boolean;
  stableEnough: boolean;
  movedEnough: boolean;
  allCaptured: boolean;
  stageReady: boolean;
  captureCurrentMissingSlot: () => Promise<CaptureAttemptResult>;
};

function normalizeFsPath(path: string) {
  return path.startsWith('file://') ? path.replace('file://', '') : path;
}

function createEmptyStatus(stageReady: boolean): CaptureStatus {
  return {
    currentStage: null,
    currentSlot: null,
    currentStageSlotIndex: null,
    currentSlotCaptured: false,
    targetSlot: null,
    targetStageSlotIndex: null,
    targetHeading: null,
    targetDeltaDeg: null,
    targetAlignmentProgress: 0,
    nearCenter: false,
    stableEnough: false,
    movedEnough: false,
    canCapture: false,
    issue: null,
    allCaptured: false,
    stageReady,
  };
}

function getFirstMissingSlot(capturedSlots: number[], slotsTotal: number) {
  const capturedSet = new Set(capturedSlots);

  for (let slot = 0; slot < slotsTotal; slot += 1) {
    if (!capturedSet.has(slot)) {
      return slot;
    }
  }

  return null;
}

export function useAutoCapture({
  cameraRef,
  enabled,
  session,
  stageReady,
  captureMode,
  heading,
  onSessionUpdated,
}: Params): Result {
  const [isCapturing, setIsCapturing] = useState(false);
  const [holdSteady, setHoldSteady] = useState(false);
  const [status, setStatus] = useState<CaptureStatus>(() => createEmptyStatus(stageReady));

  const capturingRef = useRef(false);
  const lastAcceptedRef = useRef(0);
  const sessionRef = useRef<ScanSession | undefined>(session);
  const headingRef = useRef(heading);
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  const stageReadyRef = useRef(stageReady);
  const captureModeRef = useRef(captureMode);
  const lastCapturedHeadingRef = useRef<number | null>(null);
  const peakHeadingRateSinceCaptureRef = useRef(0);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const activeStageIndexRef = useRef<number | null>(null);
  const preferredTargetSlotRef = useRef<number | null>(null);

  const buildCaptureStatus = useCallback(
    (activeSession: ScanSession | undefined, headingState: HeadingState): CaptureStatus => {
      if (!activeSession) {
        return createEmptyStatus(stageReadyRef.current);
      }

      const pattern = getCapturePattern(activeSession.slotsTotal);
      const capturedSlots = activeSession.images.map(image => image.slot);

      if (captureModeRef.current === 'turntable') {
        const currentStage = getActiveCaptureStage(pattern, capturedSlots);
        const targetSlot = getFirstMissingSlot(capturedSlots, activeSession.slotsTotal);
        const now = Date.now();
        const inCooldown = now - lastAcceptedRef.current < TURNTABLE_CAPTURE_INTERVAL_MS;

        if (targetSlot === null) {
          return {
            ...createEmptyStatus(stageReadyRef.current),
            allCaptured: true,
            issue: 'complete',
            stageReady: stageReadyRef.current,
          };
        }

        const targetStageSlotIndex =
          currentStage && targetSlot >= currentStage.slotStart && targetSlot <= currentStage.slotEnd
            ? targetSlot - currentStage.slotStart
            : null;

        let issue: AutoCaptureIssue | null = null;

        if (!stageReadyRef.current) {
          issue = 'stage_locked';
        } else if (inCooldown) {
          issue = 'cooldown';
        } else if (capturingRef.current) {
          issue = 'capturing';
        } else if (!cameraRef.current) {
          issue = 'camera_unavailable';
        }

        return {
          currentStage,
          currentSlot: targetSlot,
          currentStageSlotIndex: targetStageSlotIndex,
          currentSlotCaptured: false,
          targetSlot,
          targetStageSlotIndex,
          targetHeading: null,
          targetDeltaDeg: null,
          targetAlignmentProgress: 1,
          nearCenter: true,
          stableEnough: true,
          movedEnough: true,
          canCapture: issue === null,
          issue,
          allCaptured: false,
          stageReady: stageReadyRef.current,
        };
      }

      return {
        ...evaluateCaptureGuidanceState({
          pattern,
          capturedSlots,
          heading: headingState.heading,
          preferredTargetSlot: preferredTargetSlotRef.current,
          stableForMs: headingState.stableForMs,
          stageReady: stageReadyRef.current,
          lastCapturedHeading: lastCapturedHeadingRef.current,
          peakHeadingRateSinceCapture: peakHeadingRateSinceCaptureRef.current,
          now: Date.now(),
          lastAcceptedAt: lastAcceptedRef.current,
          isCapturing: capturingRef.current,
          hasCamera: Boolean(cameraRef.current),
        }),
        stageReady: stageReadyRef.current,
      };
    },
    [cameraRef],
  );

  useEffect(() => {
    sessionRef.current = session;

    const nextSessionId = session?.id ?? null;
    if (sessionIdRef.current !== nextSessionId) {
      sessionIdRef.current = nextSessionId;
      lastCapturedHeadingRef.current = null;
      peakHeadingRateSinceCaptureRef.current = 0;
      lastAcceptedRef.current = 0;
      activeStageIndexRef.current = null;
      preferredTargetSlotRef.current = null;
    }

    if (!session) {
      setStatus(createEmptyStatus(stageReadyRef.current));
      return;
    }

    const pattern = getCapturePattern(session.slotsTotal);
    const capturedSlots = session.images.map(image => image.slot);
    const activeStage = getActiveCaptureStage(pattern, capturedSlots);
    const nextStageIndex = activeStage?.stageIndex ?? null;
    const stageChanged = activeStageIndexRef.current !== nextStageIndex;

    activeStageIndexRef.current = nextStageIndex;

    if (stageChanged) {
      lastCapturedHeadingRef.current = null;
      peakHeadingRateSinceCaptureRef.current = 0;
      lastAcceptedRef.current = 0;
      preferredTargetSlotRef.current = null;
    } else if (session.images.length > 0) {
      const latestCapture = session.images.reduce((latest, image) => {
        if (!latest || image.timestamp > latest.timestamp) {
          return image;
        }
        return latest;
      }, session.images[0]);

      lastCapturedHeadingRef.current = normalizeHeading(latestCapture.heading);
    }

    const nextStatus = buildCaptureStatus(session, headingRef.current);
    preferredTargetSlotRef.current = nextStatus.targetSlot;
    setStatus(nextStatus);
  }, [buildCaptureStatus, session]);

  useEffect(() => {
    headingRef.current = heading;
    const nextStatus = buildCaptureStatus(sessionRef.current, heading);
    preferredTargetSlotRef.current = nextStatus.targetSlot;
    setStatus(nextStatus);
  }, [buildCaptureStatus, heading]);

  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  useEffect(() => {
    stageReadyRef.current = stageReady;
    const nextStatus = buildCaptureStatus(sessionRef.current, headingRef.current);
    preferredTargetSlotRef.current = nextStatus.targetSlot;
    setStatus(nextStatus);
  }, [buildCaptureStatus, stageReady]);

  useEffect(() => {
    captureModeRef.current = captureMode;
    const nextStatus = buildCaptureStatus(sessionRef.current, headingRef.current);
    preferredTargetSlotRef.current = nextStatus.targetSlot;
    setStatus(nextStatus);
  }, [buildCaptureStatus, captureMode]);

  const captureSlot = useCallback(
    async (slot: number) => {
      const activeSession = sessionRef.current;
      const camera = cameraRef.current;

      if (!activeSession || !camera || capturingRef.current) {
        return;
      }

      capturingRef.current = true;
      setIsCapturing(true);
      setHoldSteady(false);

      try {
        await ensureScanSessionDirectories(activeSession.id);

        const timestamp = Date.now();
        const imagesDirectoryPath = getScanImagesDirectoryPath(activeSession.id);
        const photo = await camera.takePhoto({
          enableShutterSound: false,
          path: imagesDirectoryPath,
        });

        const latestSession = sessionRef.current ?? activeSession;
        const previousImage = latestSession.images.find(item => item.slot === slot);
        const image: ScanImageSlot = {
          slot,
          path: normalizeFsPath(photo.path),
          heading: normalizeHeading(headingRef.current.heading),
          timestamp,
        };

        const nextSession: ScanSession = {
          ...latestSession,
          images: [...latestSession.images.filter(item => item.slot !== slot), image].sort(
            (a, b) => a.slot - b.slot,
          ),
          status: 'draft',
        };

        await upsertScanSession(nextSession);
        sessionRef.current = nextSession;
        onSessionUpdatedRef.current(nextSession);

        const previousPath = previousImage?.path ? normalizeFsPath(previousImage.path) : null;
        if (previousPath && previousPath !== image.path) {
          await RNFS.unlink(previousPath).catch(() => undefined);
        }

        lastAcceptedRef.current = timestamp;
        lastCapturedHeadingRef.current = image.heading;
        peakHeadingRateSinceCaptureRef.current = 0;

        const nextStatus = buildCaptureStatus(nextSession, headingRef.current);
        preferredTargetSlotRef.current = nextStatus.targetSlot;
        setStatus(nextStatus);
      } catch {
        setHoldSteady(true);
      } finally {
        capturingRef.current = false;
        setIsCapturing(false);
      }
    },
    [buildCaptureStatus, cameraRef],
  );

  const captureCurrentMissingSlot = useCallback(async (): Promise<CaptureAttemptResult> => {
    const nextStatus = buildCaptureStatus(sessionRef.current, headingRef.current);
    preferredTargetSlotRef.current = nextStatus.targetSlot;
    setStatus(nextStatus);

    if (capturingRef.current) {
      return {
        ok: false,
        issue: 'capturing',
      };
    }

    if (nextStatus.allCaptured || nextStatus.targetSlot === null) {
      return {
        ok: false,
        issue: nextStatus.issue ?? 'complete',
      };
    }

    if (!stageReadyRef.current) {
      return {
        ok: false,
        issue: 'stage_locked',
      };
    }

    if (!cameraRef.current) {
      return {
        ok: false,
        issue: 'camera_unavailable',
      };
    }

    await captureSlot(nextStatus.targetSlot);
    return { ok: true };
  }, [buildCaptureStatus, cameraRef, captureSlot]);

  useEffect(() => {
    if (!enabled) {
      setHoldSteady(false);
      return;
    }

    const timer = setInterval(() => {
      const headingState = headingRef.current;
      peakHeadingRateSinceCaptureRef.current = Math.max(
        peakHeadingRateSinceCaptureRef.current,
        Math.abs(headingState.headingRateDegPerSec),
      );

      const nextStatus = buildCaptureStatus(sessionRef.current, headingState);
      preferredTargetSlotRef.current = nextStatus.targetSlot;
      setStatus(nextStatus);
      setHoldSteady(nextStatus.issue === 'hold_steady' || nextStatus.issue === 'cooldown');

      if (nextStatus.canCapture && nextStatus.targetSlot !== null) {
        captureSlot(nextStatus.targetSlot).catch(() => undefined);
      }
    }, 120);

    return () => clearInterval(timer);
  }, [buildCaptureStatus, captureSlot, enabled]);

  return {
    currentSlot: status.currentSlot,
    currentStageSlotIndex: status.currentStageSlotIndex,
    currentSlotCaptured: status.currentSlotCaptured,
    currentStage: status.currentStage,
    targetSlot: status.targetSlot,
    targetStageSlotIndex: status.targetStageSlotIndex,
    targetHeading: status.targetHeading,
    targetDeltaDeg: status.targetDeltaDeg,
    targetAlignmentProgress: status.targetAlignmentProgress,
    holdSteady,
    isCapturing,
    canCaptureNow: status.canCapture,
    issue: status.issue,
    nearCenter: status.nearCenter,
    stableEnough: status.stableEnough,
    movedEnough: status.movedEnough,
    allCaptured: status.allCaptured,
    stageReady: status.stageReady,
    captureCurrentMissingSlot,
  };
}
