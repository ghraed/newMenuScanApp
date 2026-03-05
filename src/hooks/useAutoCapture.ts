import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RNFS from 'react-native-fs';
import { Camera } from 'react-native-vision-camera';
import { HeadingState } from './useHeading';
import {
  ensureScanSessionDirectories,
  getScanImagePath,
  upsertScanSession,
} from '../storage/scansStore';
import { ScanImageSlot, ScanSession } from '../types/scanSession';

const ACCEPT_INTERVAL_MS = 800;
const STABLE_REQUIRED_MS = 600;
const SLOT_CENTER_WINDOW_RATIO = 0.28;
const MIN_MOVEMENT_SLOT_RATIO = 0.6;
const MIN_MOVEMENT_RATE_DEG_PER_SEC = 3;

type Params = {
  cameraRef: RefObject<Camera | null>;
  enabled: boolean;
  session?: ScanSession;
  heading: HeadingState;
  onSessionUpdated: (session: ScanSession) => void;
};

type Result = {
  currentSlot: number | null;
  holdSteady: boolean;
  isCapturing: boolean;
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

export function useAutoCapture({
  cameraRef,
  enabled,
  session,
  heading,
  onSessionUpdated,
}: Params): Result {
  const [isCapturing, setIsCapturing] = useState(false);
  const [holdSteady, setHoldSteady] = useState(false);

  const capturingRef = useRef(false);
  const lastAcceptedRef = useRef(0);
  const sessionRef = useRef<ScanSession | undefined>(session);
  const headingRef = useRef(heading);
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  const lastCapturedHeadingRef = useRef<number | null>(null);
  const lastCapturedSlotRef = useRef<number | null>(null);
  const peakHeadingRateSinceCaptureRef = useRef(0);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);

  useEffect(() => {
    sessionRef.current = session;

    const nextSessionId = session?.id ?? null;
    if (sessionIdRef.current !== nextSessionId) {
      sessionIdRef.current = nextSessionId;
      lastCapturedHeadingRef.current = null;
      lastCapturedSlotRef.current = null;
      peakHeadingRateSinceCaptureRef.current = 0;
    }

    if (!session || session.images.length === 0) {
      return;
    }

    const latestCapture = session.images.reduce((latest, image) => {
      if (!latest || image.timestamp > latest.timestamp) {
        return image;
      }
      return latest;
    }, session.images[0]);

    lastCapturedHeadingRef.current = normalizeHeading(latestCapture.heading);
    lastCapturedSlotRef.current = latestCapture.slot;
  }, [session]);

  useEffect(() => {
    headingRef.current = heading;
  }, [heading]);

  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);

  const currentSlot = useMemo(() => {
    if (!session) {
      return null;
    }
    return getSlotIndexFromHeading(heading.heading, session.slotsTotal);
  }, [heading.heading, session]);

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
        const timestamp = Date.now();
        const photo = await camera.takePhoto({
          enableShutterSound: false,
        });

        await ensureScanSessionDirectories(activeSession.id);

        const sourcePath = normalizeFsPath(photo.path);
        const targetPath = getScanImagePath(activeSession.id, slot);
        const targetExists = await RNFS.exists(targetPath);
        if (targetExists) {
          await RNFS.unlink(targetPath);
        }
        await RNFS.copyFile(sourcePath, targetPath);

        const latestSession = sessionRef.current ?? activeSession;
        const image: ScanImageSlot = {
          slot,
          path: targetPath,
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

        lastAcceptedRef.current = timestamp;
        lastCapturedHeadingRef.current = image.heading;
        lastCapturedSlotRef.current = slot;
        peakHeadingRateSinceCaptureRef.current = 0;
      } catch {
        setHoldSteady(true);
      } finally {
        capturingRef.current = false;
        setIsCapturing(false);
      }
    },
    [cameraRef],
  );

  useEffect(() => {
    if (!enabled) {
      setHoldSteady(false);
      return;
    }

    const timer = setInterval(() => {
      const activeSession = sessionRef.current;
      if (!activeSession) {
        setHoldSteady(false);
        return;
      }

      const headingState = headingRef.current;
      peakHeadingRateSinceCaptureRef.current = Math.max(
        peakHeadingRateSinceCaptureRef.current,
        Math.abs(headingState.headingRateDegPerSec),
      );

      const slot = getSlotIndexFromHeading(headingState.heading, activeSession.slotsTotal);
      const slotCaptured = activeSession.images.some(image => image.slot === slot);
      const slotWidth = 360 / activeSession.slotsTotal;
      const nearCenter = isNearSlotCenter(headingState.heading, slot, activeSession.slotsTotal);
      const slotChangedFromLast = lastCapturedSlotRef.current === null || slot !== lastCapturedSlotRef.current;
      const movedEnoughSinceLastHeading =
        lastCapturedHeadingRef.current === null
          ? true
          : absoluteAngularDistance(headingState.heading, lastCapturedHeadingRef.current) >=
            slotWidth * MIN_MOVEMENT_SLOT_RATIO;
      const observedMovementRate =
        lastCapturedHeadingRef.current === null
          ? true
          : peakHeadingRateSinceCaptureRef.current >= MIN_MOVEMENT_RATE_DEG_PER_SEC;
      const readyForNewAngle = movedEnoughSinceLastHeading && observedMovementRate;
      const now = Date.now();
      const inCooldown = now - lastAcceptedRef.current < ACCEPT_INTERVAL_MS;
      const stableEnough = headingState.stableForMs >= STABLE_REQUIRED_MS;

      const canCapture =
        !slotCaptured &&
        slotChangedFromLast &&
        nearCenter &&
        readyForNewAngle &&
        !capturingRef.current &&
        !inCooldown &&
        stableEnough &&
        Boolean(cameraRef.current);

      setHoldSteady(!slotCaptured && !canCapture);

      if (canCapture) {
        void captureSlot(slot);
      }
    }, 120);

    return () => clearInterval(timer);
  }, [cameraRef, captureSlot, enabled]);

  return {
    currentSlot,
    holdSteady,
    isCapturing,
  };
}
