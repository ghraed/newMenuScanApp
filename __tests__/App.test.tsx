/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
  NavigationContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../src/navigation/RootNavigator', () => ({
  RootNavigator: () => {
    const { View } = require('react-native');
    return <View testID="root-navigator" />;
  },
}));

import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
