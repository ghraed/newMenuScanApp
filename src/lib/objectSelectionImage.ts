import RNFS from 'react-native-fs';
import { Image, NativeModules } from 'react-native';
import { ObjectSelection } from '../types/scanSession';

type ImageSize = {
  width: number;
  height: number;
};

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ImageEditingManager = {
  cropImage: (
    uri: string,
    cropData: {
      offset: { x: number; y: number };
      size: { width: number; height: number };
      allowExternalStorage?: boolean;
    },
    successCallback: (uri: string) => void,
    errorCallback: (error: string) => void,
  ) => void;
};

type ObjectSelectionCropModule = {
  cropToFile: (
    sourcePath: string,
    outputPath: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<string>;
};

const imageEditingManager = NativeModules.ImageEditingManager as ImageEditingManager | undefined;
const objectSelectionCropModule = NativeModules.ObjectSelectionCropModule as
  | ObjectSelectionCropModule
  | undefined;
const SELECTION_CROP_PADDING_RATIO = 0.08;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toFileUri(pathOrUri: string) {
  return pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`;
}

function toFsPath(pathOrUri: string) {
  return pathOrUri.startsWith('file://') ? pathOrUri.replace('file://', '') : pathOrUri;
}

function getImageSize(uri: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      error => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function getSelectionCropRect(selection: ObjectSelection, imageSize: ImageSize): CropRect {
  const { bbox, viewportSize } = selection;

  let left = bbox.x * imageSize.width;
  let top = bbox.y * imageSize.height;
  let width = bbox.width * imageSize.width;
  let height = bbox.height * imageSize.height;

  if (viewportSize?.width && viewportSize?.height) {
    const scale = Math.max(
      viewportSize.width / imageSize.width,
      viewportSize.height / imageSize.height,
    );
    const displayedWidth = imageSize.width * scale;
    const displayedHeight = imageSize.height * scale;
    const offsetX = Math.max(0, (displayedWidth - viewportSize.width) / 2);
    const offsetY = Math.max(0, (displayedHeight - viewportSize.height) / 2);

    left = (bbox.x * viewportSize.width + offsetX) / scale;
    top = (bbox.y * viewportSize.height + offsetY) / scale;
    width = (bbox.width * viewportSize.width) / scale;
    height = (bbox.height * viewportSize.height) / scale;
  }

  const padding = Math.max(width, height) * SELECTION_CROP_PADDING_RATIO;
  const x1 = clamp(Math.floor(left - padding), 0, Math.max(0, imageSize.width - 1));
  const y1 = clamp(Math.floor(top - padding), 0, Math.max(0, imageSize.height - 1));
  const x2 = clamp(Math.ceil(left + width + padding), x1 + 1, imageSize.width);
  const y2 = clamp(Math.ceil(top + height + padding), y1 + 1, imageSize.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

async function cropImageUriToSelection(
  sourceUri: string,
  selection: ObjectSelection,
): Promise<string> {
  if (!imageEditingManager?.cropImage) {
    return sourceUri;
  }

  const imageSize = await getImageSize(sourceUri);
  const cropRect = getSelectionCropRect(selection, imageSize);

  return new Promise((resolve, reject) => {
    imageEditingManager.cropImage(
      sourceUri,
      {
        offset: { x: cropRect.x, y: cropRect.y },
        size: { width: cropRect.width, height: cropRect.height },
        allowExternalStorage: true,
      },
      resolve,
      error => reject(new Error(error)),
    );
  });
}

function getOutputExtension(sourcePath: string) {
  const normalized = sourcePath.toLowerCase();
  return normalized.endsWith('.png') ? '.png' : '.jpg';
}

function getFileName(sourcePath: string) {
  const normalizedPath = toFsPath(sourcePath);
  const parts = normalizedPath.split('/');
  return parts[parts.length - 1] || `selection-crop${getOutputExtension(sourcePath)}`;
}

async function cropFileToOutput(
  sourcePath: string,
  outputPath: string,
  selection: ObjectSelection,
): Promise<string> {
  const sourceUri = toFileUri(sourcePath);
  const imageSize = await getImageSize(sourceUri);
  const cropRect = getSelectionCropRect(selection, imageSize);

  if (objectSelectionCropModule?.cropToFile) {
    return objectSelectionCropModule.cropToFile(
      toFsPath(sourcePath),
      outputPath,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
    );
  }

  const croppedUri = await cropImageUriToSelection(sourceUri, selection);
  const croppedPath = toFsPath(croppedUri);
  await RNFS.copyFile(croppedPath, outputPath);
  return toFileUri(outputPath);
}

export async function getSelectionUploadUri(
  sourcePath: string,
  selection?: ObjectSelection,
): Promise<string> {
  const sourceUri = toFileUri(sourcePath);

  if (!selection) {
    return sourceUri;
  }

  try {
    const cropsDir = `${RNFS.CachesDirectoryPath}/selection-crops`;
    await RNFS.mkdir(cropsDir);

    const outputPath = `${cropsDir}/${Date.now()}-${getFileName(sourcePath)}`;
    return await cropFileToOutput(sourceUri, outputPath, selection);
  } catch {
    return sourceUri;
  }
}

export async function cropFileToSelectionInPlace(
  filePath: string,
  selection?: ObjectSelection,
): Promise<string> {
  if (!selection) {
    return filePath;
  }

  try {
    const swapPath = `${filePath}.swap`;
    const swapExists = await RNFS.exists(swapPath);
    if (swapExists) {
      await RNFS.unlink(swapPath);
    }

    await cropFileToOutput(filePath, swapPath, selection);

    const targetExists = await RNFS.exists(filePath);
    if (targetExists) {
      await RNFS.unlink(filePath);
    }

    await RNFS.moveFile(swapPath, filePath);
    return filePath;
  } catch {
    return filePath;
  }
}
