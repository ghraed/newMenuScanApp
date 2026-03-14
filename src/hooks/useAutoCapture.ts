import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import RNFS from 'react-native-fs';
import { Camera } from 'react-native-vision-camera';
import {
  CaptureStageProgress,
  getActiveCaptureStage,
  getCapturePattern,
} from '../lib/captureGuidance';
import {
  ensureScanSessionDirectories,
  getScanImagesDirectoryPath,
  upsertScanSession,
} from '../storage/scansStore';
import { ScanImageSlot, ScanSession } from '../types/scanSession';
import { HeadingState } from './useHeading';

const ACCEPT_INTERVAL_MS = 800;
const STABLE_REQUIRED_MS = 600;
const SLOT_CENTER_WINDOW_RATIO = 0.28;
const MIN_MOVEMENT_SLOT_RATIO = 0.6;
const MIN_MOVEMENT_RATE_DEG_PER_SEC = 3;

export type AutoCaptureIssue =
  | 'complete'
  | 'stage_locked'
  | 'slot_captured'
  | 'align_to_marker'
  | 'move_to_next_angle'
  | 'hold_steady'
  | 'cooldown'
  | 'capturing'
  | 'camera_unavailable';

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
  heading: HeadingState;
  onSessionUpdated: (session: ScanSession) => void;
};

type CaptureStatus = {
  currentSlot: number | null;
  currentStageSlotIndex: number | null;
  currentSlotCaptured: boolean;
  currentStage: CaptureStageProgress | null;
  canCapture: boolean;
  issue: AutoCaptureIssue | null;
  nearCenter: boolean;
  stableEnough: boolean;
  movedEnough: boolean;
  allCaptured: boolean;
  stageReady: boolean;
};

