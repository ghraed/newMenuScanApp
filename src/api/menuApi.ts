import axios, { InternalAxiosRequestConfig } from 'axios';
import { z } from 'zod';
import { getMenuApiBaseUrl, getMenuApiUrl } from './config';
import { parseApiResponse, toApiError } from './client';
import { getAuthToken } from '../storage/authStore';

const restaurantSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
});

const authUserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  email: z.string().email(),
  restaurant: restaurantSchema.nullable(),
});

const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
});

const meResponseSchema = z.object({
  user: authUserSchema,
});

const dishAssetSchema = z.object({
  id: z.number().int().positive(),
  asset_type: z.union([
    z.literal('glb'),
    z.literal('usdz'),
    z.literal('preview_image'),
  ]),
  file_url: z.string().optional().nullable(),
});

const dishLatestScanSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
}).nullable().optional();

const dishSchema = z.object({
  id: z.number().int().positive(),
  uuid: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  price: z.union([z.number(), z.string()]),
  category: z.string(),
  status: z.union([z.literal('draft'), z.literal('published')]),
  image_url: z.string().nullable().optional(),
  model_state: z
    .union([
      z.literal('none'),
      z.literal('processing'),
      z.literal('ready'),
      z.literal('error'),
    ])
    .optional(),
  is_model_ready: z.boolean().optional(),
  latest_scan: dishLatestScanSchema,
  assets: z.array(dishAssetSchema).default([]),
});

const dishesPageSchema = z.object({
  data: z.array(dishSchema),
  current_page: z.number().int().positive(),
  last_page: z.number().int().positive(),
});

type MenuDishSchema = z.infer<typeof dishSchema>;

const menuApiClient = axios.create({
  timeout: 20000,
});

menuApiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  config.baseURL = getMenuApiUrl();

  const token = getAuthToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export type MenuAuthUser = z.infer<typeof authUserSchema>;
export type MenuLoginResponse = z.infer<typeof loginResponseSchema>;
export type MenuDish = Omit<MenuDishSchema, 'price' | 'assets' | 'latest_scan'> & {
  price: number;
  assets: NonNullable<MenuDishSchema['assets']>;
  latestScan?: z.infer<typeof dishLatestScanSchema>;
};
export type MenuCreateDishInput = {
  name: string;
  description?: string;
  price: number;
  category: string;
  status: 'draft' | 'published';
};

function getFileNameFromPath(path: string, fallback: string) {
  const normalized = path.replace(/^file:\/\//, '');
  const parts = normalized.split('/');
  const candidate = parts[parts.length - 1];
  return candidate && candidate.trim().length > 0 ? candidate : fallback;
}

function getMimeTypeFromPath(path: string) {
  const normalized = path.toLowerCase();

  if (normalized.endsWith('.png')) {
    return 'image/png';
  }

  if (normalized.endsWith('.webp')) {
    return 'image/webp';
  }

  if (normalized.endsWith('.heic')) {
    return 'image/heic';
  }

  if (normalized.endsWith('.heif')) {
    return 'image/heif';
  }

  return 'image/jpeg';
}

export function resolveMenuAssetUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  const baseUrl = getMenuApiBaseUrl();

  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      const parsedAssetUrl = new URL(rawUrl);
      const parsedBaseUrl = new URL(baseUrl);

      if (parsedAssetUrl.hostname === parsedBaseUrl.hostname) {
        return `${parsedBaseUrl.origin}${parsedAssetUrl.pathname}${parsedAssetUrl.search}${parsedAssetUrl.hash}`;
      }
    } catch {
      return rawUrl;
    }

    return rawUrl;
  }

  const normalizedPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
  return `${baseUrl}${normalizedPath}`;
}

function normalizeDish(dish: MenuDishSchema): MenuDish {
  const { latest_scan, ...rest } = dish;

  return {
    ...rest,
    description: dish.description ?? undefined,
    image_url: dish.image_url ?? undefined,
    latestScan: latest_scan ?? undefined,
    assets: (dish.assets ?? []).map(asset => ({
      ...asset,
      file_url: resolveMenuAssetUrl(asset.file_url) ?? asset.file_url,
    })),
    price:
      typeof dish.price === 'number'
        ? dish.price
        : Number.parseFloat(dish.price),
  };
}

export async function menuLogin(email: string, password: string): Promise<MenuLoginResponse> {
  try {
    const response = await menuApiClient.post('/auth/login', {
      email,
      password,
    });

    return parseApiResponse(loginResponseSchema, response.data, 'menuLogin');
  } catch (error) {
    throw toApiError(error, 'Failed to log in');
  }
}

export async function menuMe(): Promise<MenuAuthUser> {
  try {
    const response = await menuApiClient.get('/auth/me');
    return parseApiResponse(meResponseSchema, response.data, 'menuMe').user;
  } catch (error) {
    throw toApiError(error, 'Failed to load restaurant account');
  }
}

export async function menuLogout(): Promise<void> {
  try {
    await menuApiClient.post('/auth/logout');
  } catch (error) {
    throw toApiError(error, 'Failed to log out');
  }
}

export async function menuListDishes(): Promise<MenuDish[]> {
  try {
    const dishes: MenuDish[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const response = await menuApiClient.get('/dishes', {
        params: {
          include_deleted: 0,
          page,
        },
      });

      const parsed = dishesPageSchema.parse(response.data);
      dishes.push(...parsed.data.map(normalizeDish));
      page = parsed.current_page + 1;
      lastPage = parsed.last_page;
    } while (page <= lastPage);

    return dishes;
  } catch (error) {
    throw toApiError(error, 'Failed to load dishes');
  }
}

export async function menuGetDish(dishId: number): Promise<MenuDish> {
  try {
    const response = await menuApiClient.get(`/dishes/${dishId}`);
    return normalizeDish(dishSchema.parse(response.data));
  } catch (error) {
    throw toApiError(error, 'Failed to load dish');
  }
}

export async function menuCreateDish(input: MenuCreateDishInput): Promise<MenuDish> {
  try {
    const response = await menuApiClient.post('/dishes', {
      name: input.name,
      description: input.description?.trim() || null,
      price: input.price,
      category: input.category,
      status: input.status,
    });

    return normalizeDish(dishSchema.parse(response.data));
  } catch (error) {
    throw toApiError(error, 'Failed to create dish');
  }
}

export async function menuCopyDishModel(
  targetDishId: number,
  sourceDishId: number,
): Promise<MenuDish> {
  try {
    const response = await menuApiClient.post(`/dishes/${targetDishId}/copy-model`, {
      source_dish_id: sourceDishId,
    });

    return normalizeDish(dishSchema.parse(response.data));
  } catch (error) {
    throw toApiError(error, 'Failed to copy existing 3D model');
  }
}

export async function menuPublishDish(dishId: number): Promise<MenuDish> {
  try {
    const response = await menuApiClient.patch(`/dishes/${dishId}/publish`);
    return normalizeDish(dishSchema.parse(response.data));
  } catch (error) {
    throw toApiError(error, 'Failed to publish dish');
  }
}

export async function menuUploadDishPreviewImage(
  dishId: number,
  filePath: string,
): Promise<void> {
  try {
    const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
    const formData = new FormData();
    formData.append('type', 'preview_image');
    formData.append('file', {
      uri,
      name: getFileNameFromPath(filePath, 'preview.jpg'),
      type: getMimeTypeFromPath(filePath),
    } as never);

    await menuApiClient.post(`/dishes/${dishId}/assets`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  } catch (error) {
    throw toApiError(error, 'Failed to upload preview image');
  }
}
