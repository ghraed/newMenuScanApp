import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../components/AppButton';
import { Screen } from '../components/Screen';
import {
  menuCopyDishModel,
  menuCreateDish,
  menuListDishes,
  menuPublishDish,
  MenuDish,
} from '../api/menuApi';
import { AppTheme, useAppTheme } from '../lib/theme';
import { getAuthUser } from '../storage/authStore';
import { getScanSession, upsertScanSession } from '../storage/scansStore';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateDish'>;

type StatusState =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

function dishHasReusableModel(dish: MenuDish) {
  return dish.assets.some(asset => asset.asset_type === 'glb');
}

function getDishModelPreviewUrl(dish: MenuDish) {
  return (
    dish.assets.find(asset => asset.asset_type === 'preview_image')?.file_url ??
    dish.image_url ??
    undefined
  );
}

function getDishModelFallbackLabel(dish: MenuDish) {
  const trimmedName = dish.name.trim();
  if (!trimmedName) {
    return '3D';
  }

  const initials = trimmedName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0] ?? '')
    .join('')
    .toUpperCase();

  if (initials) {
    return initials;
  }

  return trimmedName.slice(0, 2).toUpperCase() || '3D';
}

export function CreateDishScreen({ navigation, route }: Props) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scanId = route.params?.scanId;
  const [authUser, setAuthUser] = useState(() => getAuthUser());
  const [models, setModels] = useState<MenuDish[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusState, setStatusState] = useState<StatusState>({ kind: 'idle' });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>();

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;

      const loadContext = async () => {
        const nextAuthUser = getAuthUser();
        if (isActive) {
          setAuthUser(nextAuthUser);
        }

        if (!nextAuthUser?.restaurant) {
          if (isActive) {
            setModels([]);
          }
          return;
        }

        try {
          if (isActive) {
            setIsLoadingModels(true);
            setStatusState({ kind: 'idle' });
          }

          const dishes = await menuListDishes();
          if (!isActive) {
            return;
          }

          const reusableModels = dishes.filter(dishHasReusableModel);
          setModels(reusableModels);

          if (
            selectedModelId &&
            !reusableModels.some(dish => dish.id === selectedModelId)
          ) {
            setSelectedModelId(undefined);
          }
        } catch (error) {
          if (!isActive) {
            return;
          }

          setStatusState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not load reusable 3D models.',
          });
        } finally {
          if (isActive) {
            setIsLoadingModels(false);
          }
        }
      };

      loadContext().catch(() => undefined);

      return () => {
        isActive = false;
      };
    }, [authUser?.restaurant?.id]),
  );

  useEffect(() => {
    if (selectedModelId && !models.some(dish => dish.id === selectedModelId)) {
      setSelectedModelId(undefined);
    }
  }, [models, selectedModelId]);

  const selectedModel = useMemo(
    () => models.find(dish => dish.id === selectedModelId),
    [models, selectedModelId],
  );

  const onCreateDish = React.useCallback(async () => {
    if (!authUser?.restaurant) {
      setStatusState({
        kind: 'error',
        message: 'Log in from Home before creating a dish.',
      });
      return;
    }

    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const parsedPrice = Number.parseFloat(price);

    if (!trimmedName) {
      setStatusState({ kind: 'error', message: 'Enter a dish name.' });
      return;
    }

    if (!trimmedCategory) {
      setStatusState({ kind: 'error', message: 'Enter a category.' });
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setStatusState({ kind: 'error', message: 'Enter a valid price.' });
      return;
    }

    if (!selectedModel) {
      setStatusState({ kind: 'error', message: 'Choose an existing 3D model first.' });
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusState({ kind: 'idle' });

      const createdDish = await menuCreateDish({
        name: trimmedName,
        description: description.trim() || undefined,
        price: parsedPrice,
        category: trimmedCategory,
        status: 'draft',
      });

      await menuCopyDishModel(createdDish.id, selectedModel.id);
      const publishedDish = await menuPublishDish(createdDish.id);

      if (scanId) {
        const session = getScanSession(scanId);
        if (session) {
          await upsertScanSession({
            ...session,
            restaurantId: authUser.restaurant.id,
            dishId: publishedDish.id,
            dishName: publishedDish.name,
            modelSourceDishId: selectedModel.id,
            modelSourceDishName: selectedModel.name,
          });
        }
      }

      const successMessage = scanId
        ? `${publishedDish.name} is now published, visible to guests, and selected for this scan.`
        : `${publishedDish.name} is now published and visible to guests.`;

      setStatusState({ kind: 'success', message: successMessage });
      setModels(current => {
        const next = [publishedDish, ...current.filter(dish => dish.id !== publishedDish.id)];
        return next;
      });
      setName('');
      setDescription('');
      setPrice('');
      setCategory('');
      setSelectedModelId(undefined);

      Alert.alert(
        'Dish Ready',
        successMessage,
        [
          {
            text: scanId ? 'Back to Preview' : 'Done',
            onPress: () => {
              if (scanId) {
                navigation.goBack();
              }
            },
          },
        ],
      );
    } catch (error) {
      setStatusState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not create, assign, and publish the dish.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    authUser?.restaurant,
    category,
    description,
    name,
    navigation,
    price,
    scanId,
    selectedModel,
  ]);

  return (
    <Screen
      title="Create Dish"
      subtitle={
        scanId
          ? 'Create a brand-new dish, apply one of your existing ready 3D models, and send it back to the scan preview already guest-visible.'
          : 'Create a dish from scratch, assign an existing ready 3D model, and publish it so guests can see it right away.'
      }>
      {!authUser?.restaurant ? (
        <View style={styles.card}>
          <Text style={styles.label}>Login Required</Text>
          <Text style={styles.helper}>
            Sign in from Home with your restaurant account before creating dishes here.
          </Text>
          <AppButton title="Go Home" onPress={() => navigation.navigate('Home')} />
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>New Dish Details</Text>
            <Text style={styles.helper}>
              This flow creates the dish as draft, copies the selected existing 3D model, then publishes the final dish so it becomes guest-visible.
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Dish name"
              placeholderTextColor={theme.colors.textMuted}
              selectionColor={theme.colors.primary}
              style={styles.input}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={theme.colors.textMuted}
              selectionColor={theme.colors.primary}
              multiline
              style={[styles.input, styles.textArea]}
            />
            <View style={styles.inlineFields}>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="Price"
                placeholderTextColor={theme.colors.textMuted}
                selectionColor={theme.colors.primary}
                keyboardType="decimal-pad"
                style={[styles.input, styles.inlineInput]}
              />
              <TextInput
                value={category}
                onChangeText={setCategory}
                placeholder="Category"
                placeholderTextColor={theme.colors.textMuted}
                selectionColor={theme.colors.primary}
                style={[styles.input, styles.inlineInput]}
              />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Selected Existing 3D Model</Text>
            <Text style={styles.selectedModelName}>
              {selectedModel?.name ?? 'Choose a reusable model below.'}
            </Text>
            <Text style={styles.helper}>
              Only dishes that already have a ready GLB model appear here. Some older models do not have preview images yet, so the name card is used as a fallback.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Reusable Models</Text>
            {isLoadingModels ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : models.length === 0 ? (
              <Text style={styles.helper}>
                No reusable 3D models are ready yet. Generate one first, then it will appear here.
              </Text>
            ) : (
              <View style={styles.modelList}>
                {models.map(dish => {
                  const previewUrl = getDishModelPreviewUrl(dish);
                  const isSelected = dish.id === selectedModelId;

                  return (
                    <Pressable
                      key={dish.id}
                      style={[styles.modelRow, isSelected && styles.modelRowSelected]}
                      onPress={() => setSelectedModelId(dish.id)}>
                      <View style={styles.modelPreviewFrame}>
                        {previewUrl ? (
                          <Image source={{ uri: previewUrl }} style={styles.modelPreviewImage} resizeMode="cover" />
                        ) : (
                          <View style={styles.modelPreviewFallback}>
                            <Text style={styles.modelPreviewFallbackText}>
                              {getDishModelFallbackLabel(dish)}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.modelCopy}>
                        <Text style={styles.modelTitle}>{dish.name}</Text>
                        <Text style={styles.modelMeta}>
                          {dish.category} • ${dish.price.toFixed(2)} • {dish.status}
                        </Text>
                        <Text style={styles.modelMeta}>
                          {previewUrl ? 'Preview image available' : 'No preview image uploaded yet'}
                        </Text>
                      </View>
                      <Text style={styles.modelTag}>{isSelected ? 'Selected' : 'Use'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <AppButton
              title={isSubmitting ? 'Creating & Publishing...' : 'Create and Publish Dish'}
              onPress={() => {
                onCreateDish().catch(() => undefined);
              }}
              disabled={isSubmitting}
            />
            {scanId ? (
              <AppButton
                title="Back to Preview"
                variant="secondary"
                onPress={() => navigation.goBack()}
                disabled={isSubmitting}
              />
            ) : null}
          </View>
        </>
      )}

      {statusState.kind !== 'idle' ? (
        <Text
          style={[
            styles.statusText,
            statusState.kind === 'success' ? styles.statusSuccess : styles.statusError,
          ]}>
          {statusState.message}
        </Text>
      ) : null}
    </Screen>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
      ...theme.shadows.card,
    },
    label: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    helper: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    input: {
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceAlt,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      fontFamily: theme.typography.body.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.body.fontWeight,
      letterSpacing: theme.typography.body.letterSpacing,
    },
    textArea: {
      minHeight: 92,
      textAlignVertical: 'top',
    },
    inlineFields: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    inlineInput: {
      flex: 1,
    },
    selectedModelName: {
      color: theme.colors.text,
      fontFamily: theme.typography.title.fontFamily,
      fontSize: theme.typography.title.fontSize,
      lineHeight: theme.typography.title.lineHeight,
      fontWeight: theme.typography.title.fontWeight,
      letterSpacing: theme.typography.title.letterSpacing,
    },
    modelList: {
      gap: theme.spacing.sm,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.surfaceAlt,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      padding: theme.spacing.md,
    },
    modelRowSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primarySoft,
    },
    modelPreviewFrame: {
      width: 76,
      height: 76,
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.borderSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modelPreviewImage: {
      width: '100%',
      height: '100%',
    },
    modelPreviewFallback: {
      flex: 1,
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primarySoft,
    },
    modelPreviewFallbackText: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
    },
    modelCopy: {
      flex: 1,
      gap: theme.spacing.xxs,
    },
    modelTitle: {
      color: theme.colors.text,
      fontFamily: theme.typography.sectionTitle.fontFamily,
      fontSize: theme.typography.sectionTitle.fontSize,
      lineHeight: theme.typography.sectionTitle.lineHeight,
      fontWeight: theme.typography.sectionTitle.fontWeight,
      letterSpacing: theme.typography.sectionTitle.letterSpacing,
    },
    modelMeta: {
      color: theme.colors.textMuted,
      fontFamily: theme.typography.bodySmall.fontFamily,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      fontWeight: theme.typography.bodySmall.fontWeight,
      letterSpacing: theme.typography.bodySmall.letterSpacing,
    },
    modelTag: {
      color: theme.colors.primary,
      fontFamily: theme.typography.label.fontFamily,
      fontSize: theme.typography.label.fontSize,
      lineHeight: theme.typography.label.lineHeight,
      fontWeight: theme.typography.label.fontWeight,
      letterSpacing: theme.typography.label.letterSpacing,
      textTransform: theme.typography.label.textTransform,
    },
    actions: {
      gap: theme.spacing.md,
    },
    statusText: {
      fontFamily: theme.typography.body.fontFamily,
      fontSize: theme.typography.body.fontSize,
      lineHeight: theme.typography.body.lineHeight,
      fontWeight: theme.typography.body.fontWeight,
      letterSpacing: theme.typography.body.letterSpacing,
    },
    statusSuccess: {
      color: theme.colors.success,
    },
    statusError: {
      color: theme.colors.danger,
    },
  });
}
