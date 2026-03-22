import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../lib/theme';
import { ObjectSelection, ObjectSelectionRect } from '../types/scanSession';
import { AppButton } from './AppButton';

type Props = {
  onConfirm: (selection: ObjectSelection) => void;
  disabled?: boolean;
};

type LayoutSize = {
  width: number;
  height: number;
};

const DEFAULT_SELECTION_SIZE = 0.26;
const MIN_BOX_SIZE = 0.14;
const MAX_BOX_SIZE = 0.9;
const SIZE_STEP = 0.04;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildCenteredBox(centerX: number, centerY: number, size: number): ObjectSelectionRect {
  const nextSize = clamp(size, MIN_BOX_SIZE, MAX_BOX_SIZE);
  return {
    x: clamp(centerX - nextSize / 2, 0, 1 - nextSize),
    y: clamp(centerY - nextSize / 2, 0, 1 - nextSize),
    width: nextSize,
    height: nextSize,
  };
}

export function ObjectSelectionOverlay({ onConfirm, disabled = false }: Props) {
  const [layout, setLayout] = useState<LayoutSize>({ width: 0, height: 0 });
  const [bbox, setBbox] = useState<ObjectSelectionRect | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [selectionStarted, setSelectionStarted] = useState(false);
  const [instructionsVisible, setInstructionsVisible] = useState(true);
  const dragStartRef = useRef<ObjectSelectionRect | null>(null);

  const hasLayout = layout.width > 0 && layout.height > 0;
  const hasSelection = Boolean(bbox);
  const canConfirm = Boolean(selectionStarted && hasLayout && bbox && !disabled);
  const focusSizeLabel = bbox
    ? `${Math.round(Math.max(bbox.width, bbox.height) * 100)}%`
    : `${Math.round(DEFAULT_SELECTION_SIZE * 100)}%`;

  const setSelection = (nextBbox: ObjectSelectionRect) => {
    setBbox(nextBbox);
    setPoint({
      x: nextBbox.x + nextBbox.width / 2,
      y: nextBbox.y + nextBbox.height / 2,
    });
  };

  const resizeBboxAroundCenter = (delta: number) => {
    if (!bbox) {
      return;
    }

    const centerX = bbox.x + bbox.width / 2;
    const centerY = bbox.y + bbox.height / 2;
    const nextBox = buildCenteredBox(centerX, centerY, bbox.width + delta);
    setSelection(nextBox);
  };

  const setBoxFromTap = (xPx: number, yPx: number) => {
    if (!hasLayout) {
      return;
    }

    const centerX = clamp(xPx / layout.width, 0, 1);
    const centerY = clamp(yPx / layout.height, 0, 1);
    const nextSize = bbox ? Math.max(bbox.width, bbox.height) : DEFAULT_SELECTION_SIZE;

    setSelection(buildCenteredBox(centerX, centerY, nextSize));
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => selectionStarted && Boolean(bbox) && !disabled,
        onPanResponderGrant: () => {
          dragStartRef.current = bbox;
        },
        onPanResponderMove: (_, gestureState) => {
          if (!dragStartRef.current || !hasLayout) {
            return;
          }

          const start = dragStartRef.current;
          const x = clamp(start.x + gestureState.dx / layout.width, 0, 1 - start.width);
          const y = clamp(start.y + gestureState.dy / layout.height, 0, 1 - start.height);
          setSelection({ ...start, x, y });
        },
        onPanResponderRelease: () => {
          dragStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragStartRef.current = null;
        },
      }),
    [bbox, disabled, hasLayout, layout.height, layout.width, selectionStarted],
  );

  const boxStyle = bbox
    ? {
        left: bbox.x * layout.width,
        top: bbox.y * layout.height,
        width: bbox.width * layout.width,
        height: bbox.height * layout.height,
      }
    : undefined;

  const confirmSelection = () => {
    if (!bbox) {
      return;
    }

    onConfirm({
      method: 'box',
      bbox,
      point: point ?? {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      },
      viewportSize: {
        width: layout.width,
        height: layout.height,
      },
      selectedAt: Date.now(),
    });
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.selectionSurface} pointerEvents={selectionStarted ? 'auto' : 'none'}>
        <Pressable
          style={styles.touchLayer}
          onLayout={onLayout}
          onPress={event => {
            setBoxFromTap(event.nativeEvent.locationX, event.nativeEvent.locationY);
          }}
          disabled={!selectionStarted || disabled}
        />

        {bbox ? (
          <View style={[styles.box, boxStyle]} {...dragResponder.panHandlers}>
            <View style={styles.boxLabel}>
              <Text style={styles.boxLabelText}>Drag to reposition</Text>
            </View>
          </View>
        ) : null}
      </View>

      {selectionStarted ? (
        <Pressable
          style={[styles.infoButton, disabled && styles.actionDisabled]}
          onPress={() => setInstructionsVisible(true)}
          disabled={disabled}>
          <Text style={styles.infoButtonText}>i</Text>
        </Pressable>
      ) : null}

      {selectionStarted ? (
        <View style={styles.selectionControls} pointerEvents="box-none">
          <View style={styles.hintCard}>
            <Text style={styles.hintTitle}>{hasSelection ? 'Adjust The Selection' : 'Tap The Object'}</Text>
            <Text style={styles.hintText}>
              {hasSelection
                ? 'Use the circle buttons to tighten or loosen the guide, then confirm.'
                : 'Tap the object to place the guide. Keep it large in frame and away from the screen edges.'}
            </Text>
          </View>

          <View style={styles.bottomCard}>
            <View style={styles.resizeRow}>
              <Pressable
                style={[styles.circleButton, (!bbox || disabled) && styles.actionDisabled]}
                onPress={() => resizeBboxAroundCenter(-SIZE_STEP)}
                disabled={!bbox || disabled}>
                <Text style={styles.circleButtonText}>-</Text>
              </Pressable>
              <View style={styles.sizeBadge}>
                <Text style={styles.sizeBadgeLabel}>Selection</Text>
                <Text style={styles.sizeBadgeValue}>{focusSizeLabel}</Text>
              </View>
              <Pressable
                style={[styles.circleButton, (!bbox || disabled) && styles.actionDisabled]}
                onPress={() => resizeBboxAroundCenter(SIZE_STEP)}
                disabled={!bbox || disabled}>
                <Text style={styles.circleButtonText}>+</Text>
              </Pressable>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.resetButton, disabled && styles.actionDisabled]}
                onPress={() => {
                  setBbox(null);
                  setPoint(null);
                }}
                disabled={disabled}>
                <Text style={styles.resetButtonText}>Reset</Text>
              </Pressable>
            </View>

            {bbox ? (
              <AppButton
                title={disabled ? 'Saving...' : 'Confirm Object'}
                onPress={confirmSelection}
                disabled={!canConfirm}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {instructionsVisible ? (
        <View style={styles.instructionsScrim}>
          <View style={styles.instructionsCard}>
            <Text style={styles.instructionsEyebrow}>Before Capture</Text>
            <Text style={styles.instructionsTitle}>Select The Object First</Text>
            <Text style={styles.instructionsBody}>
              Move the camera until the object fills most of the screen without touching the edges.
            </Text>
            <Text style={styles.instructionsStep}>1. Tap Start Selection.</Text>
            <Text style={styles.instructionsStep}>2. Tap the object to place the guide.</Text>
            <Text style={styles.instructionsStep}>3. Use - and + to adjust the guide size.</Text>
            <Text style={styles.instructionsStep}>4. Confirm the object, then begin capturing.</Text>
            <AppButton
              title={selectionStarted ? 'Continue Selection' : 'Start Selection'}
              onPress={() => {
                setSelectionStarted(true);
                setInstructionsVisible(false);
              }}
              disabled={disabled}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  selectionSurface: {
    ...StyleSheet.absoluteFillObject,
  },
  touchLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#8FDFFF',
    backgroundColor: 'rgba(143,223,255,0.16)',
    borderRadius: theme.radius.lg,
    shadowColor: '#8FDFFF',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 4,
  },
  boxLabel: {
    alignSelf: 'flex-start',
    margin: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(11,16,32,0.84)',
  },
  boxLabelText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  infoButton: {
    position: 'absolute',
    top: 72,
    right: theme.spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,16,32,0.9)',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoButtonText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  selectionControls: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  hintCard: {
    alignSelf: 'stretch',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(143,223,255,0.36)',
    backgroundColor: 'rgba(8,17,34,0.82)',
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  hintTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  hintText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  bottomCard: {
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(11,16,32,0.9)',
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  resizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  circleButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  circleButtonText: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 30,
  },
  sizeBadge: {
    minWidth: 112,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  sizeBadgeLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sizeBadgeValue: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  resetButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  resetButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  instructionsScrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,6,14,0.64)',
    padding: theme.spacing.lg,
  },
  instructionsCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(11,16,32,0.96)',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  instructionsEyebrow: {
    color: '#8FDFFF',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  instructionsTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  instructionsBody: {
    color: '#E8ECFA',
    fontSize: 14,
    lineHeight: 21,
  },
  instructionsStep: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  actionDisabled: {
    opacity: 0.45,
  },
});
