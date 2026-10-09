import React from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import ImageCropper from '../src/components/ImageCropper';
import ImageViewer from '../src/components/ImageViewer';

let view: ReactTestRenderer;
let handlers: any;
const submit = jest.fn(async (): Promise<void> => undefined);
const cancel = jest.fn();
const imageStyle = () =>
  StyleSheet.flatten(view.root.findByType(Image).props.style);
const touch = (x: number, y: number) => ({
  pageX: x,
  pageY: y + 60,
  locationX: x,
  locationY: y,
});
const event = (...touches: ReturnType<typeof touch>[]) => ({
  nativeEvent: {touches, ...touches[0]},
});
const press = async (label: string) =>
  act(async () => {
    await view.root
      .findAllByType(Pressable)
      .find(button =>
        button.findAllByType(Text).some(t => t.props.children === label),
      )!
      .props.onPress();
  });
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => {
    success(4000, 2000);
  });
  jest.spyOn(PanResponder, 'create').mockImplementation(config => {
    handlers = config;
    return {panHandlers: {}, getInteractionHandle: () => null};
  });
});
afterEach(() => {
  act(() => view?.unmount());
  jest.restoreAllMocks();
});

async function renderCropper() {
  await act(async () => {
    view = create(
      <ImageCropper
        uri="file:///page.jpg"
        pageLabel="1 / 2"
        onSubmit={submit}
        onCancel={cancel}
      />,
    );
  });
  act(() =>
    view.root
      .findByProps({testID: 'crop-viewport'})
      .props.onLayout({nativeEvent: {layout: {width: 440, height: 640}}}),
  );
  act(() => view.root.findByType(Image).props.onLoad());
}

test('拖拽裁剪框按真实图片坐标提交，顶部留白不被计入图片', async () => {
  await renderCropper();
  // Visible landscape image: x=20, y=220, width=400, height=200.
  act(() => handlers.onPanResponderGrant(event(touch(20, 220))));
  act(() =>
    handlers.onPanResponderMove(event(touch(70, 240)), {dx: 50, dy: 20}),
  );
  act(() => handlers.onPanResponderRelease());
  await press('完成裁剪');
  expect(submit).toHaveBeenCalledWith({
    kind: 'crop',
    source: {width: 4000, height: 2000},
    rect: {x: 500, y: 200, width: 3500, height: 1800},
  });
});

test('原图忽略已调整的裁剪框，重置恢复全图，取消不提交', async () => {
  await renderCropper();
  act(() => handlers.onPanResponderGrant(event(touch(20, 220))));
  act(() =>
    handlers.onPanResponderMove(event(touch(70, 240)), {dx: 50, dy: 20}),
  );
  await press('原图');
  expect(submit).toHaveBeenLastCalledWith({kind: 'original'});
  await press('重置');
  await press('完成裁剪');
  expect(submit).toHaveBeenLastCalledWith({
    kind: 'crop',
    source: {width: 4000, height: 2000},
    rect: {x: 0, y: 0, width: 4000, height: 2000},
  });
  await press('取消');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(2);
});

test('裁剪失败留在原界面并允许重试，不自动使用原图', async () => {
  submit.mockRejectedValueOnce(new Error('存储失败'));
  await renderCropper();
  await press('完成裁剪');
  expect(JSON.stringify(view.toJSON())).toContain('存储失败');
  expect(submit).toHaveBeenCalledTimes(1);
  await press('完成裁剪');
  expect(submit).toHaveBeenCalledTimes(2);
  expect(
    submit.mock.calls.every(([choice]: any[]) => choice.kind === 'crop'),
  ).toBe(true);
});

test('保存进行中不允许重复提交或取消', async () => {
  let finish!: () => void;
  submit.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  await renderCropper();
  const actions = view.root.findAllByType(Pressable);
  const original = actions.find(button =>
    button.findAllByType(Text).some(t => t.props.children === '原图'),
  )!;
  act(() => {
    original.props.onPress();
    original.props.onPress();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    actions.find(button =>
      button.findAllByType(Text).some(t => t.props.children === '取消'),
    )!.props.disabled,
  ).toBe(true);
  await act(async () => finish());
});

test('读取失败时仍可选择原图，不会用错误的默认尺寸裁剪', async () => {
  (Image.getSize as jest.Mock).mockImplementation((_uri, _success, failure) =>
    failure(new Error('无法读取')),
  );
  await act(async () => {
    view = create(
      <ImageCropper
        uri="file:///page.jpg"
        pageLabel="1 / 2"
        onSubmit={submit}
        onCancel={cancel}
      />,
    );
  });
  expect(JSON.stringify(view.toJSON())).toContain('图片预览失败');
  const done = view.root
    .findAllByType(Pressable)
    .find(button =>
      button.findAllByType(Text).some(t => t.props.children === '完成裁剪'),
    )!;
  expect(done.props.disabled).toBe(true);
  await press('原图');
  expect(submit).toHaveBeenCalledWith({kind: 'original'});
});

test('大图从点击的照片打开，双指放大、单指移动，切图恢复缩放', async () => {
  await act(async () => {
    view = create(
      <ImageViewer
        uris={['file:///one.jpg', 'file:///two.jpg']}
        initialIndex={1}
        onClose={cancel}
      />,
    );
  });
  const layout = () =>
    act(() =>
      view.root
        .findAllByType(View)
        .find(node => node.props.onLayout)!
        .props.onLayout({nativeEvent: {layout: {width: 400, height: 600}}}),
    );
  layout();
  expect(view.root.findByType(Image).props.source.uri).toBe('file:///two.jpg');
  act(() =>
    handlers.onPanResponderGrant(event(touch(150, 300), touch(250, 300))),
  );
  act(() =>
    handlers.onPanResponderMove(event(touch(100, 300), touch(300, 300))),
  );
  expect(imageStyle().transform).toEqual([{scale: 2}]);
  act(() => handlers.onPanResponderEnd(event(touch(100, 300))));
  act(() => handlers.onPanResponderMove(event(touch(160, 300))));
  expect(imageStyle().left).toBe(60);
  act(() =>
    handlers.onPanResponderRelease(event(), {
      numberActiveTouches: 0,
      dx: 0,
      dy: 0,
    }),
  );
  expect(imageStyle().transform).toEqual([{scale: 2}]);
  await press('上一张');
  layout();
  expect(view.root.findByType(Image).props.source.uri).toBe('file:///one.jpg');
  expect(imageStyle().transform).toEqual([{scale: 1}]);
  act(() => handlers.onPanResponderGrant(event(touch(300, 300))));
  act(() =>
    handlers.onPanResponderRelease(event(), {
      numberActiveTouches: 0,
      dx: -160,
      dy: 10,
    }),
  );
  layout();
  expect(view.root.findByType(Image).props.source.uri).toBe('file:///two.jpg');
  act(() => view.root.findByType(Modal).props.onRequestClose());
  expect(cancel).toHaveBeenCalledTimes(1);
});
