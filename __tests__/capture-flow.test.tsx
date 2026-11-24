import React from 'react';
import {Alert, PermissionsAndroid, Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import App from '../App';
import ImageCropper from '../src/shared/media/ImageCropper';
import Reports from '../src/components/Reports';
import Detail from '../src/components/EssayDetail';
import {createEssay, getEssay, listEssays} from '../src/db/database';
import {
  cropImage,
  discardPreparedImages,
  persistImage,
} from '../src/shared/media/images';
import {discardImportedPdf, pickPdf} from '../src/shared/pdf/documents';
import {retryEssay, runEssayPipeline} from '../src/services/pipeline';

jest.mock('../src/components/Startup', () => ({
  __esModule: true,
  default: ({children}: any) =>
    children({
      essays: [],
      settings: jest.requireActual('../src/settings').DEFAULT_SETTINGS,
    }),
}));
jest.mock('../src/shared/media/ImageCropper', () => 'ImageCropper');
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
jest.mock('../src/shared/media/images', () => ({
  cropImage: jest.fn(),
  persistImage: jest.fn(),
  discardPreparedImages: jest.fn(async () => undefined),
}));
jest.mock('../src/shared/pdf/documents', () => ({
  pickPdf: jest.fn(),
  discardImportedPdf: jest.fn(async () => undefined),
}));
jest.mock('../src/services/pipeline', () => ({
  runEssayPipeline: jest.fn(async () => undefined),
  retryEssay: jest.fn(async () => undefined),
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
  (getEssay as jest.Mock).mockReset();
  (runEssayPipeline as jest.Mock).mockResolvedValue(undefined);
  (retryEssay as jest.Mock).mockResolvedValue(undefined);
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
  press('作文批改');
});

test('入库后的列表刷新失败仍启动批改，不删除已归属作文的图片', async () => {
  (launchImageLibrary as jest.Mock).mockResolvedValue({
    assets: [{uri: 'file:///one.jpg'}],
  });
  (listEssays as jest.Mock).mockRejectedValueOnce(new Error('列表读取失败'));
  press('选择图片（可多选）');
  await settle();
  await act(async () =>
    view.root.findByType(ImageCropper).props.onSubmit({kind: 'original'}),
  );
  await settle();
  expect(runEssayPipeline).toHaveBeenCalledWith(
    expect.objectContaining({id: 'essay'}),
  );
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
  expect(createEssay).toHaveBeenCalledWith(
    ['file:///one.jpg.saved', 'file:///cropped.saved'],
    'chinese',
    'middle',
  );
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
  expect(createEssay).toHaveBeenCalledWith(
    ['file:///camera1.jpg.saved', 'file:///camera2.jpg.saved'],
    'chinese',
    'middle',
  );
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

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {promise, resolve};
}

async function openReportedEssay(id: string) {
  (getEssay as jest.Mock).mockResolvedValueOnce({id, status: 'completed'});
  await act(async () => view.root.findByType(Reports).props.onOpenEssay(id));
}

test('切换到另一篇作文后，旧详情轮询的迟到结果不能覆盖当前记录', async () => {
  press('报表');
  await openReportedEssay('first');
  const oldRead = pending<object>();
  (getEssay as jest.Mock).mockImplementationOnce(() => oldRead.promise);
  await act(async () => jest.advanceTimersByTime(1200));
  await act(async () => view.root.findByType(Detail).props.onBack());
  await openReportedEssay('second');
  await act(async () => oldRead.resolve({id: 'first', status: 'completed'}));
  expect(view.root.findByType(Detail).props.essay.id).toBe('second');
});

test('数据库读取缓慢时详情轮询不会叠加请求', async () => {
  press('报表');
  await openReportedEssay('first');
  const slowRead = pending<object>();
  (getEssay as jest.Mock).mockReturnValue(slowRead.promise);
  (getEssay as jest.Mock).mockClear();
  await act(async () => jest.advanceTimersByTime(4800));
  expect(getEssay).toHaveBeenCalledTimes(1);
  await act(async () => slowRead.resolve({id: 'first', status: 'completed'}));
});

test.each(['onRetry', 'onRecognize'] as const)(
  '%s 完成时只刷新原作文，不把另一篇详情替换回去',
  async action => {
    press('报表');
    await openReportedEssay('first');
    const processing = pending<void>();
    (action === 'onRetry'
      ? (retryEssay as jest.Mock)
      : (runEssayPipeline as jest.Mock)
    ).mockReturnValueOnce(processing.promise);
    act(() => {
      view.root.findByType(Detail).props[action]();
    });
    await act(async () => view.root.findByType(Detail).props.onBack());
    await openReportedEssay('second');
    (getEssay as jest.Mock).mockResolvedValueOnce({
      id: 'first',
      status: 'completed',
    });
    await act(async () => processing.resolve());
    expect(view.root.findByType(Detail).props.essay.id).toBe('second');
  },
);

test('连续打开两篇作文时以最后一次选择为准', async () => {
  press('报表');
  const firstRead = pending<object>();
  (getEssay as jest.Mock).mockReturnValueOnce(firstRead.promise);
  act(() => {
    view.root.findByType(Reports).props.onOpenEssay('first');
  });
  await openReportedEssay('second');
  await act(async () => firstRead.resolve({id: 'first', status: 'completed'}));
  expect(view.root.findByType(Detail).props.essay.id).toBe('second');
});

test('离开报表后，尚未完成的打开请求不能把用户拉回详情', async () => {
  press('报表');
  const firstRead = pending<object>();
  (getEssay as jest.Mock).mockReturnValueOnce(firstRead.promise);
  act(() => {
    view.root.findByType(Reports).props.onOpenEssay('first');
  });
  act(() => view.root.findByType(Reports).props.onBack());
  press('⚙');
  await act(async () => firstRead.resolve({id: 'first', status: 'completed'}));
  expect(view.root.findAllByType(Detail)).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).toContain('系统设置');
});

test.each([
  ['chinese', '作文批改'],
  ['english', '英文批改'],
] as const)(
  '%s 模式支持上传 PDF，按原页序持久化后启动批改并清理临时 PDF 缓存',
  async (mode, entryLabel) => {
    if (mode === 'english') {
      press('‹ 返回首页');
      press(entryLabel);
    }
    const pdf = {
      kind: 'pdf' as const,
      name: 'essay.pdf',
      uri: 'file:///cache/challenge-imports/source_1/source.pdf',
      pageUris: [
        'file:///cache/challenge-imports/pages_1/page_1.jpg',
        'file:///cache/challenge-imports/pages_1/page_2.jpg',
      ],
    };
    (pickPdf as jest.Mock).mockResolvedValueOnce(pdf);
    press('上传 PDF');
    await settle();
    expect(pickPdf).toHaveBeenCalledTimes(1);
    expect(persistImage).toHaveBeenNthCalledWith(1, pdf.pageUris[0]);
    expect(persistImage).toHaveBeenNthCalledWith(2, pdf.pageUris[1]);
    expect(createEssay).toHaveBeenCalledWith(
      [
        'file:///cache/challenge-imports/pages_1/page_1.jpg.saved',
        'file:///cache/challenge-imports/pages_1/page_2.jpg.saved',
      ],
      mode,
      'middle',
    );
    expect(runEssayPipeline).toHaveBeenCalledWith(
      expect.objectContaining({id: 'essay'}),
    );
    expect(view.root.findByType(Detail).props.essay.id).toBe('essay');
    expect(discardPreparedImages).not.toHaveBeenCalled();
    expect(discardImportedPdf).toHaveBeenCalledWith(pdf);
    expect(Alert.alert).not.toHaveBeenCalled();
  },
);

test('上传 PDF 取消选择时不报错、不入库，且随后可再次上传', async () => {
  (pickPdf as jest.Mock).mockResolvedValueOnce(null);
  press('上传 PDF');
  await settle();
  expect(createEssay).not.toHaveBeenCalled();
  expect(runEssayPipeline).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  const pdf = {
    kind: 'pdf' as const,
    name: 'second.pdf',
    uri: 'file:///cache/challenge-imports/source_2/source.pdf',
    pageUris: ['file:///cache/challenge-imports/pages_2/page_1.jpg'],
  };
  (pickPdf as jest.Mock).mockResolvedValueOnce(pdf);
  press('上传 PDF');
  await settle();
  expect(createEssay).toHaveBeenCalledTimes(1);
  expect(discardImportedPdf).toHaveBeenCalledWith(pdf);
});

test('上传 PDF 进行中连点不会重复打开文件选择器，失败时明确提示', async () => {
  const picking = pending<any>();
  (pickPdf as jest.Mock).mockReturnValueOnce(picking.promise);
  press('上传 PDF');
  press('上传 PDF');
  expect(pickPdf).toHaveBeenCalledTimes(1);
  await act(async () => {
    picking.resolve(null);
  });
  (pickPdf as jest.Mock).mockRejectedValueOnce(new Error('PDF 已加密'));
  press('上传 PDF');
  await settle();
  expect(Alert.alert).toHaveBeenCalledWith('无法导入 PDF', 'PDF 已加密');
  expect(createEssay).not.toHaveBeenCalled();
});

test('PDF 页面持久化或入库失败时同时清理已保存页面副本和临时 PDF 缓存', async () => {
  const pdf = {
    kind: 'pdf' as const,
    name: 'broken.pdf',
    uri: 'file:///cache/challenge-imports/source_3/source.pdf',
    pageUris: [
      'file:///cache/challenge-imports/pages_3/page_1.jpg',
      'file:///cache/challenge-imports/pages_3/page_2.jpg',
    ],
  };
  (pickPdf as jest.Mock).mockResolvedValueOnce(pdf);
  (persistImage as jest.Mock)
    .mockResolvedValueOnce('file:///page_1.saved')
    .mockRejectedValueOnce(new Error('磁盘空间不足'));
  press('上传 PDF');
  await settle();
  expect(discardPreparedImages).toHaveBeenCalledWith(['file:///page_1.saved']);
  expect(discardImportedPdf).toHaveBeenCalledWith(pdf);
  expect(createEssay).not.toHaveBeenCalled();
  expect(runEssayPipeline).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('无法导入 PDF', '磁盘空间不足');
});

test('PDF 入库后列表刷新失败仍启动批改，保留持久图片并清理临时 PDF 缓存', async () => {
  const pdf = {
    kind: 'pdf' as const,
    name: 'ok.pdf',
    uri: 'file:///cache/challenge-imports/source_4/source.pdf',
    pageUris: ['file:///cache/challenge-imports/pages_4/page_1.jpg'],
  };
  (pickPdf as jest.Mock).mockResolvedValueOnce(pdf);
  (listEssays as jest.Mock).mockRejectedValueOnce(new Error('列表读取失败'));
  press('上传 PDF');
  await settle();
  expect(runEssayPipeline).toHaveBeenCalledWith(
    expect.objectContaining({id: 'essay'}),
  );
  expect(discardPreparedImages).not.toHaveBeenCalled();
  expect(discardImportedPdf).toHaveBeenCalledWith(pdf);
  expect(Alert.alert).toHaveBeenCalledWith('无法刷新作文列表', '列表读取失败');
});

test('上传 PDF 过程中离开当前批改模式时放弃本次导入并清理缓存', async () => {
  const picking = pending<any>();
  (pickPdf as jest.Mock).mockReturnValueOnce(picking.promise);
  press('上传 PDF');
  press('‹ 返回首页');
  press('英文批改');
  const pdf = {
    kind: 'pdf' as const,
    name: 'stale.pdf',
    uri: 'file:///cache/challenge-imports/source_5/source.pdf',
    pageUris: ['file:///cache/challenge-imports/pages_5/page_1.jpg'],
  };
  await act(async () => {
    picking.resolve(pdf);
  });
  await settle();
  expect(persistImage).not.toHaveBeenCalled();
  expect(createEssay).not.toHaveBeenCalled();
  expect(runEssayPipeline).not.toHaveBeenCalled();
  expect(discardImportedPdf).toHaveBeenCalledWith(pdf);
  expect(view.root.findAllByType(Detail)).toHaveLength(0);
});
