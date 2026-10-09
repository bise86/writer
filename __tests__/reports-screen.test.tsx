import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import Reports from '../src/components/Reports';
import ReportDatePicker from '../src/components/ReportDatePicker';
import ScoreTrendChart from '../src/components/ScoreTrendChart';
import {getScoreReport} from '../src/db/database';
import {
  ReportEntry,
  ScoreReport,
  summarizeScores,
} from '../src/services/reports';

jest.mock('../src/db/database', () => ({getScoreReport: jest.fn()}));
const entry: ReportEntry = {
  id: 'score1',
  essayId: 'essay1',
  title: '雨中的等待',
  scoredAt: '2026-10-08T01:00:00.000Z',
  estimatedTime: false,
  scores: {
    total: 80,
    thesis: 20,
    content: 22,
    structure: 16,
    language: 15,
    format: 7,
  },
};
const report = summarizeScores([entry]);
let view: ReactTestRenderer;
const onBack = jest.fn();
const onOpenEssay = jest.fn();
const text = () => JSON.stringify(view.toJSON());
const press = async (label: string) =>
  act(async () => {
    await view.root
      .findAllByType(Pressable)
      .find(
        button =>
          button.props.accessibilityLabel === label ||
          button
            .findAllByType(Text)
            .some(node => node.props.children === label),
      )!
      .props.onPress();
  });
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 9, 12));
  jest.clearAllMocks();
  (getScoreReport as jest.Mock).mockResolvedValue(report);
});
afterEach(() => {
  act(() => view?.unmount());
  jest.useRealTimers();
});
async function render() {
  await act(async () => {
    view = create(<Reports onBack={onBack} onOpenEssay={onOpenEssay} />);
  });
}

test('默认最近一个月，展示真实成绩，趋势可切换分项且各项条形按满分比例展示', async () => {
  await render();
  expect(getScoreReport).toHaveBeenCalledWith({
    start: '2026-09-09',
    end: '2026-10-09',
  });
  expect(text()).toContain('80.0');
  expect(text()).toContain('各项平均评分');
  expect(
    StyleSheet.flatten(
      view.root
        .findAllByType(View)
        .find(node => node.props.testID === 'dimension-bar-format')!.props
        .style,
    ).width,
  ).toBe('70%');
  await press('语言与表达');
  expect(view.root.findByType(ScoreTrendChart).props.metric).toBe('language');
  expect(
    StyleSheet.flatten(
      view.root
        .findAllByType(View)
        .find(node => node.props.testID === 'score-bar-score1')!.props.style,
    ).height,
  ).toBe(120);
  await press('打开作文 ›');
  expect(onOpenEssay).toHaveBeenCalledWith('essay1');
});

test('日历选择后提交查询，反向日期阻止查询，返回保留自定义日期', async () => {
  await render();
  await press('选择开始日期');
  act(() =>
    view.root.findByType(ReportDatePicker).props.onSelect('2026-10-20'),
  );
  await press('查看报表');
  expect(text()).toContain('开始日期不能晚于结束日期');
  expect(getScoreReport).toHaveBeenCalledTimes(1);
  await press('选择结束日期');
  act(() =>
    view.root.findByType(ReportDatePicker).props.onSelect('2026-10-31'),
  );
  await press('查看报表');
  expect(getScoreReport).toHaveBeenLastCalledWith({
    start: '2026-10-20',
    end: '2026-10-31',
  });
  expect(text()).not.toContain('开始日期不能晚于结束日期');
  await press('最近一个月');
  expect(getScoreReport).toHaveBeenLastCalledWith({
    start: '2026-09-09',
    end: '2026-10-09',
  });
});

test('空数据和读取失败分别展示，不伪造零分，失败后可重试', async () => {
  (getScoreReport as jest.Mock)
    .mockRejectedValueOnce(new Error('数据库繁忙'))
    .mockResolvedValueOnce(summarizeScores([]));
  await render();
  expect(text()).toContain('数据库繁忙');
  expect(view.root.findAllByType(ScoreTrendChart)).toHaveLength(0);
  await press('重试读取');
  expect(text()).toContain('这段时间还没有评分记录');
  expect(text()).not.toContain('平均总分');
  expect(view.root.findAllByType(ScoreTrendChart)).toHaveLength(0);
});

test('切换日期后迟到的旧请求不覆盖新报表', async () => {
  let finish!: (value: ScoreReport) => void;
  (getScoreReport as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(summarizeScores([]));
  await render();
  expect(text()).toContain('正在读取评分记录');
  await press('选择开始日期');
  act(() =>
    view.root.findByType(ReportDatePicker).props.onSelect('2026-10-01'),
  );
  await press('查看报表');
  await act(async () => finish(report));
  expect(text()).toContain('这段时间还没有评分记录');
  expect(text()).not.toContain('雨中的等待');
});

test('刷新移除被删除的作文，选中记录不继续显示旧分数', async () => {
  await render();
  (getScoreReport as jest.Mock).mockResolvedValueOnce(summarizeScores([]));
  await press('刷新');
  expect(text()).not.toContain('雨中的等待');
  expect(text()).toContain('这段时间还没有评分记录');
});

test('趋势图默认选中第一根柱，零分仍展示，点击其他柱显示对应作文', async () => {
  const zero: ReportEntry = {
    ...entry,
    scores: {
      total: 0,
      thesis: 0,
      content: 0,
      structure: 0,
      language: 0,
      format: 0,
    },
  };
  const second: ReportEntry = {
    ...entry,
    id: 'score2',
    essayId: 'essay2',
    title: '第二篇作文',
  };
  (getScoreReport as jest.Mock).mockResolvedValueOnce(
    summarizeScores([zero, second]),
  );
  await render();
  expect(view.root.findByType(ScoreTrendChart).props.selectedId).toBe('score1');
  expect(
    StyleSheet.flatten(
      view.root
        .findAllByType(View)
        .find(node => node.props.testID === 'score-bar-score1')!.props.style,
    ).height,
  ).toBe(0);
  const column = view.root
    .findAllByType(Pressable)
    .find(node => node.props.accessibilityLabel?.startsWith('第二篇作文，'))!;
  act(() => column.props.onPress());
  expect(view.root.findByType(ScoreTrendChart).props.selectedId).toBe('score2');
  await press('打开作文 ›');
  expect(onOpenEssay).toHaveBeenCalledWith('essay2');
});

test('日历支持跨月选日、有效日期输入和硬件返回，不接受不存在的日期', async () => {
  const select = jest.fn();
  await act(async () => {
    view = create(
      <ReportDatePicker
        label="开始日期"
        value="2024-02-28"
        onSelect={select}
        onClose={onBack}
      />,
    );
  });
  await press('2024-02-29');
  await press('确定');
  expect(select).toHaveBeenCalledWith('2024-02-29');
  await press('下个月');
  await press('2024-03-01');
  await press('确定');
  expect(select).toHaveBeenLastCalledWith('2024-03-01');
  act(() => view.root.findByType(TextInput).props.onChangeText('2026-02-29'));
  await press('确定');
  expect(select).toHaveBeenCalledTimes(2);
  expect(text()).toContain('请输入有效日期');
  act(() => view.root.findByType(Modal).props.onRequestClose());
  expect(onBack).toHaveBeenCalledTimes(1);
});
