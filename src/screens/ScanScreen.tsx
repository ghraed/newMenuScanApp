import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../components/AppButton';
import { CaptureRing } from '../components/CaptureRing';
import { useAutoCapture } from '../hooks/useAutoCapture';
import { useHeading } from '../hooks/useHeading';
import { theme } from '../lib/theme';
import { getScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'Scan'>;

export function ScanScreen({ route, navigation }: Props) {
  const { scanId } = route.params;
  const isFocused = useIsFocused();
  const camera = React.useRef<Camera | null>(null);
  const device = useCameraDevice('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [session, setSession] = useState<ScanSession | undefined>(() => getScanSession(scanId));
  const heading = useHeading({ enabled: isFocused });

  const reloadSession = useCallback(() => {
    setSession(getScanSession(scanId));
  }, [scanId]);

  useFocusEffect(
    useCallback(() => {
      reloadSession();
    }, [reloadSession]),
  );

  const requestCameraPermission = useCallback(async () => {
    const current = await Camera.getCameraPermissionStatus();
    if (current === 'granted') {
      setPermissionGranted(true);
      return;
    }
    const requested = await Camera.requestCameraPermission();
    setPermissionGranted(requested === 'granted');
  }, []);

  React.useEffect(() => {
    void requestCameraPermission();
  }, [requestCameraPermission]);

  const autoCapture = useAutoCapture({
    cameraRef: camera,
    enabled: Boolean(isFocused && permissionGranted && device && isCameraReady),
    session,
    heading,
    onSessionUpdated: setSession,
  });

  const capturedCount = session?.images.length ?? 0;
  const slotsTotal = session?.slotsTotal ?? 24;
  const capturedSlots = useMemo(() => session?.images.map(image => image.slot) ?? [], [session]);
  const finishEnabled = capturedCount >= 12;

  if (!session) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Scan session not found</Text>
        <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {permissionGranted && device ? (
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isFocused}
          photo
          onInitialized={() => setIsCameraReady(true)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.cameraFallback]} />
      )}

      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.topHud}>
          <Text style={styles.hudTitle}>Move around the object</Text>
          <Text style={styles.hudSubtitle}>Captured {capturedCount}/{slotsTotal}</Text>
          {autoCapture.holdSteady ? <Text style={styles.hudWarning}>Hold steady...</Text> : null}
          {!permissionGranted ? (
            <Pressable style={styles.permissionChip} onPress={() => void requestCameraPermission()}>
              <Text style={styles.permissionChipText}>Grant Camera Access</Text>
            </Pressable>
          ) : null}
          {permissionGranted && !device ? (
            <Text style={styles.hudWarning}>No back camera device found.</Text>
          ) : null}
        </View>

        <View style={styles.bottomHud}>
          <View style={styles.captureArea}>
            <CaptureRing
              slotsTotal={slotsTotal}
              capturedSlots={capturedSlots}
              size={190}
              activeSlot={autoCapture.currentSlot}
            />
            <View style={styles.captureIndicatorOuter}>
              <View style={[styles.captureIndicatorInner, autoCapture.isCapturing && styles.captureIndicatorBusy]}>
                {autoCapture.isCapturing ? <ActivityIndicator color="#0B1020" /> : null}
              </View>
            </View>
          </View>

          <AppButton
            title="Finish"
            onPress={() => navigation.navigate('Preview', { scanId })}
            disabled={!finishEnabled}
            style={styles.finishButton}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraFallback: {
    backgroundColor: '#060A16',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topHud: {
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  hudTitle: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  hudSubtitle: {
    color: '#E8ECFA',
    fontSize: 14,
    textAlign: 'center',
  },
  hudWarning: {
    color: '#FFD166',
    fontSize: 13,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  permissionChip: {
    alignSelf: 'center',
    marginTop: theme.spacing.sm,
    backgroundColor: 'rgba(18,26,48,0.9)',
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  permissionChipText: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  bottomHud: {
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  captureArea: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIndicatorOuter: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  captureIndicatorInner: {
    width: 62,
    height: 62,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIndicatorBusy: {
    backgroundColor: '#B5F1C5',
  },
  finishButton: {
    width: '100%',
    maxWidth: 280,
  },
  fallback: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  fallbackTitle: {
    color: theme.colors.text,
    fontWeight: '700',
    fontSize: 18,
    textAlign: 'center',
  },
});
