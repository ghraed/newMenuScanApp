import { ObjectSelection, ObjectSelectionRect } from '../types/scanSession';

export type CaptureStageId = 'side' | 'high';

export type CaptureStage = {
  id: CaptureStageId;
  title: string;
  shortTitle: string;
  description: string;
  promptTitle: string;
  promptMessage: string;
  confirmLabel: string;
  moveLabel: string;
  shots: number;
};

export type CapturePattern = {
  id: 'pattern_24' | 'pattern_36' | 'pattern_50';
  title: string;
  shortTitle: string;
  description: string;
  totalShots: number;
  recommended?: boolean;
  stages: CaptureStage[];
};

export type CaptureStageProgress = CaptureStage & {
  stageIndex: number;
  slotStart: number;
  slotEnd: number;
  capturedCount: number;
  remainingCount: number;
  complete: boolean;
};

export type SelectionValidationIssue = {
  code: 'too_small' | 'too_large' | 'too_close_to_edge';
  title: string;
  message: string;
};

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

export type CaptureTarget = {
  slot: number;
  stageSlotIndex: number;
  targetHeading: number;
  targetDeltaDeg: number;
  distanceDeg: number;
};

export type CaptureGuidanceState = {
  currentStage: CaptureStageProgress | null;
  currentSlot: number | null;
  currentStageSlotIndex: number | null;
  currentSlotCaptured: boolean;
  targetSlot: number | null;
  targetStageSlotIndex: number | null;
  targetHeading: number | null;
  targetDeltaDeg: number | null;
  targetAlignmentProgress: number;
  nearCenter: boolean;
  stableEnough: boolean;
  movedEnough: boolean;
  canCapture: boolean;
  issue: AutoCaptureIssue | null;
  allCaptured: boolean;
};

type EvaluateCaptureGuidanceParams = {
  pattern: CapturePattern;
  capturedSlots: number[];
  heading: number;
  preferredTargetSlot?: number | null;
  stableForMs: number;
  stageReady: boolean;
  lastCapturedHeading: number | null;
  peakHeadingRateSinceCapture: number;
  now: number;
  lastAcceptedAt: number;
  isCapturing: boolean;
  hasCamera: boolean;
  acceptIntervalMs?: number;
  stableRequiredMs?: number;
  slotCenterWindowRatio?: number;
  targetSwitchHysteresisRatio?: number;
  minMovementSlotRatio?: number;
  minMovementRateDegPerSec?: number;
};

const MIN_SELECTION_DIMENSION = 0.2;
const MIN_SELECTION_AREA = 0.04;
const MAX_SELECTION_DIMENSION = 0.74;
const MIN_SELECTION_MARGIN = 0.05;
const DEFAULT_ACCEPT_INTERVAL_MS = 450;
const DEFAULT_STABLE_REQUIRED_MS = 280;
const DEFAULT_SLOT_CENTER_WINDOW_RATIO = 0.42;
const DEFAULT_TARGET_SWITCH_HYSTERESIS_RATIO = 0.28;
const DEFAULT_MIN_MOVEMENT_SLOT_RATIO = 0.35;
const DEFAULT_MIN_MOVEMENT_RATE_DEG_PER_SEC = 1.2;
const DEFAULT_GHOST_BOX_MAX_SHIFT_RATIO = 0.9;

