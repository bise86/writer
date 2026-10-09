import React from 'react';
import {Image, Pressable, Text, View} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import EssayDetail from '../src/components/EssayDetail';
import {Essay, ScoreResult} from '../src/types';
import ImageViewer from '../src/components/ImageViewer';

jest.mock('../src/db/database', () => ({getSteps: jest.fn(async () => [])}));
jest.mock('../src/components/CorrectionPdf', () => 'CorrectionPdf');
jest.mock('../src/components/UsageDetails', () => 'UsageDetails');
jest.mock('../src/components/ImageViewer', () => 'ImageViewer');
const score: ScoreResult = {
  score: 80,
  bandId: 'high',
  summary: '总评文字',
  dimensionScores: {thesis: 20},
  strengths: ['全篇亮点'],
  weaknesses: ['全篇问题'],
  improvements: ['补充细节'],
  suggestions: ['练习描写'],
  annotations: [],
  dimensionFeedback: {
    thesis: {
      strengths: ['立意优点'],
      weaknesses: ['立意不足'],
      improvements: ['立意改法'],
    },
  },
};
let essay: Essay;
let view: ReactTestRenderer;
const props = {onBack: jest.fn(), onRetry: jest.fn(), onRecognize: jest.fn()};
const text = () =>
  view.root
    .findAllByType(Text)
    .map(item => item.props.children)
    .flat()
    .join('|');
const tabs = () =>
  view.root
    .findAllByType(Pressable)
    .filter(item => item.props.accessibilityRole === 'tab');
const select = (label: string) =>
  act(() =>
    tabs()
      .find(item => item.findByType(Text).props.children === label)!
      .props.onPress(),
  );
beforeEach(() => {
  jest.useFakeTimers();
  essay = {
    id: '1',
    title: '旧错标题',
    imageUri: 'file:///1.jpg',
    imageUris: ['file:///1.jpg'],
    localOcr: '',
    visionOcr: '',
    canonicalText: '',
    corrections: '',
    scoreJson: '',
    status: 'vision_ocr',
    error: '',
    createdAt: '',
    updatedAt: '',
  };
});
afterEach(() => {
  act(() => view.unmount());
  jest.useRealTimers();
});
async function render() {
  await act(async () => {
    view = create(<EssayDetail essay={essay} {...props} />);
  });
}
async function update() {
  await act(async () => view.update(<EssayDetail essay={essay} {...props} />));
}
test('识别完成才出现原文且排在首位，成功时自动切换评分结果', async () => {
  await render();
  expect(tabs().map(item => item.findByType(Text).props.children)).toEqual([
    '阶段输出',
    '消耗详情',
  ]);
  essay = {...essay, status: 'scoring', canonicalText: '正确标题\n第一段。'};
  await update();
  expect(tabs().map(item => item.findByType(Text).props.children)).toEqual([
    '原文',
    '阶段输出',
    '消耗详情',
  ]);
  expect(text()).not.toContain('旧错标题');
  select('原文');
  expect(text()).toContain('第一段。');
  essay = {...essay, status: 'completed', scoreJson: JSON.stringify(score)};
  await update();
  expect(tabs().map(item => item.findByType(Text).props.children)).toEqual([
    '原文',
    '阶段输出',
    '评分结果',
    '批改',
    '消耗详情',
  ]);
  expect(text()).toContain('总评文字');
  expect(text().indexOf('各项评分')).toBeLessThan(text().indexOf('立意优点'));
  select('批改');
  expect(view.root.findAllByType('CorrectionPdf' as any)).toHaveLength(1);
  expect(text()).not.toContain('全篇亮点');
});
test('重新识别后隐藏旧原文、旧评分和批改页', async () => {
  essay = {
    ...essay,
    status: 'completed',
    canonicalText: '标题\n正文',
    scoreJson: JSON.stringify(score),
  };
  await render();
  select('批改');
  essay = {...essay, status: 'vision_ocr', canonicalText: '', scoreJson: ''};
  await update();
  expect(tabs()).toHaveLength(2);
  expect(text()).toContain('处理进度');
  expect(view.root.findAllByType('CorrectionPdf' as any)).toHaveLength(0);
});

test('原始照片从识别前就显示在标题和页卡之间，切换所有页卡都保留', async () => {
  essay.imageUris = ['file:///1.jpg', 'file:///2.jpg'];
  await render();
  const photoBlock = view.root
    .findAllByType(View)
    .find(item => item.props.accessibilityLabel === '原始照片')!;
  expect(
    photoBlock.findAllByType(Image).map(item => item.props.source.uri),
  ).toEqual(essay.imageUris);
  const parent = photoBlock.parent!;
  const nodes = parent.children;
  const titleIndex = nodes.findIndex(
    item =>
      typeof item !== 'string' && item.props.accessibilityLabel === '作文标题',
  );
  const photoIndex = nodes.indexOf(photoBlock);
  const tabIndex = nodes.findIndex(
    item =>
      typeof item !== 'string' && item.props.accessibilityRole === 'tablist',
  );
  expect(titleIndex).toBeLessThan(photoIndex);
  expect(titleIndex).toBeGreaterThanOrEqual(0);
  expect(photoIndex).toBeLessThan(tabIndex);
  select('消耗详情');
  expect(view.root.findAllByType('UsageDetails' as any)).toHaveLength(1);
  expect(view.root.findAllByType(Image)).toHaveLength(2);
  essay = {
    ...essay,
    status: 'completed',
    canonicalText: '标题\n正文',
    scoreJson: JSON.stringify(score),
  };
  await update();
  for (const label of ['原文', '评分结果', '批改', '消耗详情']) {
    select(label);
    expect(
      view.root.findAllByType(Image).map(item => item.props.source.uri),
    ).toEqual(essay.imageUris);
  }
});

test('点击第二张照片打开对应大图，关闭后仍在当前页卡，原文按段落展示', async () => {
  essay = {
    ...essay,
    imageUris: ['file:///1.jpg', 'file:///2.jpg'],
    canonicalText: '春天\n\n第一段。第二句。\n\n第二段。',
  };
  await render();
  select('原文');
  act(() =>
    view.root
      .findAllByType(Pressable)
      .find(button => button.props.accessibilityLabel === '查看原始照片 2')!
      .props.onPress(),
  );
  const viewer = view.root.findByType(ImageViewer);
  expect(viewer.props.uris).toEqual(essay.imageUris);
  expect(viewer.props.initialIndex).toBe(1);
  act(() => viewer.props.onClose());
  expect(view.root.findAllByType(ImageViewer)).toHaveLength(0);
  const original = view.root
    .findAllByType(Text)
    .filter(node => node.props.selectable)
    .map(node => node.props.children);
  expect(original).toEqual(['春天', '第一段。第二句。', '第二段。']);
});
