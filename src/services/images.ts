import ImageEditor from '@react-native-community/image-editor';
import {Platform} from 'react-native';
import RNFS from 'react-native-fs';
import type {Asset} from 'react-native-image-picker';
import {Rect, Size} from './image-geometry';

function pathFromUri(uri: string) {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

function extension(uri: string) {
  const match = uri.split('?')[0].match(/\.([a-z0-9]+)$/i);
  const format = match?.[1]?.toLowerCase();
  return format === 'png' || format === 'webp' ? format : 'jpg';
}

async function persistentDirectory() {
  const directory = `${RNFS.DocumentDirectoryPath}/essay-images`;
  await RNFS.mkdir(directory);
  return directory;
}

export async function persistImage(uri: string, asset?: Asset) {
  if (!uri || uri.startsWith('data:') || uri.startsWith('http')) {
    return uri;
  }
  const directory = await persistentDirectory();
  const target = `${directory}/image_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${extension(uri)}`;
  try {
    if (Platform.OS === 'ios' && uri.startsWith('ph://')) {
      await RNFS.copyAssetsFileIOS(
        uri,
        target,
        asset?.width || 2400,
        asset?.height || 2400,
        1,
        1,
        'contain',
      );
    } else {
      const source = uri;
      await RNFS.copyFile(pathFromUri(source), target);
    }
    return `file://${target}`;
  } catch (error) {
    await RNFS.unlink(target).catch(() => undefined);
    // A temporary picker grant is not durable storage. Keep the editor open
    // so the user can retry instead of saving an essay with a broken image.
    throw new Error(
      `无法保存图片到本机：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function cropImage(uri: string, source: Size, rect: Rect) {
  if (
    ![
      source.width,
      source.height,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    ].every(Number.isFinite) ||
    source.width <= 0 ||
    source.height <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x + rect.width > source.width ||
    rect.y + rect.height > source.height
  ) {
    throw new Error('裁剪范围超出图片，请重新调整裁剪框');
  }
  const cropWidth = Math.round(rect.width);
  const cropHeight = Math.round(rect.height);
  const scale = Math.min(1, 3200 / Math.max(cropWidth, cropHeight));
  const result = await ImageEditor.cropImage(uri, {
    offset: {x: Math.round(rect.x), y: Math.round(rect.y)},
    size: {width: cropWidth, height: cropHeight},
    displaySize: {
      width: Math.round(cropWidth * scale),
      height: Math.round(cropHeight * scale),
    },
    quality: 1,
    format: 'jpeg',
  });
  // Harmony's compatible native module returns a URI string; iOS/Android
  // return a CropResult object.
  const outputUri = typeof result === 'string' ? result : result.uri;
  if (!outputUri) {
    throw new Error('裁剪未返回有效图片');
  }
  return persistImage(outputUri);
}

export async function discardPreparedImages(uris: string[]) {
  const prefix = `${RNFS.DocumentDirectoryPath}/essay-images/`;
  await Promise.all(
    uris.map(async uri => {
      const path = pathFromUri(uri);
      if (path.startsWith(prefix)) {
        await RNFS.unlink(path).catch(() => undefined);
      }
    }),
  );
}
