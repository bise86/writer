import React, {useEffect, useRef, useState} from 'react';
import {Alert, PermissionsAndroid, Platform} from 'react-native';
import {
  Asset,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import ImageCropper from './ImageCropper';
import {cropImage, discardPreparedImages, persistImage} from './images';
import {PreparedImage} from './types';

interface ImportSession {
  cancelled: boolean;
  prepared: PreparedImage[];
  cancelCrop?: () => void;
  cancelContinue?: () => void;
}
interface CropTask {
  session: ImportSession;
  asset: Asset;
  pageLabel: string;
  resolve: (uri?: string) => void;
}

/** Shared camera/gallery import. Successful results transfer ownership to the
 * caller: retain committed images or release them with discardPreparedImages.
 * Cancellation and unmount clean only the in-progress session. */
export function useImageImport() {
  const [cropTask, setCropTask] = useState<CropTask>();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const sessionRef = useRef<ImportSession>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = sessionRef.current;
      if (session) {
        session.cancelled = true;
        session.cancelCrop?.();
        session.cancelContinue?.();
      }
    };
  }, []);
  const current = (session: ImportSession) =>
    mounted.current && sessionRef.current === session && !session.cancelled;
  const prepare = (session: ImportSession, asset: Asset, pageLabel: string) => {
    if (!asset.uri) {
      throw new Error('未读取到所选图片，请重新选择或拍摄');
    }
    return new Promise<string | undefined>(resolve => {
      session.cancelCrop = () => resolve(undefined);
      setCropTask({session, asset, pageLabel, resolve});
    });
  };
  const askContinue = (session: ImportSession) =>
    new Promise<boolean>(resolve => {
      const finish = (value: boolean) => {
        session.cancelContinue = undefined;
        resolve(value && current(session));
      };
      session.cancelContinue = () => finish(false);
      Alert.alert(
        '照片已加入',
        '还要继续拍摄下一页吗？',
        [
          {text: '完成', onPress: () => finish(false)},
          {text: '继续拍摄', onPress: () => finish(true)},
        ],
        {cancelable: true, onDismiss: () => finish(false)},
      );
    });
  const pickImages = async (
    camera: boolean,
    options: {permissionMessage?: string; maxCount?: number} = {},
  ): Promise<PreparedImage[] | undefined> => {
    if (sessionRef.current || !mounted.current) {
      return undefined;
    }
    const session: ImportSession = {cancelled: false, prepared: []};
    sessionRef.current = session;
    setBusy(true);
    let transferred = false;
    const limit = options.maxCount ?? Infinity;
    try {
      if (limit < 1) {
        throw new Error('已达到可添加图片数量上限');
      }
      if (camera && Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: '相机权限',
            message: options.permissionMessage || '需要使用相机拍摄图片。',
            buttonPositive: '允许',
            buttonNegative: '拒绝',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error('相机权限未授权，请在系统设置中允许相机权限。');
        }
      }
      if (!current(session)) {
        return undefined;
      }
      if (camera) {
        while (current(session)) {
          const result = await launchCamera({
            mediaType: 'photo',
            cameraType: 'back',
            includeBase64: false,
            quality: 1,
            saveToPhotos: false,
          });
          if (!current(session)) {
            return undefined;
          }
          if (result.errorCode) {
            throw new Error(
              result.errorMessage || `相机错误：${result.errorCode}`,
            );
          }
          if (result.didCancel || !result.assets?.length) {
            break;
          }
          const asset = result.assets[0];
          const uri = await prepare(
            session,
            asset,
            `第 ${session.prepared.length + 1} 张`,
          );
          if (!uri || !current(session)) {
            return undefined;
          }
          session.prepared.push({
            uri,
            name: asset.fileName || `照片 ${session.prepared.length + 1}`,
          });
          if (
            session.prepared.length >= limit ||
            !(await askContinue(session))
          ) {
            break;
          }
        }
      } else {
        const result = await launchImageLibrary({
          mediaType: 'photo',
          includeBase64: false,
          quality: 1,
          selectionLimit: 0,
          assetRepresentationMode: 'compatible',
        });
        if (!current(session)) {
          return undefined;
        }
        if (result.errorCode) {
          throw new Error(
            result.errorMessage || `图片选择错误：${result.errorCode}`,
          );
        }
        if (result.didCancel) {
          return undefined;
        }
        const assets = result.assets || [];
        if (assets.length > limit) {
          throw new Error(`最多还能添加 ${limit} 张图片，请重新选择`);
        }
        for (const [index, asset] of assets.entries()) {
          const uri = await prepare(
            session,
            asset,
            `${index + 1} / ${assets.length}`,
          );
          if (!uri || !current(session)) {
            return undefined;
          }
          session.prepared.push({
            uri,
            name: asset.fileName || `照片 ${index + 1}`,
          });
        }
      }
      if (!current(session) || !session.prepared.length) {
        return undefined;
      }
      transferred = true;
      return [...session.prepared];
    } finally {
      if (!transferred) {
        await discardPreparedImages(session.prepared.map(image => image.uri));
      }
      if (sessionRef.current === session) {
        sessionRef.current = undefined;
        if (mounted.current) {
          setCropTask(undefined);
          setBusy(false);
        }
      }
    }
  };
  const cropper = cropTask ? (
    <ImageCropper
      key={`${cropTask.pageLabel}-${cropTask.asset.uri}`}
      uri={cropTask.asset.uri!}
      pageLabel={cropTask.pageLabel}
      onCancel={() => {
        cropTask.session.cancelled = true;
        setCropTask(undefined);
        cropTask.resolve();
      }}
      onSubmit={async choice => {
        if (!current(cropTask.session)) {
          return;
        }
        const uri =
          choice.kind === 'original'
            ? await persistImage(cropTask.asset.uri!, cropTask.asset)
            : await cropImage(cropTask.asset.uri!, choice.source, choice.rect);
        if (!current(cropTask.session)) {
          await discardPreparedImages([uri]);
          return;
        }
        cropTask.session.cancelCrop = undefined;
        setCropTask(undefined);
        cropTask.resolve(uri);
      }}
    />
  ) : undefined;
  return {pickImages, cropper, busy};
}
