import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { theme } from '../lib/theme';
import { deleteScanSession, listScanSessions } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';
import { ScanSession } from '../types/scanSession';

type Props = NativeStackScreenProps<RootStackParamList, 'MyScans'>;

export function MyScansScreen({ navigation }: Props) {
  const [scans, setScans] = React.useState<ScanSession[]>([]);

  const reload = React.useCallback(() => {
    setScans(listScanSessions());
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const formatCreatedAt = React.useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  }, []);

  const renderItem = ({ item }: { item: ScanSession }) => (
    <View style={styles.row}>
      <Pressable onPress={() => navigation.navigate('Preview', { scanId: item.id })} style={styles.rowMain}>
        <Text style={styles.rowPrimary}>{formatCreatedAt(item.createdAt)}</Text>
        <Text style={styles.rowSecondary}>Captured: {item.images.length}</Text>
        <Text style={styles.rowSecondary}>Status: {item.status}</Text>
      </Pressable>
      <AppButton
        title="Delete"
        variant="danger"
        style={styles.rowDelete}
        onPress={() => {
          void deleteScanSession(item.id).then(reload);
        }}
      />
    </View>
  );

  return (
    <Screen
      title="My Scans"
      subtitle="Open a saved scan preview or remove a scan session."
      scroll={false}>
      {scans.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No scans yet.</Text>
          <AppButton title="New Scan" onPress={() => navigation.navigate('Setup')} />
        </View>
      ) : (
        <FlatList
          data={scans}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={ListSeparator}
        />
      )}
    </Screen>
  );
}

function ListSeparator() {
  return <View style={styles.listSeparator} />;
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: theme.spacing.xxl,
  },
  listSeparator: {
    height: theme.spacing.md,
  },
  row: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rowMain: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  rowPrimary: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  rowSecondary: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  rowDelete: {
    minWidth: 92,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  empty: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  emptyText: {
    color: theme.colors.textMuted,
  },
});