type Result = {
  currentSlot: number | null;
  currentStageSlotIndex: number | null;
  currentSlotCaptured: boolean;
  currentStage: CaptureStageProgress | null;
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

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function normalizeFsPath(path: string) {
  return path.startsWith('file://') ? path.replace('file://', '') : path;
}

function shortestDeltaDegrees(next: number, prev: number) {
  return ((next - prev + 540) % 360) - 180;
}

function absoluteAngularDistance(next: number, prev: number) {
  return Math.abs(shortestDeltaDegrees(next, prev));
}

export function getSlotIndexFromHeading(heading: number, slotsTotal: number) {
  const normalized = normalizeHeading(heading);
  return Math.floor((normalized % 360) / (360 / slotsTotal));
}

function isNearSlotCenter(heading: number, slot: number, slotsTotal: number) {
  const slotWidth = 360 / slotsTotal;
  const center = normalizeHeading((slot + 0.5) * slotWidth);
  const delta = absoluteAngularDistance(heading, center);
  return delta <= slotWidth * SLOT_CENTER_WINDOW_RATIO;
}

function createEmptyStatus(stageReady: boolean): CaptureStatus {
  return {
    currentSlot: null,
    currentStageSlotIndex: null,
    currentSlotCaptured: false,
    currentStage: null,
    canCapture: false,
    issue: null,
    nearCenter: false,
    stableEnough: false,
    movedEnough: false,
    allCaptured: false,
    stageReady,
  };
}

export function useAutoCapture({
  cameraRef,
  enabled,
  session,
  stageReady,
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
  const lastCapturedHeadingRef = useRef<number | null>(null);
  const peakHeadingRateSinceCaptureRef = useRef(0);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const activeStageIndexRef = useRef<number | null>(null);

  const buildCaptureStatus = useCallback(
    (activeSession: ScanSession | undefined, headingState: HeadingState): CaptureStatus => {
      if (!activeSession) {
        return createEmptyStatus(stageReadyRef.current);
      }

      const pattern = getCapturePattern(activeSession.slotsTotal);
      const capturedSlots = activeSession.images.map(image => image.slot);
      const currentStage = getActiveCaptureStage(pattern, capturedSlots);

      if (!currentStage) {
        return {
          ...createEmptyStatus(stageReadyRef.current),
          allCaptured: true,
          issue: 'complete',
        };
      }

      const currentStageSlotIndex = getSlotIndexFromHeading(headingState.heading, currentStage.shots);
      const currentSlot = currentStage.slotStart + currentStageSlotIndex;
      const currentSlotCaptured = activeSession.images.some(image => image.slot === currentSlot);
      const slotWidth = 360 / currentStage.shots;
      const nearCenter = isNearSlotCenter(headingState.heading, currentStageSlotIndex, currentStage.shots);
      const movedEnoughSinceLastHeading =
        lastCapturedHeadingRef.current === null
          ? true
          : absoluteAngularDistance(headingState.heading, lastCapturedHeadingRef.current) >=
            slotWidth * MIN_MOVEMENT_SLOT_RATIO;
      const observedMovementRate =
        lastCapturedHeadingRef.current === null
          ? true
          : peakHeadingRateSinceCaptureRef.current >= MIN_MOVEMENT_RATE_DEG_PER_SEC;
      const movedEnough = movedEnoughSinceLastHeading && observedMovementRate;
      const stableEnough = headingState.stableForMs >= STABLE_REQUIRED_MS;
      const now = Date.now();
      const inCooldown = now - lastAcceptedRef.current < ACCEPT_INTERVAL_MS;

      let issue: AutoCaptureIssue | null = null;

      if (!stageReadyRef.current) {
        issue = 'stage_locked';
      } else if (currentSlotCaptured) {
        issue = 'slot_captured';
      } else if (!nearCenter) {
        issue = 'align_to_marker';
      } else if (!movedEnough) {
        issue = 'move_to_next_angle';
      } else if (inCooldown) {
        issue = 'cooldown';
      } else if (!stableEnough) {
        issue = 'hold_steady';
      } else if (capturingRef.current) {
        issue = 'capturing';
      } else if (!cameraRef.current) {
        issue = 'camera_unavailable';
      }

      return {
        currentSlot,
        currentStageSlotIndex,
        currentSlotCaptured,
        currentStage,
        canCapture: issue === null,
        issue,
        nearCenter,
        stableEnough,
        movedEnough,
        allCaptured: false,
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
    } else if (session.images.length > 0) {
      const latestCapture = session.images.reduce((latest, image) => {
        if (!latest || image.timestamp > latest.timestamp) {
          return image;
        }
        return latest;
      }, session.images[0]);

      lastCapturedHeadingRef.current = normalizeHeading(latestCapture.heading);
    }

    setStatus(buildCaptureStatus(session, headingRef.current));
  }, [buildCaptureStatus, session]);

  useEffect(() => {
    headingRef.current = heading;
    setStatus(buildCaptureStatus(sessionRef.current, heading));
  }, [buildCaptureStatus, heading]);

  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  useEffect(() => {
    stageReadyRef.current = stageReady;
    setStatus(buildCaptureStatus(sessionRef.current, headingRef.current));
  }, [buildCaptureStatus, stageReady]);

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

        setStatus(buildCaptureStatus(nextSession, headingRef.current));
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
    setStatus(nextStatus);

    if (!nextStatus.canCapture || nextStatus.currentSlot === null) {
      return {
        ok: false,
        issue: nextStatus.issue ?? 'camera_unavailable',
      };
    }

    await captureSlot(nextStatus.currentSlot);
    return { ok: true };
  }, [buildCaptureStatus, captureSlot]);

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
      setStatus(nextStatus);
      setHoldSteady(nextStatus.issue === 'hold_steady' || nextStatus.issue === 'cooldown');

      if (nextStatus.canCapture && nextStatus.currentSlot !== null) {
        captureSlot(nextStatus.currentSlot).catch(() => undefined);
      }
    }, 120);

    return () => clearInterval(timer);
  }, [buildCaptureStatus, captureSlot, enabled]);

  return {
    currentSlot: status.currentSlot,
    currentStageSlotIndex: status.currentStageSlotIndex,
    currentSlotCaptured: status.currentSlotCaptured,
    currentStage: status.currentStage,
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