export const CAPTURE_PATTERNS: CapturePattern[] = [
  {
    id: 'pattern_24',
    title: '24 Photos',
    shortTitle: '24',
    description: '12 side, 12 upper. Fastest full scan.',
    totalShots: 24,
    stages: [
      {
        id: 'side',
        title: 'Side Ring',
        shortTitle: 'Side',
        description: 'Keep the camera level with the object center to capture the sides.',
        promptTitle: 'Start the Side Ring',
        promptMessage:
          'Keep the camera level with the object center. Walk around once while keeping the sides framed inside the guide.',
        confirmLabel: 'Start Side Ring',
        moveLabel: 'Keep level',
        shots: 12,
      },
      {
        id: 'high',
        title: 'Upper Ring',
        shortTitle: 'Upper',
        description: 'Move upward and look slightly downward.',
        promptTitle: 'Move Upward',
        promptMessage:
          'Raise the camera until you can see more of the top surface. Keep the object centered and inside the guide.',
        confirmLabel: 'I Moved Upward',
        moveLabel: 'Move upward',
        shots: 12,
      },
    ],
  },
  {
    id: 'pattern_36',
    title: '36 Photos',
    shortTitle: '36',
    description: '18 side, 18 upper. Best default quality.',
    totalShots: 36,
    recommended: true,
    stages: [
      {
        id: 'side',
        title: 'Side Ring',
        shortTitle: 'Side',
        description: 'Keep the camera level with the object center to capture the sides.',
        promptTitle: 'Start the Side Ring',
        promptMessage:
          'Keep the camera level with the object center. Rotate around it with smooth, even spacing so the side profile is fully covered.',
        confirmLabel: 'Start Side Ring',
        moveLabel: 'Keep level',
        shots: 18,
      },
      {
        id: 'high',
        title: 'Upper Ring',
        shortTitle: 'Upper',
        description: 'Move upward and look slightly downward.',
        promptTitle: 'Move Upward',
        promptMessage:
          'Raise the camera and keep the object size consistent. You should see more of the top surface before capturing.',
        confirmLabel: 'I Moved Upward',
        moveLabel: 'Move upward',
        shots: 18,
      },
    ],
  },
  {
    id: 'pattern_50',
    title: '50 Photos',
    shortTitle: '50',
    description: '25 side, 25 upper. Highest density.',
    totalShots: 50,
    stages: [
      {
        id: 'side',
        title: 'Side Ring',
        shortTitle: 'Side',
        description: 'Keep the camera level with the object center to capture the sides.',
        promptTitle: 'Start the Side Ring',
        promptMessage:
          'Begin at object-center height. Use very small, even angle changes and keep the side profile filling the guide.',
        confirmLabel: 'Start Side Ring',
        moveLabel: 'Keep level',
        shots: 25,
      },
      {
        id: 'high',
        title: 'Upper Ring',
        shortTitle: 'Upper',
        description: 'Move upward and look slightly downward.',
        promptTitle: 'Move Upward',
        promptMessage:
          'Raise the camera and look slightly down. Keep the guide tight around the object while you finish the top ring.',
        confirmLabel: 'I Moved Upward',
        moveLabel: 'Move upward',
        shots: 25,
      },
    ],
  },
];

export function getDefaultCapturePattern() {
  return CAPTURE_PATTERNS.find(pattern => pattern.recommended) ?? CAPTURE_PATTERNS[0];
}

export function getCapturePattern(slotsTotal?: number) {
  return CAPTURE_PATTERNS.find(pattern => pattern.totalShots === slotsTotal) ?? getDefaultCapturePattern();
}

export function getCaptureStageProgress(
  pattern: CapturePattern,
  capturedSlots: number[],
): CaptureStageProgress[] {
  const capturedSet = new Set(capturedSlots);
  let slotOffset = 0;

  return pattern.stages.map((stage, stageIndex) => {
    const slotStart = slotOffset;
    const slotEnd = slotStart + stage.shots - 1;
    const capturedCount = Array.from({ length: stage.shots }).reduce<number>((count, _, index) => {
      return capturedSet.has(slotStart + index) ? count + 1 : count;
    }, 0);

    slotOffset += stage.shots;

    return {
      ...stage,
      stageIndex,
      slotStart,
      slotEnd,
      capturedCount,
      remainingCount: stage.shots - capturedCount,
      complete: capturedCount >= stage.shots,
    };
  });
}

