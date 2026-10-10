import React from 'react';
import {Alert, PermissionsAndroid, Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import App from '../App';
import ImageCropper from '../src/components/ImageCropper';
import Reports from '../src/components/Reports';
import Detail from '../src/components/EssayDetail';
import {createEssay, getEssay, listEssays} from '../src/db/database';
import {
  cropImage,
  discardPreparedImages,
  persistImage,
} from '../src/services/images';
import {runEssayPipeline} from '../src/services/pipeline';

jest.mock('../src/components/Startup', () => ({
  __esModule: true,
  default: ({children}: any) =>
    children({
      essays: [],
      settings: jest.requireActual('../src/settings').DEFAULT_SETTINGS,
    }),
}));
jest.mock('../src/components/ImageCropper', () => 'ImageCropper');
jest.mock('../src/components/EssayDetail', () => 'EssayDetail');
jest.mock('../src/components/Reports', () => 'Reports');
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('../src/db/database', () => ({
  createEssay: jest.fn(),
  listEssays: jest.fn(async () => []),
  getEssay: jest.fn(),
}));
jest.mock('../src/services/images', () => ({
  cropImage: jest.fn(),
  persistImage: jest.fn(),
  discardPreparedImages: jest.fn(async () => undefined),
}));
jest.mock('../src/services/pipeline', () => ({
  runEssayPipeline: jest.fn(async () => undefined),
}));
let view: ReactTestRenderer;
const press = (label: string) =>
  act(() => {
    view.root
      .findAllByType(Pressable)
      .find(button =>
        button.findAllByType(Text).some(t => t.props.children === label),
      )!
      .props.onPress();
  });
const settle = async () => act(async () => {});
beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (listEssays as jest.Mock).mockResolvedValue([]);
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  (persistImage as jest.Mock).mockImplementation(async uri => `${uri}.saved`);
  (cropImage as jest.Mock).mockResolvedValue('file:///cropped.saved');
  (createEssay as jest.Mock).mockImplementation(async uris => ({
    id: 'essay',
    imageUris: uris,
    imageUri: uris[0],
    status: 'queued',
  }));
  await act(async () => {
    view = create(<App />);
  });
});

test('入库后的列表刷新失败仍启动批改，不删除已归属作文的图片', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValue({assets: [{uri: 'file:///one.jpg'}]});
  (listEssays as jest.Mock).mockRejectedValueOnce(new Error('列表读取失败'));
  press('选择图片（可多选）');
  await settle();
  await act(async () => view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}));
  await settle();
  expect(runEssayPipeline).toHaveBeenCalledWith(expect.objectContaining({id: 'essay'}));
  expect(discardPreparedImages).not.toHaveBeenCalled();
});
afterEach(() => {
  act(() => view.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('首页改名且管理旁有报表入口，查看作文后返回保留报表日期', async () => {
  expect(
    view.root
      .findAllByType(Text)
      .some(node => node.props.children === '作文批改'),
  ).toBe(true);
  const labels = view.root.findAllByType(Text).map(node => node.props.children);
  expect(labels.indexOf('报表')).toBe(labels.indexOf('管理') + 1);
  press('报表');
  const range = {start: '2026-01-01', end: '2026-02-01'};
  act(() => view.root.findByType(Reports).props.onRangeChange(range));
  (getEssay as jest.Mock).mockResolvedValueOnce({
    id: 'saved',
    status: 'completed',
  });
  await act(async () =>
    view.root.findByType(Reports).props.onOpenEssay('saved'),
  );
  await act(async () => view.root.findByType(Detail).props.onBack());
  expect(view.root.findByType(Reports).props.initialRange).toEqual(range);
});

test('相册多选逐张进入裁剪，混合原图与裁剪后按顺序入库', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValue({
    assets: [{uri: 'file:///one.jpg'}, {uri: 'file:///two.jpg'}],
  });
  press('选择图片（可多选）');
  await settle();
  expect(launchImageLibrary).toHaveBeenCalledWith(
    expect.objectContaining({selectionLimit: 0}),
  );
  expect(view.root.findByType(ImageCropper).props.pageLabel).toBe('1 / 2');
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
  );
  expect(createEssay).not.toHaveBeenCalled();
  expect(view.root.findByType(ImageCropper).props.pageLabel).toBe('2 / 2');
  const choice = {
    kind: 'crop',
    source: {width: 2400, height: 3200},
    rect: {x: 200, y: 300, width: 1800, height: 2400},
  };
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit(choice),
  );
  expect(cropImage).toHaveBeenCalledWith(
    'file:///two.jpg',
    choice.source,
    choice.rect,
  );
  expect(createEssay).toHaveBeenCalledWith([
    'file:///one.jpg.saved',
    'file:///cropped.saved',
  ]);
  expect(runEssayPipeline).toHaveBeenCalledTimes(1);
  expect(discardPreparedImages).not.toHaveBeenCalled();
});

test('处理中取消整次导入会删除已准备的副本，不留下半篇作文', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValue({
    assets: [{uri: 'file:///one.jpg'}, {uri: 'file:///two.jpg'}],
  });
  press('选择图片（可多选）');
  await settle();
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
  );
  act(() => view.root.findByType(ImageCropper).props.onCancel());
  await settle();
  expect(createEssay).not.toHaveBeenCalled();
  expect(runEssayPipeline).not.toHaveBeenCalled();
  expect(discardPreparedImages).toHaveBeenCalledWith(['file:///one.jpg.saved']);
  expect(view.root.findAllByType(ImageCropper)).toHaveLength(0);
});

test('连续拍照每张进入裁剪，结束拍摄才提交，同一次导入不会重复打开相机', async () => {
  (launchCamera as jest.Mock)
    .mockResolvedValueOnce({assets: [{uri: 'file:///camera1.jpg'}]})
    .mockResolvedValueOnce({assets: [{uri: 'file:///camera2.jpg'}]});
  press('拍照');
  press('拍照');
  await settle();
  expect(launchCamera).toHaveBeenCalledTimes(1);
  expect(view.root.findByType(ImageCropper).props.uri).toBe(
    'file:///camera1.jpg',
  );
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
  );
  const cameraButtons = () =>
    (Alert.alert as jest.Mock).mock.calls
      .filter(call => call[0] === '照片已加入')
      .slice(-1)[0][2];
  act(() =>
    cameraButtons()
      .find((b: any) => b.text === '继续拍摄')
      .onPress(),
  );
  await settle();
  expect(launchCamera).toHaveBeenCalledTimes(2);
  expect(view.root.findByType(ImageCropper).props.uri).toBe(
    'file:///camera2.jpg',
  );
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
  );
  act(() =>
    cameraButtons()
      .find((b: any) => b.text === '完成')
      .onPress(),
  );
  await settle();
  expect(createEssay).toHaveBeenCalledWith([
    'file:///camera1.jpg.saved',
    'file:///camera2.jpg.saved',
  ]);
});

test('数据库保存失败时清理尚未关联的图片副本', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValue({
    assets: [{uri: 'file:///one.jpg'}],
  });
  (createEssay as jest.Mock).mockRejectedValueOnce(new Error('数据库不可写'));
  press('选择图片（可多选）');
  await settle();
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
  );
  expect(discardPreparedImages).toHaveBeenCalledWith(['file:///one.jpg.saved']);
  expect(runEssayPipeline).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('无法获取图片', '数据库不可写');
});
