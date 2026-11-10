import {NativeModules} from 'react-native';
import RNFS from 'react-native-fs';
import {
  discardChallengePdf,
  pickChallengePdf,
  saveChallengePdf,
} from '../src/challenge/documents';
import {ChallengeSource} from '../src/challenge/types';

jest.mock('react-native', () => ({NativeModules: {}}));
jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  unlink: jest.fn(async () => undefined),
}));

let native: {pickPdf: jest.Mock; renderPdf: jest.Mock; savePdf: jest.Mock};
const selected = {
  uri: 'file:///cache/challenge-imports/source_test/source.pdf',
  name: '期中试卷.pdf',
};
const pageUris = [
  'file:///cache/challenge-imports/pages_test/page_1.jpg',
  'file:///cache/challenge-imports/pages_test/page_2.jpg',
];

beforeEach(() => {
  jest.clearAllMocks();
  native = {
    pickPdf: jest.fn(async () => selected),
    renderPdf: jest.fn(async () => ({pageUris, pageCount: 2})),
    savePdf: jest.fn(async () => true),
  };
  NativeModules.ChallengeDocuments = native;
});

test('PDF逐页渲染并按完整原顺序返回，扫描PDF不依赖可复制文字', async () => {
  expect(await pickChallengePdf()).toEqual({
    kind: 'pdf',
    ...selected,
    pageUris,
  });
  expect(native.renderPdf).toHaveBeenCalledWith(selected.uri);
  expect(RNFS.unlink).not.toHaveBeenCalled();
});

test('取消选择不渲染、不报错，随后仍可再次选择', async () => {
  native.pickPdf.mockResolvedValueOnce(null);
  expect(await pickChallengePdf()).toBeNull();
  expect(native.renderPdf).not.toHaveBeenCalled();
  expect(await pickChallengePdf()).not.toBeNull();
});

test('原生取消错误也作为取消处理，不吞掉真实导入失败', async () => {
  native.pickPdf.mockRejectedValueOnce({code: 'E_CANCELLED'});
  expect(await pickChallengePdf()).toBeNull();
  native.pickPdf.mockRejectedValueOnce(new Error('文件已损坏'));
  await expect(pickChallengePdf()).rejects.toThrow('文件已损坏');
});

test('缺少原生模块明确提示更新安装包，启动加载本模块本身不报错', async () => {
  delete NativeModules.ChallengeDocuments;
  await expect(pickChallengePdf()).rejects.toThrow('新安装包');
});

test('远程URL不能冒充本地PDF，也不会发起原生渲染', async () => {
  native.pickPdf.mockResolvedValueOnce({
    ...selected,
    uri: 'https://example.com/exam.pdf',
  });
  await expect(pickChallengePdf()).rejects.toThrow('本地 PDF');
  expect(native.renderPdf).not.toHaveBeenCalled();
  expect(RNFS.unlink).not.toHaveBeenCalled();
});

test.each([
  {pageCount: 3, pageUris},
  {pageCount: 0, pageUris: []},
  {pageCount: 51, pageUris},
  {pageCount: 2, pageUris: [pageUris[0], pageUris[0]]},
  {pageCount: 2, pageUris: [pageUris[0], 'https://example.com/page.jpg']},
])('缺页、超限或错误页面结果拒绝导入，清理本次副本：%j', async result => {
  native.renderPdf.mockResolvedValueOnce(result);
  await expect(pickChallengePdf()).rejects.toThrow('未截断导入');
  expect(RNFS.unlink).toHaveBeenCalledWith(
    '/cache/challenge-imports/source_test',
  );
});

test('原生渲染失败清理已复制的源PDF，不保存半份来源', async () => {
  native.renderPdf.mockRejectedValueOnce(new Error('PDF已加密'));
  await expect(pickChallengePdf()).rejects.toThrow('已加密');
  expect(RNFS.unlink).toHaveBeenCalledWith(
    '/cache/challenge-imports/source_test',
  );
});

test('保存通过系统文件保存器完成，保留取消与成功的区别', async () => {
  expect(
    await saveChallengePdf('file:///documents/paper.pdf', '挑战/试卷'),
  ).toBe(true);
  expect(native.savePdf).toHaveBeenCalledWith(
    'file:///documents/paper.pdf',
    '挑战_试卷.pdf',
  );
  native.savePdf.mockResolvedValueOnce(false);
  expect(
    await saveChallengePdf('file:///documents/paper.pdf', '挑战.pdf'),
  ).toBe(false);
  native.savePdf.mockRejectedValueOnce(new Error('目标位置已满'));
  await expect(
    saveChallengePdf('file:///documents/paper.pdf', '挑战.pdf'),
  ).rejects.toThrow('已满');
});

test('保存只接收本地PDF，原生未确认保存时不能显示成功', async () => {
  await expect(
    saveChallengePdf('https://example.com/exam.pdf', '试卷.pdf'),
  ).rejects.toThrow('本地 PDF');
  native.savePdf.mockResolvedValueOnce(undefined);
  await expect(
    saveChallengePdf('file:///documents/paper.pdf', '试卷.pdf'),
  ).rejects.toThrow('未返回确认');
});

test('选择尚未结束时防止重开选择器或同时弹出保存器', async () => {
  let resolve!: (value: null) => void;
  native.pickPdf.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const first = pickChallengePdf();
  await expect(pickChallengePdf()).rejects.toThrow('正在进行');
  await expect(
    saveChallengePdf('file:///documents/paper.pdf', '试卷.pdf'),
  ).rejects.toThrow('正在进行');
  resolve(null);
  await expect(first).resolves.toBeNull();
  await expect(pickChallengePdf()).resolves.not.toBeNull();
});

test('清理仅影响自己缓存下的直接导入目录，不删除原件、持久文件或编码路径穿越', async () => {
  const source: ChallengeSource = {
    kind: 'pdf',
    name: '试卷.pdf',
    uri: '/documents/original.pdf',
    pageUris: [
      pageUris[0],
      pageUris[1],
      'file:///DCIM/original.jpg',
      'file:///cache/challenge-imports/%2e%2e/private.pdf',
      'file:///cache/challenge-imports/../private.pdf',
      'file:///cache/challenge-imports/bad%XX/page.jpg',
    ],
  };
  await discardChallengePdf(source);
  expect(RNFS.unlink).toHaveBeenCalledTimes(1);
  expect(RNFS.unlink).toHaveBeenCalledWith(
    '/cache/challenge-imports/pages_test',
  );
});
