import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import { useScans } from '../hooks/useScans';
import { theme } from '../lib/theme';
import { deleteScan } from '../storage/scanStore';
import { RootStackParamList } from '../types/navigation';
import { ScanSession } from '../types/scan';

type Props = NativeStackScreenProps<RootStackParamList, 'MyScans'>;

export function MyScansScreen({ navigation }: Props) {
  const scans = useScans();

  const renderItem = ({ item }: { item: ScanSession }) => (
    <View style={styles.card}>
      <Pressable onPress={() => navigation.navigate('Preview', { scanId: item.id })} style={styles.cardMain}>
        <Text style={styles.cardTitle}>Scan {item.id.slice(-6)}</Text>
        <Text style={styles.cardMeta}>
          {item.captures.length} captures • {item.dishSizeMeters.toFixed(2)}m • {item.status.replace('_', ' ')}
        </Text>
        <Text style={styles.cardMeta}>Updated {new Date(item.updatedAt).toLocaleString()}</Text>
      </Pressable>
      <AppButton
        title="Delete"
        variant="danger"
        style={styles.deleteButton}
        onPress={() => deleteScan(item.id)}
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
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: theme.spacing.xxl,
  },
  separator: {
    height: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  cardMain: {
    gap: theme.spacing.xs,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    minWidth: 110,
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
