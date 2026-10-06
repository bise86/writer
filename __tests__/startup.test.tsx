import React from 'react';
import {ActivityIndicator, Pressable, Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import Startup from '../src/components/Startup';
import {getSettings, initDatabase, listEssays} from '../src/db/database';
import {DEFAULT_SETTINGS} from '../src/settings';

jest.mock('../src/db/database', () => ({
  initDatabase: jest.fn(),
  getSettings: jest.fn(),
  listEssays: jest.fn(),
}));

let view: TestRenderer.ReactTestRenderer;
const onReady = jest.fn(() => <Text>作文首页</Text>);

async function render() {
  await act(async () => {
    view = TestRenderer.create(<Startup>{onReady}</Startup>);
  });
}

function text() {
  return JSON.stringify(view.toJSON());
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  onReady.mockImplementation(() => <Text>作文首页</Text>);
  (initDatabase as jest.Mock).mockResolvedValue(undefined);
  (getSettings as jest.Mock).mockResolvedValue(DEFAULT_SETTINGS);
  (listEssays as jest.Mock).mockResolvedValue([]);
});

afterEach(() => {
  act(() => view?.unmount());
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('本地数据库、设置和记录准备好后进入首页，不等待网络', async () => {
  await render();
  expect(text()).toContain('作文首页');
  expect(onReady).toHaveBeenCalledWith({
    settings: DEFAULT_SETTINGS,
    essays: [],
  });
  expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(0);
});

test.each(['database', 'settings', 'essays'])(
  '%s 失败时显示原生错误，并可重试进入首页',
  async stage => {
    const fn = {
      database: initDatabase,
      settings: getSettings,
      essays: listEssays,
    }[stage]!;
    (fn as jest.Mock).mockRejectedValueOnce({
      message: '磁盘暂时不可用',
      code: 10,
    });
    await render();
    expect(text()).toContain('磁盘暂时不可用');
    expect(text()).toContain('重试启动');
    expect(onReady).not.toHaveBeenCalled();
    expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    await act(async () => view.root.findByType(Pressable).props.onPress());
    expect(text()).toContain('作文首页');
  },
);

test('数据库不返回时，15 秒后停止转圈，重试复用未完成的初始化', async () => {
  let finish!: () => void;
  (initDatabase as jest.Mock).mockImplementationOnce(
    () => new Promise<void>(resolve => (finish = resolve)),
  );
  await render();
  expect(text()).toContain('正在打开本地数据库');
  expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(15_000));
  expect(text()).toContain('超过 15 秒');
  expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  await act(async () => view.root.findByType(Pressable).props.onPress());
  expect(initDatabase).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(text()).toContain('作文首页');
});

test('读取记录卡住时准确显示阶段，迟到的成功结果仍可进入首页', async () => {
  let finish!: (essays: []) => void;
  (listEssays as jest.Mock).mockImplementationOnce(
    () => new Promise<[]>(resolve => (finish = resolve)),
  );
  await render();
  expect(text()).toContain('正在读取作文记录');
  await act(async () => jest.advanceTimersByTime(15_000));
  expect(text()).toContain('超过 15 秒');
  await act(async () => finish([]));
  expect(text()).toContain('作文首页');
});

test('离开启动页后，迟到的初始化结果不会更新已卸载页面', async () => {
  let finish!: () => void;
  (initDatabase as jest.Mock).mockImplementationOnce(
    () => new Promise<void>(resolve => (finish = resolve)),
  );
  await render();
  act(() => view.unmount());
  await act(async () => finish());
  expect(onReady).not.toHaveBeenCalled();
});
