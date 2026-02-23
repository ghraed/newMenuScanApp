import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { MyScansScreen } from '../screens/MyScansScreen';
import { PreviewScreen } from '../screens/PreviewScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { theme } from '../lib/theme';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: theme.colors.background },
      }}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Menu App Scanner' }} />
      <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Setup Scan' }} />
      <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan' }} />
      <Stack.Screen name="Preview" component={PreviewScreen} options={{ title: 'Preview' }} />
      <Stack.Screen name="MyScans" component={MyScansScreen} options={{ title: 'My Scans' }} />
    </Stack.Navigator>
  );
}