export function getActiveCaptureStage(
  pattern: CapturePattern,
  capturedSlots: number[],
): CaptureStageProgress | null {
  return getCaptureStageProgress(pattern, capturedSlots).find(stage => !stage.complete) ?? null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

export function shortestHeadingDelta(next: number, prev: number) {
  return ((next - prev + 540) % 360) - 180;
}

export function absoluteHeadingDistance(next: number, prev: number) {
  return Math.abs(shortestHeadingDelta(next, prev));
}

export function getStageSlotIndexFromHeading(heading: number, shots: number) {
  const safeShots = Math.max(1, shots);
  const normalized = normalizeHeading(heading);
  return Math.floor((normalized % 360) / (360 / safeShots));
}

export function getStageSlotCenterHeading(stageSlotIndex: number, shots: number) {
  const safeShots = Math.max(1, shots);
  const slotWidth = 360 / safeShots;
  return normalizeHeading((stageSlotIndex + 0.5) * slotWidth);
}

export function isHeadingNearStageSlotCenter(
  heading: number,
  stageSlotIndex: number,
  shots: number,
  centerWindowRatio = DEFAULT_SLOT_CENTER_WINDOW_RATIO,
) {
  const slotWidth = 360 / Math.max(1, shots);
  const center = getStageSlotCenterHeading(stageSlotIndex, shots);
  return absoluteHeadingDistance(heading, center) <= slotWidth * centerWindowRatio;
}

export function getNearestUncapturedStageTarget(
  heading: number,
  stage: CaptureStageProgress,
  capturedSlots: number[],
): CaptureTarget | null {
  const capturedSet = new Set(capturedSlots);
  let bestTarget: CaptureTarget | null = null;

  for (let stageSlotIndex = 0; stageSlotIndex < stage.shots; stageSlotIndex += 1) {
    const slot = stage.slotStart + stageSlotIndex;
    if (capturedSet.has(slot)) {
      continue;
    }

    const targetHeading = getStageSlotCenterHeading(stageSlotIndex, stage.shots);
    const targetDeltaDeg = shortestHeadingDelta(targetHeading, heading);
    const distanceDeg = Math.abs(targetDeltaDeg);
    const isBetterTarget =
      !bestTarget ||
      distanceDeg < bestTarget.distanceDeg ||
      (distanceDeg === bestTarget.distanceDeg && stageSlotIndex < bestTarget.stageSlotIndex);

    if (isBetterTarget) {
      bestTarget = {
        slot,
        stageSlotIndex,
        targetHeading,
        targetDeltaDeg,
        distanceDeg,
      };
    }
  }

  return bestTarget;
}

export function getStageTargetBySlot(
  heading: number,
  stage: CaptureStageProgress,
  slot: number,
): CaptureTarget | null {
  if (slot < stage.slotStart || slot > stage.slotEnd) {
    return null;
  }

  const stageSlotIndex = slot - stage.slotStart;
  const targetHeading = getStageSlotCenterHeading(stageSlotIndex, stage.shots);
  const targetDeltaDeg = shortestHeadingDelta(targetHeading, heading);

  return {
    slot,
    stageSlotIndex,
    targetHeading,
    targetDeltaDeg,
    distanceDeg: Math.abs(targetDeltaDeg),
  };
}

export function getStableStageTarget(
  heading: number,
  stage: CaptureStageProgress,
  capturedSlots: number[],
  preferredTargetSlot: number | null,
  targetSwitchHysteresisRatio = DEFAULT_TARGET_SWITCH_HYSTERESIS_RATIO,
): CaptureTarget | null {
  const nearestTarget = getNearestUncapturedStageTarget(heading, stage, capturedSlots);
  if (!nearestTarget || preferredTargetSlot === null) {
    return nearestTarget;
  }

  const capturedSet = new Set(capturedSlots);
  if (capturedSet.has(preferredTargetSlot)) {
    return nearestTarget;
  }

  const preferredTarget = getStageTargetBySlot(heading, stage, preferredTargetSlot);
  if (!preferredTarget) {
    return nearestTarget;
  }

  const slotWidth = 360 / Math.max(1, stage.shots);
  const switchThreshold = slotWidth * targetSwitchHysteresisRatio;

  if (preferredTarget.distanceDeg <= nearestTarget.distanceDeg + switchThreshold) {
    return preferredTarget;
  }

  return nearestTarget;
}

export function getTargetAlignmentProgress(targetDeltaDeg: number | null, shots: number) {
  if (targetDeltaDeg === null) {
    return 0;
  }

  const slotWidth = 360 / Math.max(1, shots);
  return 1 - clamp(Math.abs(targetDeltaDeg) / slotWidth, 0, 1);
}

export function getGhostGuideBoxRect(
  bbox: ObjectSelectionRect,
  targetDeltaDeg: number,
  shots: number,
  maxShiftRatio = DEFAULT_GHOST_BOX_MAX_SHIFT_RATIO,
): ObjectSelectionRect {
  const direction = targetDeltaDeg === 0 ? 0 : targetDeltaDeg > 0 ? 1 : -1;
  const distanceRatio = 1 - getTargetAlignmentProgress(targetDeltaDeg, shots);
  const desiredShift = bbox.width * maxShiftRatio * distanceRatio;
  const availableShift = direction > 0 ? 1 - (bbox.x + bbox.width) : bbox.x;
  const shift = Math.min(desiredShift, availableShift) * direction;

  return {
    ...bbox,
    x: clamp(bbox.x + shift, 0, 1 - bbox.width),
  };
}

export function evaluateCaptureGuidanceState({
  pattern,
  capturedSlots,
  heading,
  preferredTargetSlot = null,
  stableForMs,
  stageReady,
  lastCapturedHeading,
  peakHeadingRateSinceCapture,
  now,
  lastAcceptedAt,
  isCapturing,
  hasCamera,
  acceptIntervalMs = DEFAULT_ACCEPT_INTERVAL_MS,
  stableRequiredMs = DEFAULT_STABLE_REQUIRED_MS,
  slotCenterWindowRatio = DEFAULT_SLOT_CENTER_WINDOW_RATIO,
  targetSwitchHysteresisRatio = DEFAULT_TARGET_SWITCH_HYSTERESIS_RATIO,
  minMovementSlotRatio = DEFAULT_MIN_MOVEMENT_SLOT_RATIO,
  minMovementRateDegPerSec = DEFAULT_MIN_MOVEMENT_RATE_DEG_PER_SEC,
}: EvaluateCaptureGuidanceParams): CaptureGuidanceState {
  const currentStage = getActiveCaptureStage(pattern, capturedSlots);

  if (!currentStage) {
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
      issue: 'complete',
      allCaptured: true,
    };
  }

  const capturedSet = new Set(capturedSlots);
  const currentStageSlotIndex = getStageSlotIndexFromHeading(heading, currentStage.shots);
  const currentSlot = currentStage.slotStart + currentStageSlotIndex;
  const currentSlotCaptured = capturedSet.has(currentSlot);
  const target = getStableStageTarget(
    heading,
    currentStage,
    capturedSlots,
    preferredTargetSlot,
    targetSwitchHysteresisRatio,
  );
  const slotWidth = 360 / Math.max(1, currentStage.shots);
  const nearCenter = target
    ? Math.abs(target.targetDeltaDeg) <= slotWidth * slotCenterWindowRatio
    : false;
  const movedEnoughSinceLastCapture =
    lastCapturedHeading === null
      ? true
      : absoluteHeadingDistance(heading, lastCapturedHeading) >= slotWidth * minMovementSlotRatio;
  const observedMovementRate =
    lastCapturedHeading === null
      ? true
      : peakHeadingRateSinceCapture >= minMovementRateDegPerSec;
  const movedEnough = movedEnoughSinceLastCapture && observedMovementRate;
  const stableEnough = stableForMs >= stableRequiredMs;
  const inCooldown = now - lastAcceptedAt < acceptIntervalMs;

  let issue: AutoCaptureIssue | null = null;

  if (!stageReady) {
    issue = 'stage_locked';
  } else if (!target) {
    issue = 'complete';
  } else if (!nearCenter) {
    issue = 'align_to_marker';
  } else if (!movedEnough) {
    issue = 'move_to_next_angle';
  } else if (inCooldown) {
    issue = 'cooldown';
  } else if (!stableEnough) {
    issue = 'hold_steady';
  } else if (isCapturing) {
    issue = 'capturing';
  } else if (!hasCamera) {
    issue = 'camera_unavailable';
  }

  return {
    currentStage,
    currentSlot,
    currentStageSlotIndex,
    currentSlotCaptured,
    targetSlot: target?.slot ?? null,
    targetStageSlotIndex: target?.stageSlotIndex ?? null,
    targetHeading: target?.targetHeading ?? null,
    targetDeltaDeg: target?.targetDeltaDeg ?? null,
    targetAlignmentProgress: getTargetAlignmentProgress(target?.targetDeltaDeg ?? null, currentStage.shots),
    nearCenter,
    stableEnough,
    movedEnough,
    canCapture: issue === null,
    issue,
    allCaptured: false,
  };
}

