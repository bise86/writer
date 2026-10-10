import ImageEditor from '@react-native-community/image-editor';
import RNFS from 'react-native-fs';
import {
  cropImage,
  discardPreparedImages,
  persistImage,
} from '../src/services/images';

jest.mock('@react-native-community/image-editor', () => ({
  cropImage: jest.fn(async () => ({uri: 'file:///crop.jpg'})),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  mkdir: jest.fn(),
  copyFile: jest.fn(),
  unlink: jest.fn(async () => undefined),
}));
beforeEach(() => jest.clearAllMocks());
test('保存实际选中的图片，不用 originalPath 覆盖裁剪或旋转结果', async () => {
  await persistImage('file:///selected.jpg', {originalPath: '/original.jpg'});
  expect(RNFS.copyFile).toHaveBeenCalledWith(
    '/selected.jpg',
    expect.any(String),
  );
});
test('大幅裁剪结果等比缩放，不把手写文字拉伸成方形', async () => {
  await cropImage(
    'file:///original.jpg',
    {width: 6000, height: 4500},
    {x: 0, y: 0, width: 6000, height: 4500},
  );
  expect(ImageEditor.cropImage).toHaveBeenCalledWith(
    'file:///original.jpg',
    expect.objectContaining({
      displaySize: {width: 3200, height: 2400},
      quality: 1,
    }),
  );
});

test('按用户选择的非居中矩形裁剪，保留宽高比例', async () => {
  await cropImage(
    'file:///original.jpg',
    {width: 2400, height: 3200},
    {x: 120, y: 480, width: 1560, height: 2000},
  );
  expect(ImageEditor.cropImage).toHaveBeenCalledWith(
    'file:///original.jpg',
    expect.objectContaining({
      offset: {x: 120, y: 480},
      size: {width: 1560, height: 2000},
      displaySize: {width: 1560, height: 2000},
    }),
  );
  expect(RNFS.copyFile).toHaveBeenCalledWith(
    '/crop.jpg',
    expect.stringContaining('/documents/essay-images/'),
  );
});

test('鸿蒙裁剪返回 URI 字符串也能持久保存', async () => {
  (ImageEditor.cropImage as jest.Mock).mockResolvedValueOnce(
    'file:///harmony-crop.jpg',
  );
  await cropImage(
    'file:///original.jpg',
    {width: 100, height: 100},
    {x: 0, y: 0, width: 50, height: 80},
  );
  expect(RNFS.copyFile).toHaveBeenCalledWith(
    '/harmony-crop.jpg',
    expect.any(String),
  );
});

test('裁剪范围非法时明确失败，不偷偷换回整张原图', async () => {
  await expect(
    cropImage(
      'file:///original.jpg',
      {width: 100, height: 100},
      {x: 80, y: 0, width: 50, height: 80},
    ),
  ).rejects.toThrow('裁剪范围');
  expect(ImageEditor.cropImage).not.toHaveBeenCalled();
});

test('保存失败不能用可能失效的临时 URI 冒充持久化成功', async () => {
  (RNFS.copyFile as jest.Mock).mockRejectedValueOnce(new Error('磁盘已满'));
  await expect(persistImage('file:///selected.jpg')).rejects.toThrow(
    '磁盘已满',
  );
  expect(RNFS.unlink).toHaveBeenCalledWith(
    expect.stringContaining('/documents/essay-images/'),
  );
});

test('保留 WebP 图片扩展名，让原图识别发送正确的 MIME 类型', async () => {
  expect(await persistImage('file:///selected.webp')).toMatch(/\.webp$/);
  expect(RNFS.copyFile).toHaveBeenCalledWith('/selected.webp', expect.stringMatching(/\.webp$/));
});

test('取消导入只删除自己保存的副本，不删除相册原件', async () => {
  await discardPreparedImages([
    'file:///documents/essay-images/image_1.jpg',
    'file:///DCIM/camera.jpg',
    'content://photo/3',
  ]);
  expect(RNFS.unlink).toHaveBeenCalledTimes(1);
  expect(RNFS.unlink).toHaveBeenCalledWith(
    '/documents/essay-images/image_1.jpg',
  );
});
