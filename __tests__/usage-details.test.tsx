import React from 'react';
import {Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import UsageDetails from '../src/components/UsageDetails';
import {getEssayUsage} from '../src/db/database';
import {emptyUsage} from '../src/db/statistics';
import {parseUsage} from '../src/services/usage';
import {EssayUsage} from '../src/types';

jest.mock('../src/db/database', () => ({getEssayUsage: jest.fn()}));
let view: ReactTestRenderer;
let usage: EssayUsage;
const text = () =>
  view.root
    .findAllByType(Text)
    .map(item => item.props.children)
    .flat()
    .join('');
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  usage = {total: emptyUsage(), stages: {}, calls: []};
  (getEssayUsage as jest.Mock).mockImplementation(async () => usage);
});
afterEach(() => {
  act(() => view.unmount());
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
async function render() {
  await act(async () => {
    view = create(<UsageDetails essayId="1" />);
  });
}
test('消耗详情实时累计失败后的重试，明确显示未知缓存字段及逐次状态时间', async () => {
  await render();
  expect(text()).toContain('暂无调用记录');
  const partial = {
    ...emptyUsage(),
    ...parseUsage({input_tokens: 100, output_tokens: 20}),
    callCount: 2,
    failedCount: 1,
    missing: {...emptyUsage().missing, inputTokens: 1, cacheWriteTokens: 2},
  };
  usage = {
    total: partial,
    stages: {scoring: partial},
    calls: [
      {
        id: '1',
        runId: 'run',
        stage: 'scoring',
        operation: 'response',
        model: 'test-model',
        status: 'failed',
        startedAt: '2026-10-09T01:00:00Z',
        finishedAt: '2026-10-09T01:00:01Z',
        durationMs: 1000,
        responseId: null,
        httpStatus: 503,
        measuredInputTokens: null,
        rawUsageJson: null,
        ...parseUsage(undefined),
      },
    ],
  };
  await act(async () => {
    jest.advanceTimersByTime(1200);
  });
  expect(text()).toContain('实际调用 2 次');
  expect(text()).toContain('另 1 次未返回');
  expect(text()).toContain('缓存写入：未返回');
  act(() => view.root.findByType(Pressable).props.onPress());
  expect(text()).toContain('test-model');
  expect(text()).toContain('请求失败');
  expect(text()).toContain('开始：');
  expect(text()).toContain('结束：');
});
test('数据库暂时读取失败可恢复，切换作文不展示上一篇的统计', async () => {
  (getEssayUsage as jest.Mock).mockRejectedValueOnce(new Error('locked'));
  await render();
  expect(text()).toContain('读取失败');
  await act(async () => {
    jest.advanceTimersByTime(1200);
  });
  expect(text()).not.toContain('读取失败');
  await act(async () => {
    view.update(<UsageDetails essayId="2" />);
  });
  expect(getEssayUsage).toHaveBeenLastCalledWith('2');
  expect(text()).toContain('暂无调用记录');
});