export function validateSelectionFraming(
  selection?: ObjectSelection,
): SelectionValidationIssue | null {
  if (!selection) {
    return null;
  }

  const { bbox } = selection;
  const maxDimension = Math.max(bbox.width, bbox.height);
  const area = bbox.width * bbox.height;
  const leftMargin = bbox.x;
  const topMargin = bbox.y;
  const rightMargin = 1 - (bbox.x + bbox.width);
  const bottomMargin = 1 - (bbox.y + bbox.height);

  if (maxDimension < MIN_SELECTION_DIMENSION || area < MIN_SELECTION_AREA) {
    return {
      code: 'too_small',
      title: 'Move Closer To The Object',
      message:
        'The object guide is too small. Move closer and make the object fill more of the blue guide before confirming.',
    };
  }

  if (maxDimension > MAX_SELECTION_DIMENSION) {
    return {
      code: 'too_large',
      title: 'Move Back Slightly',
      message:
        'The object is too close to the camera. Leave a little breathing room around it so every shot stays inside the guide.',
    };
  }

  if (
    leftMargin < MIN_SELECTION_MARGIN ||
    topMargin < MIN_SELECTION_MARGIN ||
    rightMargin < MIN_SELECTION_MARGIN ||
    bottomMargin < MIN_SELECTION_MARGIN
  ) {
    return {
      code: 'too_close_to_edge',
      title: 'Center The Object',
      message:
        'Keep the object away from the frame edges. Reposition it so the whole object stays comfortably inside the guide.',
    };
  }

  return null;
}
