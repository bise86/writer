import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  containRect,
  cropPixels,
  CropHandle,
  moveCrop,
  Rect,
  Size,
} from '../services/image-geometry';

export type CropChoice =
  | {kind: 'original'}
  | {kind: 'crop'; source: Size; rect: Rect};
const fullImage: Rect = {x: 0, y: 0, width: 1, height: 1};
const corners = ['nw', 'ne', 'sw', 'se'] as const;

export default function ImageCropper({
  uri,
  pageLabel,
  onSubmit,
  onCancel,
}: {
  uri: string;
  pageLabel: string;
  onSubmit: (choice: CropChoice) => Promise<void>;
  onCancel: () => void;
}) {
  const [source, setSource] = useState<Size>();
  const [viewport, setViewport] = useState<Size>({width: 0, height: 0});
  const [selection, setSelection] = useState(fullImage);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const fitted =
    source && viewport.width && viewport.height
      ? containRect(source, {
          width: Math.max(1, viewport.width - 40),
          height: Math.max(1, viewport.height - 40),
        })
      : undefined;
  const bounds = fitted
    ? {...fitted, x: fitted.x + 20, y: fitted.y + 20}
    : undefined;
  const rect = bounds
    ? {
        x: selection.x * bounds.width,
        y: selection.y * bounds.height,
        width: selection.width * bounds.width,
        height: selection.height * bounds.height,
      }
    : undefined;
  const latest = useRef({bounds, rect, loaded});
  latest.current = {bounds, rect, loaded};
  const drag = useRef<{rect: Rect; handle: CropHandle}>();
  useEffect(() => {
    let active = true;
    setLoadError(false);
    setLoaded(false);
    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) {
          setSource({width, height});
        } else if (active) {
          setLoadError(true);
        }
      },
      () => {
        if (active) {
          setLoadError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [uri, attempt]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!saving.current) {
        onCancel();
      }
      return true;
    });
    return () => listener.remove();
  }, [onCancel]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          latest.current.loaded && !saving.current,
        onMoveShouldSetPanResponder: () =>
          latest.current.loaded && !saving.current,
        onPanResponderGrant: event => {
          const {rect: value, bounds: image} = latest.current;
          if (!value || !image || saving.current) {
            return;
          }
          const x = event.nativeEvent.locationX - image.x;
          const y = event.nativeEvent.locationY - image.y;
          const corner = corners
            .map(handle => ({
              handle,
              distance: Math.hypot(
                x - (value.x + (handle.includes('e') ? value.width : 0)),
                y - (value.y + (handle.includes('s') ? value.height : 0)),
              ),
            }))
            .sort((a, b) => a.distance - b.distance)[0];
          if (corner.distance <= 32) {
            drag.current = {rect: value, handle: corner.handle};
          } else if (
            x >= value.x &&
            x <= value.x + value.width &&
            y >= value.y &&
            y <= value.y + value.height
          ) {
            drag.current = {rect: value, handle: 'move'};
          }
        },
        onPanResponderMove: (event, state) => {
          const image = latest.current.bounds;
          if (
            !drag.current ||
            !image ||
            saving.current ||
            event.nativeEvent.touches.length !== 1
          ) {
            return;
          }
          const next = moveCrop(
            drag.current.rect,
            drag.current.handle,
            state.dx,
            state.dy,
            image,
          );
          setSelection({
            x: next.x / image.width,
            y: next.y / image.height,
            width: next.width / image.width,
            height: next.height / image.height,
          });
        },
        onPanResponderRelease: () => {
          drag.current = undefined;
        },
        onPanResponderTerminate: () => {
          drag.current = undefined;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );
  const submit = async (original: boolean) => {
    if (
      saving.current ||
      (!original && (!source || !bounds || !rect || !loaded))
    ) {
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit(
        original
          ? {kind: 'original'}
          : {
              kind: 'crop',
              source: source!,
              rect: cropPixels(rect!, bounds!, source!),
            },
      );
    } catch (failure) {
      setError(
        `图片保存失败：${
          failure instanceof Error ? failure.message : String(failure)
        }。可以重试，或选择原图。`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCancel}
          style={styles.action}>
          <Text style={styles.text}>取消</Text>
        </Pressable>
        <Text style={styles.text}>裁剪图片 · {pageLabel}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setSelection(fullImage)}
          style={styles.action}>
          <Text style={styles.text}>重置</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>拖动四角调整范围，拖动框内移动选区</Text>
      <View
        style={styles.stage}
        onLayout={event => setViewport(event.nativeEvent.layout)}
        testID="crop-viewport">
        {bounds && rect && !loadError && (
          <View
            style={StyleSheet.absoluteFill}
            testID="crop-surface"
            {...responder.panHandlers}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image
                key={attempt}
                source={{uri}}
                resizeMode="contain"
                onLoad={() => setLoaded(true)}
                onError={() => {
                  setLoadError(true);
                  setLoaded(false);
                }}
                style={[
                  styles.positioned,
                  {
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.positioned,
                  {
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  },
                ]}>
                <View
                  style={[
                    styles.mask,
                    styles.topLeft,
                    {width: bounds.width, height: rect.y},
                  ]}
                />
                <View
                  style={[
                    styles.mask,
                    styles.maskLeft,
                    {
                      top: rect.y + rect.height,
                      width: bounds.width,
                      height: Math.max(0, bounds.height - rect.y - rect.height),
                    },
                  ]}
                />
                <View
                  style={[
                    styles.mask,
                    styles.maskLeft,
                    {top: rect.y, width: rect.x, height: rect.height},
                  ]}
                />
                <View
                  style={[
                    styles.mask,
                    {
                      left: rect.x + rect.width,
                      top: rect.y,
                      width: Math.max(0, bounds.width - rect.x - rect.width),
                      height: rect.height,
                    },
                  ]}
                />
                <View
                  testID="crop-frame"
                  style={[
                    styles.frame,
                    {
                      left: rect.x,
                      top: rect.y,
                      width: rect.width,
                      height: rect.height,
                    },
                  ]}>
                  {[1, 2].map(i => (
                    <React.Fragment key={i}>
                      <View
                        style={[
                          styles.gridVertical,
                          {left: (rect.width * i) / 3},
                        ]}
                      />
                      <View
                        style={[
                          styles.gridHorizontal,
                          {top: (rect.height * i) / 3},
                        ]}
                      />
                    </React.Fragment>
                  ))}
                  {corners.map(corner => (
                    <View
                      key={corner}
                      style={[
                        styles.corner,
                        corner.includes('w') ? styles.left : styles.right,
                        corner.includes('n') ? styles.top : styles.bottom,
                      ]}
                    />
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}
        {!loaded && !loadError && (
          <ActivityIndicator
            color="#fff"
            style={styles.loading}
            pointerEvents="none"
          />
        )}
        {loadError && (
          <Pressable
            style={styles.loading}
            onPress={() => setAttempt(attempt + 1)}>
            <Text style={styles.text}>图片预览失败，点击重试</Text>
          </Pressable>
        )}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => submit(true)}
          style={styles.original}>
          <Text style={styles.text}>原图</Text>
        </Pressable>
        <Text style={styles.hint}>
          {busy ? '正在保存…' : '原图保留整张照片'}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !loaded}
          onPress={() => submit(false)}
          style={[styles.done, (busy || !loaded) && styles.disabled]}>
          <Text style={styles.text}>完成裁剪</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  positioned: {position: 'absolute'},
  topLeft: {left: 0, top: 0},
  maskLeft: {left: 0},
  safe: {flex: 1, backgroundColor: '#101216'},
  stage: {flex: 1},
  toolbar: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {fontSize: 16, color: '#fff'},
  hint: {fontSize: 12, color: '#cbd5e1', textAlign: 'center'},
  action: {padding: 12},
  original: {
    padding: 12,
    borderColor: '#64748b',
    borderWidth: 1,
    borderRadius: 8,
  },
  done: {backgroundColor: '#078855', padding: 12, borderRadius: 8},
  disabled: {opacity: 0.4},
  mask: {position: 'absolute', backgroundColor: '#0009'},
  frame: {position: 'absolute', borderWidth: 1, borderColor: '#fff'},
  gridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#ffffff60',
  },
  gridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#ffffff60',
  },
  corner: {position: 'absolute', width: 20, height: 20, borderColor: '#fff'},
  left: {left: -2, borderLeftWidth: 3},
  right: {right: -2, borderRightWidth: 3},
  top: {top: -2, borderTopWidth: 3},
  bottom: {bottom: -2, borderBottomWidth: 3},
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {color: '#fecaca', paddingHorizontal: 16, lineHeight: 22},
});
