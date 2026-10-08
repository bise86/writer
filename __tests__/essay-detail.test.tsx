import React from 'react';
import {Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import EssayDetail from '../src/components/EssayDetail';
import {Essay, ScoreResult} from '../src/types';

jest.mock('../src/db/database', () => ({getSteps: jest.fn(async () => [])}));
jest.mock('../src/components/CorrectionPdf', () => 'CorrectionPdf');
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
  ]);
  essay = {...essay, status: 'scoring', canonicalText: '正确标题\n第一段。'};
  await update();
  expect(tabs().map(item => item.findByType(Text).props.children)).toEqual([
    '原文',
    '阶段输出',
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
  expect(tabs()).toHaveLength(1);
  expect(text()).toContain('处理进度');
  expect(view.root.findAllByType('CorrectionPdf' as any)).toHaveLength(0);
});
