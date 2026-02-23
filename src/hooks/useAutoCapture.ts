import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import RNFS from 'react-native-fs';
import { Camera } from 'react-native-vision-camera';
import { HeadingState } from './useHeading';
import {
  ensureScanSessionDirectories,
  getScanImagePath,
  upsertScanSession,
} from '../storage/scansStore';
import { ScanImageSlot, ScanSession } from '../types/scanSession';

const ACCEPT_INTERVAL_MS = 700;
const STABLE_REQUIRED_MS = 400;

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

export function getSlotIndexFromHeading(heading: number, slotsTotal: number) {
  const normalized = normalizeHeading(heading);
  return Math.floor((normalized % 360) / (360 / slotsTotal));
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

  useEffect(() => {
    sessionRef.current = session;
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

  const captureSlot = async (slot: number) => {
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
    } catch {
      setHoldSteady(true);
    } finally {
      capturingRef.current = false;
      setIsCapturing(false);
    }
  };

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

      const slot = getSlotIndexFromHeading(headingRef.current.heading, activeSession.slotsTotal);
      const slotCaptured = activeSession.images.some(image => image.slot === slot);
      const now = Date.now();
      const inCooldown = now - lastAcceptedRef.current < ACCEPT_INTERVAL_MS;
      const stableEnough = headingRef.current.stableForMs >= STABLE_REQUIRED_MS;

      const canCapture =
        !slotCaptured && !capturingRef.current && !inCooldown && stableEnough && Boolean(cameraRef.current);

      setHoldSteady(!slotCaptured && !canCapture);

      if (canCapture) {
        void captureSlot(slot);
      }
    }, 120);

    return () => clearInterval(timer);
  }, [cameraRef, enabled]);

  return {
    currentSlot,
    holdSteady,
    isCapturing,
  };
}
