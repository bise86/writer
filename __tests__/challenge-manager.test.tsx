import React from 'react';
import {Alert, Pressable, Text} from 'react-native';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import ChallengeManager from '../src/components/ChallengeManager';
import {ChallengeRecord} from '../src/challenge/types';

const now = Date.parse('2026-11-11T12:00:00.000Z');
const base: ChallengeRecord = {
  id: 'challenge_one',
  title: '数学试卷',
  status: 'completed',
  sources: [],
  pageUris: [],
  level: 1,
  pages: [],
  calls: [],
  reviewRounds: [],
  progress: '已完成',
  error: '',
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
};
const onDelete = jest.fn(async (_ids: string[]) => undefined);
const onRefresh = jest.fn(async () => undefined);
const onBack = jest.fn();
const onOpen = jest.fn();
let view: ReactTestRenderer;

async function render(records = [base], protectedIds: string[] = []) {
  await act(async () => {
    view = create(
      <ChallengeManager
        records={records}
        protectedIds={protectedIds}
        loading={false}
        busy={false}
        error=""
        onBack={onBack}
        onRefresh={onRefresh}
        onOpen={onOpen}
        onDelete={onDelete}
      />,
    );
  });
}
const button = (title: string) =>
  view.root
    .findAllByType(Pressable)
    .find(node =>
      node.findAllByType(Text).some(child => child.props.children === title),
    )!;
const press = (title: string) =>
  act(async () => {
    await button(title).props.onPress();
  });
const confirmation = () =>
  (Alert.alert as jest.Mock).mock.calls.slice(-1)[0][2];
const confirm = (label = '删除') =>
  act(async () => {
    await confirmation()
      .find((value: {text: string}) => value.text === label)
      .onPress();
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  onDelete.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => view.unmount());
  jest.restoreAllMocks();
});

test('全选后只在确认时批量删除，补充页面依赖的原记录不参与选择', async () => {
  const second = {...base, id: 'challenge_two', title: '英语试卷'};
  const protectedRecord = {
    ...base,
    id: 'challenge_protected',
    title: '待补拍试卷',
  };
  await render([base, second, protectedRecord], [protectedRecord.id]);
  expect(button('删除已选（0）').props.disabled).toBe(true);
  await press('全选');
  expect(
    view.root
      .findAllByType(Pressable)
      .filter(node => node.props.accessibilityState?.checked),
  ).toHaveLength(2);
  await press('删除已选（2）');
  expect(onDelete).not.toHaveBeenCalled();
  expect(confirmation()[0].text).toBe('取消');
  await confirm();
  expect(onDelete).toHaveBeenCalledWith([base.id, second.id]);
  expect(button('删除已选（0）').props.disabled).toBe(true);
});

test.each([7, 30, 90])(
  '清理%d天前按创建时间筛选，保留边界、新记录与草稿依赖',
  async days => {
    const cutoff = now - days * 86400000;
    const old = {
      ...base,
      id: 'challenge_old',
      createdAt: new Date(cutoff - 1).toISOString(),
    };
    const boundary = {
      ...base,
      id: 'challenge_boundary',
      createdAt: new Date(cutoff).toISOString(),
    };
    const recent = {
      ...base,
      id: 'challenge_recent',
      createdAt: new Date(cutoff + 1).toISOString(),
    };
    const protectedRecord = {...old, id: 'challenge_protected'};
    await render(
      [old, boundary, recent, protectedRecord],
      [protectedRecord.id],
    );
    await press(`清理 ${days} 天前`);
    expect(onDelete).not.toHaveBeenCalled();
    await confirm('确认清理');
    expect(onDelete).toHaveBeenCalledWith([old.id]);
  },
);

test('离开管理页后忽略尚未确认的删除操作', async () => {
  await render();
  await press('全选');
  await press('删除已选（1）');
  const staleConfirm = confirmation().find(
    (value: {text: string}) => value.text === '删除',
  ).onPress;
  act(() => view.unmount());
  await act(async () => staleConfirm());
  expect(onDelete).not.toHaveBeenCalled();
});

test('重复确认不会重复删除，失败后显示原因并允许重试', async () => {
  let reject!: (error: Error) => void;
  onDelete.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await render();
  await press('全选');
  await press('删除已选（1）');
  const proceed = confirmation().find(
    (value: {text: string}) => value.text === '删除',
  ).onPress;
  let first!: Promise<void>;
  act(() => {
    first = proceed();
  });
  await act(async () => proceed());
  expect(onDelete).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('本机存储暂时不可用'));
    await first;
  });
  expect(Alert.alert).toHaveBeenLastCalledWith(
    '删除失败',
    '本机存储暂时不可用',
  );
  expect(button('删除已选（1）').props.disabled).toBe(false);
  await press('删除已选（1）');
  await confirm();
  expect(onDelete).toHaveBeenCalledTimes(2);
});
