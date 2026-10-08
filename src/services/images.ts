import ImageEditor from '@react-native-community/image-editor';
import {Platform} from 'react-native';
import RNFS from 'react-native-fs';
import type {Asset} from 'react-native-image-picker';

export type CropPreset = 'square' | 'landscape';

function pathFromUri(uri: string) {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

function extension(uri: string) {
  const match = uri.split('?')[0].match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() === 'png' ? 'png' : 'jpg';
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
  } catch (_) {
    // Some Android providers expose a content URI that cannot be copied by RNFS.
    // Keep it; the picker grants the app read access for the current workflow.
    return uri;
  }
}

export async function cropImage(uri: string, asset: Asset, preset: CropPreset) {
  const width = Math.max(1, Math.round(asset.width || 0));
  const height = Math.max(1, Math.round(asset.height || 0));
  if (!asset.width || !asset.height) {
    return persistImage(uri, asset);
  }
  const ratio = preset === 'square' ? 1 : 4 / 3;
  let cropWidth = width;
  let cropHeight = Math.round(cropWidth / ratio);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.round(cropHeight * ratio);
  }
  const scale = Math.min(1, 3200 / Math.max(cropWidth, cropHeight));
  const result = await ImageEditor.cropImage(uri, {
    offset: {
      x: Math.floor((width - cropWidth) / 2),
      y: Math.floor((height - cropHeight) / 2),
    },
    size: {width: cropWidth, height: cropHeight},
    displaySize: {
      width: Math.round(cropWidth * scale),
      height: Math.round(cropHeight * scale),
    },
    quality: 1,
    format: 'jpeg',
  });
  return persistImage(result.uri);
}
