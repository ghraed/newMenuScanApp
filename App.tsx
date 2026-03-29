import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ThemeProvider, useAppTheme } from './src/lib/theme';

function AppShell() {
  const { theme } = useAppTheme();

  return (
    <NavigationContainer theme={theme.navigationTheme}>
      <StatusBar barStyle={theme.statusBarStyle} backgroundColor={theme.colors.background} />
      <RootNavigator />
    </NavigationContainer>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
