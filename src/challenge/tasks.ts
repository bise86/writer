import {AppSettings} from '../types';
import {analyzeChallenge, upgradeChallenge} from './pipeline';
import {ChallengeLevel, ChallengeRecord} from './types';

export interface ChallengeTask {
  kind: 'analysis' | 'upgrade';
  level?: ChallengeLevel;
  signal: AbortSignal;
  record?: ChallengeRecord;
}
type RunningTask = ChallengeTask & {
  controller: AbortController;
  promise: Promise<ChallengeRecord>;
};
type Listener = (id: string, record?: ChallengeRecord) => void;

// Tasks belong to the app process, so navigation only detaches the view.
const tasks = new Map<string, RunningTask>();
const listeners = new Set<Listener>();

function emit(id: string, record?: ChallengeRecord) {
  for (const listener of listeners) {
    try {
      listener(id, record);
    } catch {
      // A view failure must not interrupt a model request or its persistence.
    }
  }
}

export function subscribeChallengeTasks(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getChallengeTask(id: string): ChallengeTask | undefined {
  return tasks.get(id);
}

export function cancelChallengeTask(id: string) {
  tasks.get(id)?.controller.abort();
}

export function startChallengeTask(
  id: string,
  kind: ChallengeTask['kind'],
  settings: AppSettings,
  level?: ChallengeLevel,
): Promise<ChallengeRecord> {
  const selectedLevel = kind === 'upgrade' ? level ?? 1 : undefined;
  const existing = tasks.get(id);
  if (existing) {
    return existing.kind === kind && existing.level === selectedLevel
      ? existing.promise
      : Promise.reject(new Error('这份试卷正在处理，请先停止或等待完成'));
  }
  const controller = new AbortController();
  const taskSettings = {...settings};
  const task: RunningTask = {
    kind,
    level: selectedLevel,
    signal: controller.signal,
    controller,
    // Defer starting until the task is registered, including synchronous errors.
    promise: Promise.resolve().then(() => {
      const options = {
        settings: taskSettings,
        signal: controller.signal,
        onUpdate: (record: ChallengeRecord) => {
          task.record = record;
          emit(id, record);
        },
      };
      return kind === 'analysis'
        ? analyzeChallenge(id, options)
        : upgradeChallenge(id, selectedLevel!, options);
    }),
  };
  tasks.set(id, task);
  emit(id);
  const finish = () => {
    if (tasks.get(id) === task) {
      tasks.delete(id);
      emit(id);
    }
  };
  // Register a rejection handler even after every screen has detached.
  task.promise.then(record => {
    task.record = record;
    emit(id, record);
    finish();
  }, finish);
  return task.promise;
}
