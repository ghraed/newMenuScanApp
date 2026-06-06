import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
}));

import { ThemeProvider } from '../src/lib/theme-provider';
import { ObjectSelectionOverlay, buildCenteredBox } from '../src/components/ObjectSelectionOverlay';
import { AppButton } from '../src/components/AppButton';

async function renderOverlay(
  props: Partial<React.ComponentProps<typeof ObjectSelectionOverlay>> = {},
) {
  let instance: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    instance = ReactTestRenderer.create(
      <ThemeProvider>
        <ObjectSelectionOverlay onConfirm={jest.fn()} {...props} />
      </ThemeProvider>,
    );
  });

  if (!instance) {
    throw new Error('Failed to render overlay');
  }

  return instance;
}

function getAppButton(instance: ReactTestRenderer.ReactTestRenderer, title: string) {
  const button = instance.root
    .findAllByType(AppButton)
    .find(candidate => candidate.props.title === title);

  if (!button) {
    throw new Error(`AppButton "${title}" not found`);
  }

  return button;
}

function expectMissingByTestId(instance: ReactTestRenderer.ReactTestRenderer, testID: string) {
  expect(() => instance.root.findByProps({ testID })).toThrow();
}

describe('ObjectSelectionOverlay', () => {
  test('keeps sizing controls hidden while focus is still in progress', async () => {
    let resolveFocus: ((value: { success: true }) => void) | undefined;

    const instance = await renderOverlay({
      onFocusPoint: () =>
        new Promise(resolve => {
          resolveFocus = resolve;
        }),
    });

    ReactTestRenderer.act(() => {
      getAppButton(instance, 'Start Selection').props.onPress();
    });

    const touchLayer = instance.root.findByProps({ testID: 'object-selection-touch-layer' });

    ReactTestRenderer.act(() => {
      touchLayer.props.onLayout({
        nativeEvent: {
          layout: {
            width: 200,
            height: 100,
          },
        },
      });
    });

    let tapPromise: Promise<void>;
    ReactTestRenderer.act(() => {
      tapPromise = touchLayer.props.onPress({
        nativeEvent: {
          locationX: 100,
          locationY: 50,
        },
      });
    });

    expect(instance.root.findByProps({ children: 'Hold still for a moment while the camera focuses on the tapped point.' })).toBeTruthy();
    expectMissingByTestId(instance, 'selection-size-increase');

    resolveFocus?.({ success: true });
    await ReactTestRenderer.act(async () => {
      await tapPromise!;
    });
 
    expect(instance.root.findByProps({ testID: 'selection-size-increase' })).toBeTruthy();
  });

  test('first tap centers the initial box and confirm emits the expected selection', async () => {
    const onConfirm = jest.fn();
    const instance = await renderOverlay({
      onConfirm,
      onFocusPoint: async () => ({ success: true }),
    });

    ReactTestRenderer.act(() => {
      getAppButton(instance, 'Start Selection').props.onPress();
    });

    const touchLayer = instance.root.findByProps({ testID: 'object-selection-touch-layer' });

    ReactTestRenderer.act(() => {
      touchLayer.props.onLayout({
        nativeEvent: {
          layout: {
            width: 200,
            height: 100,
          },
        },
      });
    });

    await ReactTestRenderer.act(async () => {
      await touchLayer.props.onPress({
        nativeEvent: {
          locationX: 100,
          locationY: 50,
        },
      });
    });

    await ReactTestRenderer.act(async () => {
      getAppButton(instance, 'Confirm Object').props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      method: 'box',
      bbox: buildCenteredBox(0.5, 0.5, 0.26, 'dish'),
      point: {
        x: 0.5,
        y: 0.5,
      },
      viewportSize: {
        width: 200,
        height: 100,
      },
      selectedAt: expect.any(Number),
    });
  });

  test('reset returns the overlay to the pre-focus state', async () => {
    const instance = await renderOverlay({
      onFocusPoint: async () => ({ success: true }),
    });

    ReactTestRenderer.act(() => {
      getAppButton(instance, 'Start Selection').props.onPress();
    });

    const touchLayer = instance.root.findByProps({ testID: 'object-selection-touch-layer' });

    ReactTestRenderer.act(() => {
      touchLayer.props.onLayout({
        nativeEvent: {
          layout: {
            width: 200,
            height: 100,
          },
        },
      });
    });

    await ReactTestRenderer.act(async () => {
      await touchLayer.props.onPress({
        nativeEvent: {
          locationX: 80,
          locationY: 40,
        },
      });
    });

    await ReactTestRenderer.act(async () => {
      instance.root.findByProps({ testID: 'selection-reset-button' }).props.onPress();
    });

    expectMissingByTestId(instance, 'selection-size-increase');
    expect(instance.root.findByProps({ children: 'Tap the object to focus it first. After focus is set, you can size and confirm the guide.' })).toBeTruthy();
  });

  test('focus failure still unlocks manual guide adjustment', async () => {
    const instance = await renderOverlay({
      onFocusPoint: async () => ({
        success: false,
        message: 'Focus failed, but you can still adjust the guide manually.',
      }),
    });

    ReactTestRenderer.act(() => {
      getAppButton(instance, 'Start Selection').props.onPress();
    });

    const touchLayer = instance.root.findByProps({ testID: 'object-selection-touch-layer' });

    ReactTestRenderer.act(() => {
      touchLayer.props.onLayout({
        nativeEvent: {
          layout: {
            width: 240,
            height: 160,
          },
        },
      });
    });

    await ReactTestRenderer.act(async () => {
      await touchLayer.props.onPress({
        nativeEvent: {
          locationX: 120,
          locationY: 80,
        },
      });
    });

    expect(instance.root.findByProps({ children: 'Focus failed, but you can still adjust the guide manually.' })).toBeTruthy();
    expect(instance.root.findByProps({ testID: 'selection-size-decrease' })).toBeTruthy();
    expect(getAppButton(instance, 'Confirm Object')).toBeTruthy();
  });
});
