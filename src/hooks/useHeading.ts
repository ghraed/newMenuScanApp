import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { useEffect, useRef, useState } from 'react';

type HeadingSample = {
  heading: number;
  timestamp: number;
};

export type HeadingState = {
  heading: number;
  headingRateDegPerSec: number;
  stableForMs: number;
};

export type HeadingProvider = {
  start: (onSample: (sample: HeadingSample) => void) => () => void;
};

type UseHeadingOptions = {
  enabled?: boolean;
  provider?: HeadingProvider;
  stableRateThresholdDegPerSec?: number;
};

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function shortestDeltaDegrees(next: number, prev: number) {
  return ((next - prev + 540) % 360) - 180;
}

type NativeHeadingModule = {
  start?: () => void;
  stop?: () => void;
};

const HEADING_SAMPLE_EVENT = 'HeadingSensorSample';
const headingSensorModule = NativeModules.HeadingSensorModule as NativeHeadingModule | undefined;
const INITIAL_HEADING_STATE: HeadingState = {
  heading: 0,
  headingRateDegPerSec: 0,
  stableForMs: 0,
};
const HEADING_STATE_PUBLISH_INTERVAL_MS = 80;

function createAndroidSensorHeadingProvider(): HeadingProvider | null {
  if (Platform.OS !== 'android' || !headingSensorModule?.start || !headingSensorModule?.stop) {
    return null;
  }

  return {
    start(onSample) {
      const subscription = DeviceEventEmitter.addListener(HEADING_SAMPLE_EVENT, payload => {
        if (!payload || typeof payload !== 'object') {
          return;
        }

        const headingValue = Number((payload as { heading?: unknown }).heading);
        const timestampValue = Number((payload as { timestamp?: unknown }).timestamp);

        if (!Number.isFinite(headingValue) || !Number.isFinite(timestampValue)) {
          return;
        }

        onSample({
          heading: normalizeHeading(headingValue),
          timestamp: Math.max(0, Math.floor(timestampValue)),
        });
      });

      headingSensorModule.start?.();

      return () => {
        subscription.remove();
        headingSensorModule.stop?.();
      };
    },
  };
}

export function createPlaceholderHeadingProvider(): HeadingProvider {
  return {
    start(onSample) {
      const startedAt = Date.now();
      let previousTick = startedAt;
      let heading = 0;

      const timer = setInterval(() => {
        const now = Date.now();
        const dtMs = Math.max(16, now - previousTick);
        previousTick = now;

        const t = now - startedAt;
        const baseDegPerSec = 18;
        const movementFactor = (Math.sin(t / 700) + Math.sin(t / 230)) * 0.5;
        const instantaneousRate = baseDegPerSec + movementFactor * 10;
        heading = normalizeHeading(heading + (instantaneousRate * dtMs) / 1000);

        onSample({ heading, timestamp: now });
      }, 100);

      return () => clearInterval(timer);
    },
  };
}

const defaultProvider = createAndroidSensorHeadingProvider() ?? createPlaceholderHeadingProvider();

export function useHeading({
  enabled = true,
  provider = defaultProvider,
  stableRateThresholdDegPerSec = 8,
}: UseHeadingOptions = {}): HeadingState {
  const [state, setState] = useState<HeadingState>(INITIAL_HEADING_STATE);

  const lastSampleRef = useRef<HeadingSample | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const providerRef = useRef(provider);
  const stableRateThresholdRef = useRef(stableRateThresholdDegPerSec);
  const latestDerivedStateRef = useRef<HeadingState>(INITIAL_HEADING_STATE);

  providerRef.current = provider;
  stableRateThresholdRef.current = stableRateThresholdDegPerSec;

  useEffect(() => {
    if (!enabled) {
      lastSampleRef.current = null;
      stableSinceRef.current = null;
      latestDerivedStateRef.current = INITIAL_HEADING_STATE;
      setState(prevState => (prevState === INITIAL_HEADING_STATE ? prevState : INITIAL_HEADING_STATE));
      return;
    }

    const stop = providerRef.current.start(sample => {
      const prev = lastSampleRef.current;
      let rate = 0;

      if (prev) {
        const dtSec = Math.max(0.001, (sample.timestamp - prev.timestamp) / 1000);
        const delta = shortestDeltaDegrees(sample.heading, prev.heading);
        rate = Math.abs(delta / dtSec);
      }

      const isStable = rate <= stableRateThresholdRef.current;
      if (isStable) {
        stableSinceRef.current ??= sample.timestamp;
      } else {
        stableSinceRef.current = null;
      }

      const stableForMs = stableSinceRef.current ? sample.timestamp - stableSinceRef.current : 0;
      latestDerivedStateRef.current = {
        heading: normalizeHeading(sample.heading),
        headingRateDegPerSec: rate,
        stableForMs,
      };
      lastSampleRef.current = sample;
    });

    const publishTimer = setInterval(() => {
      const nextState = latestDerivedStateRef.current;
      setState(prevState => {
        if (
          prevState.heading === nextState.heading &&
          prevState.headingRateDegPerSec === nextState.headingRateDegPerSec &&
          prevState.stableForMs === nextState.stableForMs
        ) {
          return prevState;
        }

        return nextState;
      });
    }, HEADING_STATE_PUBLISH_INTERVAL_MS);

    return () => {
      clearInterval(publishTimer);
      stop();
      lastSampleRef.current = null;
      stableSinceRef.current = null;
    };
  }, [enabled]);

  return state;
}
