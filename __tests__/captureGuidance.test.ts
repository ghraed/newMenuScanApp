import {
  getActiveCaptureStage,
  getCapturePattern,
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
});
