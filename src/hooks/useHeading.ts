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

const defaultProvider = createPlaceholderHeadingProvider();

export function useHeading({
  enabled = true,
  provider = defaultProvider,
  stableRateThresholdDegPerSec = 24,
}: UseHeadingOptions = {}): HeadingState {
  const [state, setState] = useState<HeadingState>({
    heading: 0,
    headingRateDegPerSec: 0,
    stableForMs: 0,
  });

  const lastSampleRef = useRef<HeadingSample | null>(null);
  const stableSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const stop = provider.start(sample => {
      const prev = lastSampleRef.current;
      let rate = 0;

      if (prev) {
        const dtSec = Math.max(0.001, (sample.timestamp - prev.timestamp) / 1000);
        const delta = shortestDeltaDegrees(sample.heading, prev.heading);
        rate = Math.abs(delta / dtSec);
      }

      const isStable = rate <= stableRateThresholdDegPerSec;
      if (isStable) {
        stableSinceRef.current ??= sample.timestamp;
      } else {
        stableSinceRef.current = null;
      }

      const stableForMs = stableSinceRef.current ? sample.timestamp - stableSinceRef.current : 0;

      lastSampleRef.current = sample;
      setState({
        heading: normalizeHeading(sample.heading),
        headingRateDegPerSec: rate,
        stableForMs,
      });
    });

    return () => {
      stop();
      lastSampleRef.current = null;
      stableSinceRef.current = null;
    };
  }, [enabled, provider, stableRateThresholdDegPerSec]);

  return state;
}
