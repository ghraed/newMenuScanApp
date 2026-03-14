import { ObjectSelection } from '../types/scanSession';

export type CaptureStageId = 'middle' | 'low' | 'high';

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

const MIN_SELECTION_DIMENSION = 0.2;
const MIN_SELECTION_AREA = 0.04;
const MAX_SELECTION_DIMENSION = 0.74;
const MIN_SELECTION_MARGIN = 0.05;

export const CAPTURE_PATTERNS: CapturePattern[] = [
  {
    id: 'pattern_24',
    title: '24 Photos',
    shortTitle: '24',
    description: '8 middle, 8 lower, 8 upper. Fastest full scan.',
    totalShots: 24,
    stages: [
      {
        id: 'middle',
        title: 'Middle Ring',
        shortTitle: 'Middle',
        description: 'Keep the camera level with the object center.',
        promptTitle: 'Start the Middle Ring',
        promptMessage:
          'Keep the camera level with the object center. Walk around once while the object fills the guide.',
        confirmLabel: 'Start Middle Ring',
        moveLabel: 'Keep level',
        shots: 8,
      },
      {
        id: 'low',
        title: 'Lower Ring',
        shortTitle: 'Lower',
        description: 'Move downward and look slightly upward.',
        promptTitle: 'Move Downward',
        promptMessage:
          'Lower the camera until you can see more of the bottom edges. Keep the object the same size inside the guide.',
        confirmLabel: 'I Moved Downward',
        moveLabel: 'Move downward',
        shots: 8,
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
        shots: 8,
      },
    ],
  },
  {
    id: 'pattern_36',
    title: '36 Photos',
    shortTitle: '36',
    description: '12 middle, 12 lower, 12 upper. Best default quality.',
    totalShots: 36,
    recommended: true,
    stages: [
      {
        id: 'middle',
        title: 'Middle Ring',
        shortTitle: 'Middle',
        description: 'Keep the camera level with the object center.',
        promptTitle: 'Start the Middle Ring',
        promptMessage:
          'Keep the camera level with the object center. Rotate around it with smooth, even spacing between shots.',
        confirmLabel: 'Start Middle Ring',
        moveLabel: 'Keep level',
        shots: 12,
      },
      {
        id: 'low',
        title: 'Lower Ring',
        shortTitle: 'Lower',
        description: 'Move downward and look slightly upward.',
        promptTitle: 'Move Downward',
        promptMessage:
          'Lower the camera and keep the object framed in the guide. You should see more of the lower edges before capturing.',
        confirmLabel: 'I Moved Downward',
        moveLabel: 'Move downward',
        shots: 12,
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
        shots: 12,
      },
    ],
  },
  {
    id: 'pattern_50',
    title: '50 Photos',
    shortTitle: '50',
    description: '18 middle, 16 lower, 16 upper. Highest density.',
    totalShots: 50,
    stages: [
      {
        id: 'middle',
        title: 'Middle Ring',
        shortTitle: 'Middle',
        description: 'Keep the camera level with the object center.',
        promptTitle: 'Start the Middle Ring',
        promptMessage:
          'Begin at object-center height. Use very small, even angle changes and keep the object filling the guide.',
        confirmLabel: 'Start Middle Ring',
        moveLabel: 'Keep level',
        shots: 18,
      },
      {
        id: 'low',
        title: 'Lower Ring',
        shortTitle: 'Lower',
        description: 'Move downward and look slightly upward.',
        promptTitle: 'Move Downward',
        promptMessage:
          'Lower the camera and keep the object large in frame. Capture the lower edges from many evenly spaced angles.',
        confirmLabel: 'I Moved Downward',
        moveLabel: 'Move downward',
        shots: 16,
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
        shots: 16,
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
