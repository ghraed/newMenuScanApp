import {
  evaluateCaptureGuidanceState,
  getActiveCaptureStage,
  getCapturePattern,
  getGhostGuideBoxRect,
  getNearestUncapturedStageTarget,
  getTargetAlignmentProgress,
  validateSelectionFraming,
} from '../src/lib/captureGuidance';

describe('capture guidance', () => {
  test('advances through the 36-photo pattern stages in order', () => {
    const pattern = getCapturePattern(36);

    expect(getActiveCaptureStage(pattern, [])?.stageIndex).toBe(0);
    expect(getActiveCaptureStage(pattern, Array.from({ length: 12 }, (_, index) => index))?.stageIndex).toBe(1);
    expect(
      getActiveCaptureStage(pattern, Array.from({ length: 24 }, (_, index) => index))?.stageIndex,
    ).toBe(2);
    expect(getActiveCaptureStage(pattern, Array.from({ length: 36 }, (_, index) => index))).toBeNull();
  });

  test('flags object selections that are too small for reliable framing', () => {
    const result = validateSelectionFraming({
      method: 'box',
      bbox: {
        x: 0.35,
        y: 0.35,
        width: 0.14,
        height: 0.14,
      },
      selectedAt: Date.now(),
    });

    expect(result?.code).toBe('too_small');
  });

  test('accepts centered object selections with enough size', () => {
    const result = validateSelectionFraming({
      method: 'box',
      bbox: {
        x: 0.25,
        y: 0.2,
        width: 0.42,
        height: 0.42,
      },
      selectedAt: Date.now(),
    });

    expect(result).toBeNull();
  });

  test('chooses the nearest uncaptured stage target with the correct signed delta', () => {
    const pattern = getCapturePattern(36);
    const capturedSlots = [0, 1, 11];
    const stage = getActiveCaptureStage(pattern, capturedSlots);

    expect(stage).not.toBeNull();

    const target = getNearestUncapturedStageTarget(82, stage!, capturedSlots);

    expect(target).toEqual({
      slot: 2,
      stageSlotIndex: 2,
      targetHeading: 75,
      targetDeltaDeg: -7,
      distanceDeg: 7,
    });
  });

  test('updates the nearest open target after a slot is captured', () => {
    const pattern = getCapturePattern(36);
    const baseParams = {
      pattern,
      heading: 80,
      stableForMs: 800,
      stageReady: true,
      lastCapturedHeading: 15,
      peakHeadingRateSinceCapture: 10,
      now: 3000,
      lastAcceptedAt: 0,
      isCapturing: false,
      hasCamera: true,
    };

    const beforeCapture = evaluateCaptureGuidanceState({
      ...baseParams,
      capturedSlots: [0],
    });
    const afterCapture = evaluateCaptureGuidanceState({
      ...baseParams,
      capturedSlots: [0, 2],
    });

    expect(beforeCapture.targetSlot).toBe(2);
    expect(beforeCapture.targetStageSlotIndex).toBe(2);
    expect(afterCapture.targetSlot).toBe(3);
    expect(afterCapture.targetStageSlotIndex).toBe(3);
  });

  test('ghost box moves toward the target, collapses at alignment, and stays on screen', () => {
    const bbox = {
      x: 0.3,
      y: 0.24,
      width: 0.24,
      height: 0.24,
    };

    const rightShift = getGhostGuideBoxRect(bbox, 30, 12);
    const leftShift = getGhostGuideBoxRect(bbox, -30, 12);
    const aligned = getGhostGuideBoxRect(bbox, 0, 12);
    const clamped = getGhostGuideBoxRect(
      {
        x: 0.82,
        y: 0.24,
        width: 0.16,
        height: 0.16,
      },
      60,
      12,
    );

    expect(rightShift.x).toBeGreaterThan(bbox.x);
    expect(leftShift.x).toBeLessThan(bbox.x);
    expect(aligned.x).toBe(bbox.x);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1);
    expect(getTargetAlignmentProgress(0, 12)).toBe(1);
    expect(getTargetAlignmentProgress(15, 12)).toBeCloseTo(0.5);
    expect(getTargetAlignmentProgress(30, 12)).toBe(0);
  });

  test('allows capture only when the nearest target is aligned and stable', () => {
    const pattern = getCapturePattern(36);
    const baseParams = {
      pattern,
      capturedSlots: [0],
      stageReady: true,
      lastCapturedHeading: 15,
      peakHeadingRateSinceCapture: 10,
      now: 3000,
      lastAcceptedAt: 0,
      isCapturing: false,
      hasCamera: true,
    };

    const ready = evaluateCaptureGuidanceState({
      ...baseParams,
      heading: 75,
      stableForMs: 800,
    });
    const misaligned = evaluateCaptureGuidanceState({
      ...baseParams,
      heading: 60,
      stableForMs: 800,
    });
    const unstable = evaluateCaptureGuidanceState({
      ...baseParams,
      heading: 75,
      stableForMs: 100,
    });

    expect(ready.targetSlot).toBe(2);
    expect(ready.canCapture).toBe(true);
    expect(ready.issue).toBeNull();
    expect(misaligned.canCapture).toBe(false);
    expect(misaligned.issue).toBe('align_to_marker');
    expect(unstable.canCapture).toBe(false);
    expect(unstable.issue).toBe('hold_steady');
  });
});
