import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppTheme, useAppTheme } from '../lib/theme';

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
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const capturedSet = useMemo(() => new Set(capturedSlots), [capturedSlots]);
  const radius = size / 2 - 12;
  const segmentHeight = slotsTotal > 36 ? 10 : slotsTotal > 24 ? 12 : 14;
  const segmentWidth = slotsTotal > 36 ? 3 : 4;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {Array.from({ length: slotsTotal }).map((_, slot) => {
        const isCaptured = capturedSet.has(slot);
        const isActive = activeSlot === slot;
        const segmentStyle = {
          width: segmentWidth,
          height: segmentHeight,
          left: size / 2 - segmentWidth / 2,
          top: size / 2 - segmentHeight / 2,
          backgroundColor: isCaptured ? theme.colors.primary : theme.colors.cameraControlOuterSoft,
          opacity: isCaptured ? 1 : 0.82,
          transform: [{ rotate: `${(360 / slotsTotal) * slot}deg` }, { translateY: -radius }],
        } as const;

        return (
          <View
            key={slot}
            style={[styles.segmentBase, segmentStyle, isActive && styles.activeSegment]}
          />
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentBase: {
      position: 'absolute',
      borderRadius: theme.radius.pill,
      borderWidth: 0.5,
      borderColor: theme.colors.borderSoft,
    },
    activeSegment: {
      shadowColor: theme.colors.cameraReady,
      shadowOpacity: 0.65,
      shadowRadius: 6,
      elevation: 3,
    },
  });
}
