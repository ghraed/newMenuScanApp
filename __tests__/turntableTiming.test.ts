import {
  MIN_TURNTABLE_PRESPIN_MS,
  createDefaultTurntableConfig,
  getMedianRotationPeriodMs,
  getTurntableCaptureDueAt,
  getTurntableCaptureIntervalMs,
  getTurntableCaptureStartAt,
  getTurntablePreSpinDurationMs,
  getTurntableRotationPeriodMs,
  getTurntableSpeedPreset,
} from '../src/lib/turntable';

describe('turntable timing', () => {
  test('uses the quality preset as the default turntable config', () => {
    const config = createDefaultTurntableConfig();

    expect(config.speedPresetId).toBe('quality');
    expect(config.targetRotationPeriodMs).toBe(27480);
  });

  test('prefers measured rotation period when calibration is complete', () => {
    const config = {
      ...createDefaultTurntableConfig('balanced'),
      measuredRotationPeriodMs: 14200,
    };

    expect(getTurntableRotationPeriodMs(config)).toBe(14200);
    expect(getTurntableRotationPeriodMs(undefined)).toBe(getTurntableSpeedPreset('quality').fullRotationMs);
  });

  test('computes evenly spaced timing for a 36-photo quality scan', () => {
    const intervalMs = getTurntableCaptureIntervalMs(27480, 36);

    expect(intervalMs).toBeCloseTo(763.333, 3);
    expect(Math.round(intervalMs)).toBe(763);
  });

  test('uses the median of three measured rotations', () => {
    expect(getMedianRotationPeriodMs([27520, 27440, 27480])).toBe(27480);
  });

  test('pre-spin lasts at least one rotation and never less than the minimum', () => {
    expect(getTurntablePreSpinDurationMs(14000)).toBe(14000);
    expect(getTurntablePreSpinDurationMs(1800)).toBe(MIN_TURNTABLE_PRESPIN_MS);
  });

  test('derives capture start and due times from the measured rotation', () => {
    const calibrationCompletedAt = 1000;
    const captureStartAt = getTurntableCaptureStartAt(calibrationCompletedAt, 27480);
    const slotTenDueAt = getTurntableCaptureDueAt(captureStartAt, 27480, 36, 10);

    expect(captureStartAt).toBe(1000 + 27480);
    expect(slotTenDueAt).toBeCloseTo(captureStartAt + 10 * (27480 / 36), 5);
  });
});
