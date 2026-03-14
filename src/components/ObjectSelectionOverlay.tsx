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
import {
  ObjectSelection,
  ObjectSelectionMethod,
  ObjectSelectionRect,
} from '../types/scanSession';

type Props = {
  onConfirm: (selection: ObjectSelection) => void;
  disabled?: boolean;
};

type LayoutSize = {
  width: number;
  height: number;
};

const TAP_DEFAULT_SIZE = 0.22;
const BOX_DEFAULT_WIDTH = 0.4;
const BOX_DEFAULT_HEIGHT = 0.4;
const MIN_BOX_SIZE = 0.14;
const MAX_BOX_SIZE = 0.9;
const SIZE_STEP = 0.04;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ObjectSelectionOverlay({ onConfirm, disabled = false }: Props) {
  const [mode, setMode] = useState<ObjectSelectionMethod>('tap');
  const [layout, setLayout] = useState<LayoutSize>({ width: 0, height: 0 });
  const [bbox, setBbox] = useState<ObjectSelectionRect | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<ObjectSelectionRect | null>(null);
  const resizeStartRef = useRef<ObjectSelectionRect | null>(null);

  const hasLayout = layout.width > 0 && layout.height > 0;
  const canConfirm = Boolean(hasLayout && bbox && !disabled);
  const focusSizeLabel = bbox ? `${Math.round(Math.max(bbox.width, bbox.height) * 100)}%` : 'Not set';

  const resizeBboxAroundCenter = (delta: number) => {
    if (!bbox) {
      return;
    }

    const centerX = bbox.x + bbox.width / 2;
    const centerY = bbox.y + bbox.height / 2;
    const nextWidth = clamp(bbox.width + delta, MIN_BOX_SIZE, MAX_BOX_SIZE);
    const nextHeight = clamp(bbox.height + delta, MIN_BOX_SIZE, MAX_BOX_SIZE);
    const nextX = clamp(centerX - nextWidth / 2, 0, 1 - nextWidth);
    const nextY = clamp(centerY - nextHeight / 2, 0, 1 - nextHeight);

    setBbox({
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    });
  };

  const setBoxFromTap = (xPx: number, yPx: number) => {
    if (!hasLayout) {
      return;
    }

    const width = mode === 'tap' ? TAP_DEFAULT_SIZE : BOX_DEFAULT_WIDTH;
    const height = mode === 'tap' ? TAP_DEFAULT_SIZE : BOX_DEFAULT_HEIGHT;
    const x = clamp(xPx / layout.width - width / 2, 0, 1 - width);
    const y = clamp(yPx / layout.height - height / 2, 0, 1 - height);

    setPoint({
      x: clamp(xPx / layout.width, 0, 1),
      y: clamp(yPx / layout.height, 0, 1),
    });
    setBbox({ x, y, width, height });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
  };

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => mode === 'box' && Boolean(bbox) && !disabled,
        onPanResponderGrant: () => {
          dragStartRef.current = bbox;
        },
        onPanResponderMove: (_, gestureState) => {
          if (!dragStartRef.current || !hasLayout) {
            return;
          }

          const dx = gestureState.dx / layout.width;
          const dy = gestureState.dy / layout.height;
          const start = dragStartRef.current;
          const x = clamp(start.x + dx, 0, 1 - start.width);
          const y = clamp(start.y + dy, 0, 1 - start.height);
          setBbox({ ...start, x, y });
        },
        onPanResponderRelease: () => {
          dragStartRef.current = null;
        },
      }),
    [bbox, disabled, hasLayout, layout.height, layout.width, mode],
  );

  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => mode === 'box' && Boolean(bbox) && !disabled,
        onPanResponderGrant: () => {
          resizeStartRef.current = bbox;
        },
        onPanResponderMove: (_, gestureState) => {
          if (!resizeStartRef.current || !hasLayout) {
            return;
          }

          const start = resizeStartRef.current;
          const maxWidth = Math.min(MAX_BOX_SIZE, 1 - start.x);
          const maxHeight = Math.min(MAX_BOX_SIZE, 1 - start.y);
          const width = clamp(start.width + gestureState.dx / layout.width, MIN_BOX_SIZE, maxWidth);
          const height = clamp(
            start.height + gestureState.dy / layout.height,
            MIN_BOX_SIZE,
            maxHeight,
          );

          setBbox({ ...start, width, height });
        },
        onPanResponderRelease: () => {
          resizeStartRef.current = null;
        },
      }),
    [bbox, disabled, hasLayout, layout.height, layout.width, mode],
  );

  const boxStyle = bbox
    ? {
        left: bbox.x * layout.width,
        top: bbox.y * layout.height,
        width: bbox.width * layout.width,
        height: bbox.height * layout.height,
      }
    : undefined;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable
        style={styles.touchLayer}
        onLayout={onLayout}
        onPress={event => {
          setBoxFromTap(event.nativeEvent.locationX, event.nativeEvent.locationY);
        }}
      />

      {bbox ? (
        <View
          style={[styles.box, boxStyle, mode === 'box' && styles.boxEditable]}
          {...(mode === 'box' ? dragResponder.panHandlers : {})}>
          <View style={styles.boxLabel}>
            <Text style={styles.boxLabelText}>
              {mode === 'tap' ? 'Tap selection' : 'Bounding box'}
            </Text>
          </View>
          {mode === 'box' ? (
            <View style={styles.resizeHandle} {...resizeResponder.panHandlers}>
              <View style={styles.resizeHandleDot} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.panel}>
        <Text style={styles.title}>Select Object First</Text>
        <Text style={styles.subtitle}>
          Tap the object or switch to Bounding Box mode. The guide should tightly frame the object without touching the screen edges.
        </Text>
        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeButton, mode === 'tap' && styles.modeButtonActive]}
            onPress={() => setMode('tap')}>
            <Text style={styles.modeButtonText}>Tap Object</Text>
          </Pressable>
          <Pressable
            style={[styles.modeButton, mode === 'box' && styles.modeButtonActive]}
            onPress={() => setMode('box')}>
            <Text style={styles.modeButtonText}>Bounding Box</Text>
          </Pressable>
        </View>

        <View style={styles.sizePanel}>
          <Text style={styles.sizePanelLabel}>Focus Area</Text>
          <Text style={styles.sizeHint}>
            Keep the object large in frame. Tiny subjects usually lead to weak background removal.
          </Text>
          <View style={styles.sizeControls}>
            <Pressable
              style={[styles.sizeButton, disabled && styles.actionDisabled]}
              onPress={() => {
                resizeBboxAroundCenter(-SIZE_STEP);
              }}
              disabled={disabled || !bbox}>
              <Text style={styles.sizeButtonText}>Smaller</Text>
            </Pressable>
            <Text style={styles.sizeValue}>{focusSizeLabel}</Text>
            <Pressable
              style={[styles.sizeButton, disabled && styles.actionDisabled]}
              onPress={() => {
                resizeBboxAroundCenter(SIZE_STEP);
              }}
              disabled={disabled || !bbox}>
              <Text style={styles.sizeButtonText}>Bigger</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            style={styles.secondaryAction}
            onPress={() => {
              setBbox(null);
              setPoint(null);
            }}
            disabled={disabled}>
            <Text style={styles.secondaryActionText}>Reset</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryAction, !canConfirm && styles.actionDisabled]}
            onPress={() => {
              if (!bbox) {
                return;
              }
              onConfirm({
                method: mode,
                bbox,
                point:
                  mode === 'tap' && point
                    ? point
                    : {
                        x: bbox.x + bbox.width / 2,
                        y: bbox.y + bbox.height / 2,
                      },
                selectedAt: Date.now(),
              });
            }}
            disabled={!canConfirm}>
            <Text style={styles.primaryActionText}>Confirm Object</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  touchLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(92,180,255,0.12)',
    borderRadius: theme.radius.md,
  },
  boxEditable: {
    borderStyle: 'dashed',
  },
  boxLabel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(11,16,32,0.86)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderBottomRightRadius: theme.radius.sm,
  },
  boxLabelText: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  resizeHandle: {
    position: 'absolute',
    right: -10,
    bottom: -10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0B1020',
    borderColor: theme.colors.primary,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resizeHandleDot: {
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
  },
  panel: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    top: 62,
    backgroundColor: 'rgba(11,16,32,0.88)',
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  title: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  modeButtonActive: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(92,180,255,0.22)',
  },
  modeButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  sizePanel: {
    gap: theme.spacing.xs,
  },
  sizePanelLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  sizeHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  sizeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sizeButton: {
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  sizeButtonText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  sizeValue: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  secondaryActionText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  primaryAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
  },
  primaryActionText: {
    color: '#0B1020',
    fontSize: 13,
    fontWeight: '700',
  },
  actionDisabled: {
    opacity: 0.45,
  },
});
