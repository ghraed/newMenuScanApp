import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { AppTheme, useAppTheme } from '../lib/theme';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Screen title="Home" subtitle="Start a new capture session or review previous scans.">
      <View style={styles.group}>
        <AppButton title="New Scan" onPress={() => navigation.navigate('Setup')} />
        <AppButton
          title="My Scans"
          variant="secondary"
          onPress={() => navigation.navigate('MyScans')}
        />
        <AppButton
          title="Settings"
          variant="secondary"
          onPress={() => navigation.navigate('Settings')}
        />
      </View>
    </Screen>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    group: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
  });
}
