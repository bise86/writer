import ImageEditor from '@react-native-community/image-editor';
import RNFS from 'react-native-fs';
import {cropImage, persistImage} from '../src/services/images';

jest.mock('@react-native-community/image-editor', () => ({
  cropImage: jest.fn(async () => ({uri: 'file:///crop.jpg'})),
}));
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  mkdir: jest.fn(),
  copyFile: jest.fn(),
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
    'landscape',
  );
  expect(ImageEditor.cropImage).toHaveBeenCalledWith(
    'file:///original.jpg',
    expect.objectContaining({
      displaySize: {width: 3200, height: 2400},
      quality: 1,
    }),
  );
});
