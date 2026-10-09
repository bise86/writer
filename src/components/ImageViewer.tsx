import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {GestureResponderEvent} from 'react-native';
import {
  constrainTransform,
  containRect,
  ImageTransform,
  pinchTransform,
  Point,
  Size,
} from '../services/image-geometry';

const identity: ImageTransform = {scale: 1, x: 0, y: 0};

function ZoomPhoto({
  uri,
  onSwipe,
}: {
  uri: string;
  onSwipe: (direction: number) => void;
}) {
  const [viewport, setViewport] = useState<Size>({width: 0, height: 0});
  const [size, setSize] = useState<Size>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [transform, setTransform] = useState(identity);
  const latest = useRef({viewport, size, transform, onSwipe});
  latest.current = {viewport, size, transform, onSwipe};
  const gesture = useRef<{
    points: Point[];
    transform: ImageTransform;
    origin: Point;
    swipable: boolean;
    hadPinch: boolean;
  }>();
  const lastTap = useRef(0);
  useEffect(() => {
    let active = true;
    setError(false);
    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) {
          setSize({width, height});
        } else if (active) {
          setError(true);
        }
      },
      () => {
        if (active) {
          setError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [uri, attempt]);
  const responder = useMemo(() => {
    const points = (event: GestureResponderEvent) =>
      event.nativeEvent.touches.map(t => ({x: t.pageX, y: t.pageY}));
    const begin = (event: GestureResponderEvent) => {
      const touches = event.nativeEvent.touches;
      if (!touches.length) {
        return;
      }
      const touch = touches[0];
      const {viewport: bounds, transform: value} = latest.current;
      gesture.current = {
        points: points(event),
        transform: value,
        origin: {
          x: touch.pageX - touch.locationX + bounds.width / 2,
          y: touch.pageY - touch.locationY + bounds.height / 2,
        },
        swipable:
          touches.length === 1 &&
          value.scale === 1 &&
          (gesture.current?.swipable ?? true),
        hadPinch: touches.length > 1 || !!gesture.current?.hadPinch,
      };
    };
    const apply = (value: ImageTransform) => {
      const {size: image, viewport: bounds} = latest.current;
      if (!image || !bounds.width || !bounds.height) {
        return;
      }
      const next = constrainTransform(value, image, bounds);
      latest.current.transform = next;
      setTransform(next);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: begin,
      onPanResponderStart: begin,
      onPanResponderMove: event => {
        const start = gesture.current;
        const current = points(event);
        if (!start || !current.length) {
          return;
        }
        if (current.length !== start.points.length) {
          begin(event);
          return;
        }
        if (current.length >= 2) {
          const distance = (p: Point[]) =>
            Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
          const midpoint = (p: Point[]) => ({
            x: (p[0].x + p[1].x) / 2 - start.origin.x,
            y: (p[0].y + p[1].y) / 2 - start.origin.y,
          });
          apply(
            pinchTransform(
              start.transform,
              midpoint(start.points),
              midpoint(current),
              distance(current) / Math.max(1, distance(start.points)),
            ),
          );
        } else {
          apply({
            ...start.transform,
            x: start.transform.x + current[0].x - start.points[0].x,
            y: start.transform.y + current[0].y - start.points[0].y,
          });
        }
      },
      onPanResponderEnd: event => {
        if (event.nativeEvent.touches.length) {
          begin(event);
        }
      },
      onPanResponderRelease: (_event, state) => {
        if (
          gesture.current?.swipable &&
          Math.abs(state.dx) > 60 &&
          Math.abs(state.dx) > Math.abs(state.dy) * 1.5
        ) {
          latest.current.onSwipe(state.dx < 0 ? 1 : -1);
        } else if (
          state.numberActiveTouches === 0 &&
          Math.abs(state.dx) < 8 &&
          Math.abs(state.dy) < 8 &&
          gesture.current?.points.length === 1 &&
          !gesture.current.hadPinch
        ) {
          const now = Date.now();
          if (now - lastTap.current < 280) {
            apply(
              latest.current.transform.scale > 1
                ? identity
                : {scale: 2.5, x: 0, y: 0},
            );
            lastTap.current = 0;
          } else {
            lastTap.current = now;
          }
        }
        gesture.current = undefined;
      },
      onPanResponderTerminate: () => {
        gesture.current = undefined;
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);
  const fitted =
    size && viewport.width && viewport.height
      ? containRect(size, viewport)
      : undefined;
  return (
    <View
      style={styles.stage}
      onLayout={event => {
        setViewport(event.nativeEvent.layout);
        setTransform(identity);
      }}>
      {error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAttempt(attempt + 1)}
          style={styles.message}>
          <Text style={styles.text}>图片读取失败，点击重试</Text>
        </Pressable>
      ) : !fitted ? (
        <ActivityIndicator color="#fff" style={styles.message} />
      ) : (
        <View
          style={StyleSheet.absoluteFill}
          testID="image-zoom-surface"
          {...responder.panHandlers}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Image
              source={{uri}}
              resizeMode="contain"
              onError={() => setError(true)}
              style={[
                styles.positioned,
                {
                  left: fitted.x + transform.x,
                  top: fitted.y + transform.y,
                  width: fitted.width,
                  height: fitted.height,
                  transform: [{scale: transform.scale}],
                },
              ]}
            />
          </View>
        </View>
      )}
    </View>
  );
}

export default function ImageViewer({
  uris,
  initialIndex,
  onClose,
}: {
  uris: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const change = (direction: number) =>
    setIndex(value =>
      Math.max(0, Math.min(uris.length - 1, value + direction)),
    );
  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen">
      <SafeAreaView style={styles.safe}>
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭图片"
            onPress={onClose}
            style={styles.action}>
            <Text style={styles.text}>关闭</Text>
          </Pressable>
          <Text style={styles.text}>
            {index + 1} / {uris.length}
          </Text>
          <View style={styles.action} />
        </View>
        <ZoomPhoto
          key={`${index}-${uris[index]}`}
          uri={uris[index]}
          onSwipe={change}
        />
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            disabled={index === 0}
            onPress={() => change(-1)}
            style={[styles.action, index === 0 && styles.disabled]}>
            <Text style={styles.text}>上一张</Text>
          </Pressable>
          <Text style={styles.hint}>双指缩放 · 放大后拖动查看</Text>
          <Pressable
            accessibilityRole="button"
            disabled={index === uris.length - 1}
            onPress={() => change(1)}
            style={[
              styles.action,
              index === uris.length - 1 && styles.disabled,
            ]}>
            <Text style={styles.text}>下一张</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  positioned: {position: 'absolute'},
  safe: {flex: 1, backgroundColor: '#090b0f'},
  stage: {flex: 1, overflow: 'hidden'},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  action: {padding: 12, minWidth: 70},
  text: {color: '#fff', fontSize: 16},
  hint: {color: '#cbd5e1', fontSize: 12},
  disabled: {opacity: 0.3},
  message: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});
