import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../lib/theme';

type Props = {
  slotsTotal?: number;
  capturedSlots: number[];
  size?: number;
  activeSlot?: number | null;
};

export function CaptureRing({
  slotsTotal = 24,
  capturedSlots,
  size = 180,
  activeSlot = null,
}: Props) {
  const capturedSet = useMemo(() => new Set(capturedSlots), [capturedSlots]);
  const radius = size / 2 - 12;
  const segmentHeight = 14;
  const segmentWidth = 4;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {Array.from({ length: slotsTotal }).map((_, slot) => {
        const isCaptured = capturedSet.has(slot);
        const isActive = activeSlot === slot;

        return (
          <View
            key={slot}
            style={[
              styles.segmentBase,
              {
                width: segmentWidth,
                height: segmentHeight,
                left: size / 2 - segmentWidth / 2,
                top: size / 2 - segmentHeight / 2,
                backgroundColor: isCaptured ? '#4ADE80' : '#6B7280',
                opacity: isCaptured ? 1 : 0.75,
                transform: [
                  { rotate: `${(360 / slotsTotal) * slot}deg` },
                  { translateY: -radius },
                ],
              },
              isActive && styles.activeSegment,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBase: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  activeSegment: {
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 2,
  },
});
