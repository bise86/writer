import React from 'react';
import {Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import Pdf from 'react-native-pdf';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import CorrectionPdf from '../src/components/CorrectionPdf';
import {buildAnnotatedPdf} from '../src/services/annotated-pdf';
import {Essay, ScoreResult} from '../src/types';

jest.mock('react-native-pdf', () => 'Pdf');
jest.mock('react-native-share', () => ({open: jest.fn()}));
jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  writeFile: jest.fn(),
  unlink: jest.fn(async () => undefined),
}));
jest.mock('../src/services/annotated-pdf', () => ({
  buildAnnotatedPdf: jest.fn(),
}));
let view: ReactTestRenderer;
const essay = {id: 'test', title: '雨中', canonicalText: '原文'} as Essay;
const score = {} as ScoreResult;
const text = () =>
  view.root
    .findAllByType(Text)
    .map(item => item.props.children)
    .flat()
    .join('|');
const click = async (label: string) =>
  act(async () => {
    const button = view.root
      .findAllByType(Pressable)
      .find(item =>
        item.findAllByType(Text).some(child => child.props.children === label),
      );
    await button!.props.onPress();
  });
beforeEach(() => {
  jest.clearAllMocks();
  (buildAnnotatedPdf as jest.Mock).mockResolvedValue('JVBERi0=');
  (RNFS.writeFile as jest.Mock).mockResolvedValue(undefined);
  (Share.open as jest.Mock).mockResolvedValue({success: true});
});
afterEach(() => act(() => view.unmount()));
async function render() {
  await act(async () => {
    view = create(<CorrectionPdf essay={essay} score={score} />);
  });
}
test('生成的同一个 PDF 可直接预览并以文件方式导出', async () => {
  await render();
  const path = (RNFS.writeFile as jest.Mock).mock.calls[0][0];
  expect(view.root.findByType(Pdf).props.source.uri).toBe(`file://${path}`);
  await click('导出 PDF');
  expect(Share.open).toHaveBeenCalledWith(
    expect.objectContaining({
      url: `file://${path}`,
      type: 'application/pdf',
      failOnCancel: false,
    }),
  );
});
test('生成失败显示具体错误，点击可重新生成', async () => {
  (buildAnnotatedPdf as jest.Mock).mockRejectedValueOnce(
    new Error('临时文件写入失败'),
  );
  await render();
  expect(text()).toContain('临时文件写入失败');
  await click('重新生成');
  expect(view.root.findAllByType(Pdf)).toHaveLength(1);
});
test('导出失败不破坏 PDF 预览，按钮可再次导出', async () => {
  (Share.open as jest.Mock).mockRejectedValueOnce(
    new Error('无法打开分享面板'),
  );
  await render();
  await click('导出 PDF');
  expect(text()).toContain('无法打开分享面板');
  expect(view.root.findAllByType(Pdf)).toHaveLength(1);
  await click('导出 PDF');
  expect(Share.open).toHaveBeenCalledTimes(2);
  expect(text()).not.toContain('无法打开分享面板');
});
