import { TurntableConfig, TurntableSpeedPresetId } from '../types/scanSession';

export type TurntableSpeedPreset = {
  id: TurntableSpeedPresetId;
  title: string;
  description: string;
  fullRotationMs: number;
  recommended?: boolean;
  experimental?: boolean;
};

export const TURNTABLE_SPEED_PRESETS: TurntableSpeedPreset[] = [
  {
    id: 'quality',
    title: 'Quality',
    description: '27.48 s / rotation. Cleanest coverage and lowest blur risk for plates.',
    fullRotationMs: 27480,
    recommended: true,
  },
  {
    id: 'balanced',
    title: 'Balanced',
    description: '14 s / rotation. Faster scan when lighting is strong.',
    fullRotationMs: 14000,
  },
  {
    id: 'experimental',
    title: 'Experimental',
    description: '3.6 s / rotation. Too fast for normal plate capture.',
    fullRotationMs: 3600,
    experimental: true,
  },
];

export const DEFAULT_TURNTABLE_SPEED_PRESET_ID: TurntableSpeedPresetId = 'quality';
export const TURNTABLE_CALIBRATION_ROTATIONS = 3;
export const MIN_TURNTABLE_PRESPIN_MS = 2500;

export function getTurntableSpeedPreset(id?: TurntableSpeedPresetId | null) {
  return TURNTABLE_SPEED_PRESETS.find(preset => preset.id === id) ?? TURNTABLE_SPEED_PRESETS[0];
}

export function createDefaultTurntableConfig(
  presetId: TurntableSpeedPresetId = DEFAULT_TURNTABLE_SPEED_PRESET_ID,
): TurntableConfig {
  const preset = getTurntableSpeedPreset(presetId);

  return {
    speedPresetId: preset.id,
    targetRotationPeriodMs: preset.fullRotationMs,
  };
}

export function getTurntableRotationPeriodMs(config?: TurntableConfig | null) {
  if (!config) {
    return getTurntableSpeedPreset(DEFAULT_TURNTABLE_SPEED_PRESET_ID).fullRotationMs;
  }

  return config.measuredRotationPeriodMs ?? config.targetRotationPeriodMs;
}

export function getTurntableCaptureIntervalMs(rotationPeriodMs: number, slotsTotal: number) {
  if (slotsTotal <= 0) {
    return rotationPeriodMs;
  }

  return rotationPeriodMs / slotsTotal;
}

export function getMedianRotationPeriodMs(samples: number[]) {
  if (samples.length === 0) {
    return null;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  return sorted[middleIndex];
}

export function getTurntablePreSpinDurationMs(rotationPeriodMs: number) {
  return Math.max(rotationPeriodMs, MIN_TURNTABLE_PRESPIN_MS);
}

export function getTurntableCaptureStartAt(
  calibrationCompletedAt: number,
  rotationPeriodMs: number,
) {
  return calibrationCompletedAt + getTurntablePreSpinDurationMs(rotationPeriodMs);
}

export function getTurntableCaptureDueAt(
  captureStartAt: number,
  rotationPeriodMs: number,
  slotsTotal: number,
  slot: number,
) {
  return captureStartAt + getTurntableCaptureIntervalMs(rotationPeriodMs, slotsTotal) * slot;
}
