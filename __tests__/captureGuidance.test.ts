import {
  evaluateCaptureGuidanceState,
  getActiveCaptureStage,
  getCapturePattern,
  getGhostGuideBoxRect,
  getNearestUncapturedStageTarget,
  getStableStageTarget,
  getTargetAlignmentProgress,
  validateSelectionFraming,
} from '../src/lib/captureGuidance';

describe('capture guidance', () => {
  test('keeps capture pattern stage totals aligned with the advertised total', () => {
    const patterns = [24, 36, 50].map(total => getCapturePattern(total));

    expect(patterns.map(pattern => pattern.stages.reduce((sum, stage) => sum + stage.shots, 0))).toEqual([
      24,
      36,
      50,
    ]);
  });

  test('advances through the 36-photo pattern stages in order', () => {
    const pattern = getCapturePattern(36);

    expect(getActiveCaptureStage(pattern, [])?.stageIndex).toBe(0);
    expect(getActiveCaptureStage(pattern, Array.from({ length: 18 }, (_, index) => index))?.stageIndex).toBe(1);
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
    const capturedSlots = [0, 1, 4];
    const stage = getActiveCaptureStage(pattern, capturedSlots);

    expect(stage).not.toBeNull();

    const target = getNearestUncapturedStageTarget(82, stage!, capturedSlots);

    expect(target).toEqual({
      slot: 3,
      stageSlotIndex: 3,
      targetHeading: 70,
      targetDeltaDeg: -12,
      distanceDeg: 12,
    });
  });

  test('updates the nearest open target after a slot is captured', () => {
    const pattern = getCapturePattern(36);
    const baseParams = {
      pattern,
      heading: 70,
      stableForMs: 800,
      stageReady: true,
      lastCapturedHeading: 50,
      peakHeadingRateSinceCapture: 10,
      now: 3000,
      lastAcceptedAt: 0,
      isCapturing: false,
      hasCamera: true,
    };

    const beforeCapture = evaluateCaptureGuidanceState({
      ...baseParams,
      capturedSlots: [0, 1, 2],
    });
    const afterCapture = evaluateCaptureGuidanceState({
      ...baseParams,
      capturedSlots: [0, 1, 2, 3],
    });

    expect(beforeCapture.targetSlot).toBe(3);
    expect(beforeCapture.targetStageSlotIndex).toBe(3);
    expect(afterCapture.targetSlot).toBe(4);
    expect(afterCapture.targetStageSlotIndex).toBe(4);
  });

  test('holds the current guide target until the next slot is clearly better', () => {
    const pattern = getCapturePattern(36);
    const stage = getActiveCaptureStage(pattern, [0, 1, 2]);

    expect(stage).not.toBeNull();

    const stickyTarget = getStableStageTarget(82, stage!, [0, 1, 2], 3);
    const switchedTarget = getStableStageTarget(86, stage!, [0, 1, 2], 3);

    expect(stickyTarget?.slot).toBe(3);
    expect(switchedTarget?.slot).toBe(4);
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
      capturedSlots: [0, 1, 2],
      stageReady: true,
      lastCapturedHeading: 50,
      peakHeadingRateSinceCapture: 10,
      now: 3000,
      lastAcceptedAt: 0,
      isCapturing: false,
      hasCamera: true,
    };

    const ready = evaluateCaptureGuidanceState({
      ...baseParams,
      heading: 70,
      stableForMs: 800,
    });
    const misaligned = evaluateCaptureGuidanceState({
      ...baseParams,
      heading: 55,
      stableForMs: 800,
    });
    const unstable = evaluateCaptureGuidanceState({
      ...baseParams,
      heading: 70,
      stableForMs: 100,
    });

    expect(ready.targetSlot).toBe(3);
    expect(ready.canCapture).toBe(true);
    expect(ready.issue).toBeNull();
    expect(misaligned.canCapture).toBe(false);
    expect(misaligned.issue).toBe('align_to_marker');
    expect(unstable.canCapture).toBe(false);
    expect(unstable.issue).toBe('hold_steady');
  });
});
