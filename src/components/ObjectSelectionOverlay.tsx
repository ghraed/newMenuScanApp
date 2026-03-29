import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppTheme, useAppTheme } from '../lib/theme';
import { ObjectSelection, ObjectSelectionRect, ScanTargetType } from '../types/scanSession';
import { AppButton } from './AppButton';

type Props = {
  onConfirm: (selection: ObjectSelection) => void;
  targetType?: ScanTargetType;
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
const DISH_BOX_ASPECT_RATIO = 1.45;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getBoxDimensions(size: number, targetType: ScanTargetType) {
  const nextSize = clamp(size, MIN_BOX_SIZE, MAX_BOX_SIZE);

  if (targetType === 'dish') {
    return {
      width: nextSize,
      height: clamp(nextSize / DISH_BOX_ASPECT_RATIO, MIN_BOX_SIZE / DISH_BOX_ASPECT_RATIO, MAX_BOX_SIZE),
    };
  }

  return {
    width: nextSize,
    height: nextSize,
  };
}

function buildCenteredBox(
  centerX: number,
  centerY: number,
  size: number,
  targetType: ScanTargetType,
): ObjectSelectionRect {
  const { width, height } = getBoxDimensions(size, targetType);

  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function ObjectSelectionOverlay({
  onConfirm,
  targetType = 'dish',
  disabled = false,
}: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
    const nextBox = buildCenteredBox(
      centerX,
      centerY,
      Math.max(bbox.width, bbox.height) + delta,
      targetType,
    );
    setSelection(nextBox);
  };

  const setBoxFromTap = (xPx: number, yPx: number) => {
    if (!hasLayout) {
      return;
    }

    const centerX = clamp(xPx / layout.width, 0, 1);
    const centerY = clamp(yPx / layout.height, 0, 1);
    const nextSize = bbox ? Math.max(bbox.width, bbox.height) : DEFAULT_SELECTION_SIZE;

    setSelection(buildCenteredBox(centerX, centerY, nextSize, targetType));
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

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
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
      borderColor: theme.colors.cameraReady,
      backgroundColor: theme.colors.cameraReadySoft,
      borderRadius: theme.radius.lg,
      shadowColor: theme.colors.cameraReady,
      shadowOpacity: 0.28,
      shadowRadius: 12,
      elevation: 4,
    },
    boxLabel: {
      alignSelf: 'flex-start',
      margin: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.cameraPanel,
    },
    boxLabelText: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
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
      backgroundColor: theme.colors.cameraPanel,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      ...theme.shadows.soft,
    },
    infoButtonText: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: 18,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: 0.2,
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
      borderColor: theme.colors.cameraGuide,
      backgroundColor: theme.colors.cameraPanelSoft,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
      ...theme.shadows.card,
    },
    hintTitle: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    hintText: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
      opacity: 0.78,
    },
    bottomCard: {
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.cameraPanel,
      padding: theme.spacing.md,
      gap: theme.spacing.md,
      ...theme.shadows.floating,
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
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    circleButtonText: {
      color: theme.colors.text,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: 28,
      fontWeight: theme.typography.title.fontWeight,
      lineHeight: 30,
      letterSpacing: 0.2,
    },
    sizeBadge: {
      minWidth: 112,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    sizeBadgeLabel: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      textTransform: theme.typography.label.textTransform,
      letterSpacing: theme.typography.label.letterSpacing,
      opacity: 0.72,
    },
    sizeBadgeValue: {
      color: theme.colors.cameraReady,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'center',
    },
    resetButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.surfaceAlt,
    },
    resetButtonText: {
      color: theme.colors.text,
      fontFamily: theme.typography.button.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.button.fontWeight,
      letterSpacing: theme.typography.button.letterSpacing,
    },
    instructionsScrim: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.scrim,
      padding: theme.spacing.lg,
    },
    instructionsCard: {
      width: '100%',
      maxWidth: 360,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      backgroundColor: theme.colors.cameraPanel,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      ...theme.shadows.floating,
    },
    instructionsEyebrow: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      textTransform: theme.typography.label.textTransform,
      letterSpacing: theme.typography.label.letterSpacing,
    },
    instructionsTitle: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: theme.typography.title.fontSize,
      lineHeight: theme.typography.title.lineHeight,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    instructionsBody: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.body.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.body.fontWeight,
      letterSpacing: theme.typography.body.letterSpacing,
      opacity: 0.9,
    },
    instructionsStep: {
      color: theme.colors.cameraText,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
      opacity: 0.76,
    },
    actionDisabled: {
      opacity: 0.45,
    },
  });
}
