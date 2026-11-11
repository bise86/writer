import {analyzeChallenge, upgradeChallenge} from '../src/challenge/pipeline';
import {
  cancelChallengeTask,
  getChallengeTask,
  startChallengeTask,
  subscribeChallengeTasks,
} from '../src/challenge/tasks';
import {ChallengeRecord} from '../src/challenge/types';
import {DEFAULT_SETTINGS} from '../src/settings';

jest.mock('../src/challenge/pipeline', () => ({
  analyzeChallenge: jest.fn(),
  upgradeChallenge: jest.fn(),
}));

const record: ChallengeRecord = {
  id: 'challenge_background',
  title: '数学卷',
  status: 'analyzed',
  sources: [],
  pageUris: [],
  level: 1,
  pages: [],
  calls: [],
  reviewRounds: [],
  progress: '完成解析',
  error: '',
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {promise, resolve, reject};
}
beforeEach(() => {
  jest.clearAllMocks();
  (analyzeChallenge as jest.Mock).mockResolvedValue(record);
  (upgradeChallenge as jest.Mock).mockResolvedValue(record);
});

test('页面解绑后任务继续，重新订阅可读取已保存进度并收到完成事件', async () => {
  const pending = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  const firstView = jest.fn();
  const detach = subscribeChallengeTasks(firstView);
  const promise = startChallengeTask(record.id, 'analysis', DEFAULT_SETTINGS);
  await Promise.resolve();
  const options = (analyzeChallenge as jest.Mock).mock.calls[0][1];
  detach();
  firstView.mockClear();
  const progress = {
    ...record,
    status: 'analyzing',
    progress: '识别第3页',
  } as ChallengeRecord;
  options.onUpdate(progress);
  expect(firstView).not.toHaveBeenCalled();
  expect(options.signal.aborted).toBe(false);
  expect(getChallengeTask(record.id)?.record).toEqual(progress);
  const nextView = jest.fn();
  const detachNext = subscribeChallengeTasks(nextView);
  pending.resolve(record);
  await expect(promise).resolves.toEqual(record);
  expect(nextView).toHaveBeenCalledWith(record.id, record);
  expect(getChallengeTask(record.id)).toBeUndefined();
  expect(nextView).toHaveBeenLastCalledWith(record.id, undefined);
  detachNext();
});

test('同一任务去重，不同操作或档位不能在同一份试卷上重叠', async () => {
  const pending = deferred<ChallengeRecord>();
  (upgradeChallenge as jest.Mock).mockReturnValueOnce(pending.promise);
  const first = startChallengeTask(record.id, 'upgrade', DEFAULT_SETTINGS, 2);
  const duplicate = startChallengeTask(
    record.id,
    'upgrade',
    DEFAULT_SETTINGS,
    2,
  );
  expect(duplicate).toBe(first);
  await expect(
    startChallengeTask(record.id, 'analysis', DEFAULT_SETTINGS),
  ).rejects.toThrow('正在处理');
  await expect(
    startChallengeTask(record.id, 'upgrade', DEFAULT_SETTINGS, 3),
  ).rejects.toThrow('正在处理');
  expect(upgradeChallenge).toHaveBeenCalledTimes(1);
  pending.resolve(record);
  await first;
});

test('主动停止只取消对应试卷，其他试卷可以并行继续处理', async () => {
  const one = deferred<ChallengeRecord>();
  const two = deferred<ChallengeRecord>();
  (analyzeChallenge as jest.Mock)
    .mockReturnValueOnce(one.promise)
    .mockReturnValueOnce(two.promise);
  const first = startChallengeTask(record.id, 'analysis', DEFAULT_SETTINGS);
  const secondId = 'challenge_second';
  const second = startChallengeTask(secondId, 'analysis', DEFAULT_SETTINGS);
  await Promise.resolve();
  const firstSignal = getChallengeTask(record.id)!.signal;
  const secondSignal = getChallengeTask(secondId)!.signal;
  cancelChallengeTask(record.id);
  expect(firstSignal.aborted).toBe(true);
  expect(secondSignal.aborted).toBe(false);
  one.resolve({...record, status: 'cancelled'});
  two.resolve({...record, id: secondId});
  await Promise.all([first, second]);
  expect(getChallengeTask(record.id)).toBeUndefined();
  expect(getChallengeTask(secondId)).toBeUndefined();
});

test('请求失败后释放占用，允许使用同一份记录重试', async () => {
  (analyzeChallenge as jest.Mock).mockRejectedValueOnce(new Error('网络断开'));
  await expect(
    startChallengeTask(record.id, 'analysis', DEFAULT_SETTINGS),
  ).rejects.toThrow('网络断开');
  expect(getChallengeTask(record.id)).toBeUndefined();
  await expect(
    startChallengeTask(record.id, 'analysis', DEFAULT_SETTINGS),
  ).resolves.toEqual(record);
  expect(analyzeChallenge).toHaveBeenCalledTimes(2);
});

test('任务保留启动时的模型与圆桌设置，不受设置页面后续修改影响', async () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    modelName: 'original-model',
    roundtableSize: 5 as const,
  };
  const promise = startChallengeTask(record.id, 'upgrade', settings, 3);
  settings.modelName = 'changed-model';
  await promise;
  expect(upgradeChallenge).toHaveBeenCalledWith(
    record.id,
    3,
    expect.objectContaining({
      settings: expect.objectContaining({
        modelName: 'original-model',
        roundtableSize: 5,
      }),
    }),
  );
});

test('页面监听回调抛错不会中断模型任务或阻止完成清理', async () => {
  (analyzeChallenge as jest.Mock).mockImplementationOnce(
    async (_id, options) => {
      options.onUpdate(record);
      return record;
    },
  );
  const detach = subscribeChallengeTasks(() => {
    throw new Error('页面已关闭');
  });
  await expect(
    startChallengeTask(record.id, 'analysis', DEFAULT_SETTINGS),
  ).resolves.toEqual(record);
  expect(getChallengeTask(record.id)).toBeUndefined();
  detach();
});
