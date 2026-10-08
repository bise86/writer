import {DEFAULT_SETTINGS} from '../src/settings';
import {AppSettings} from '../src/types';

const mockExecute = jest.fn();
jest.mock('react-native-sqlite-storage', () => ({
  enablePromise: jest.fn(),
  openDatabase: jest.fn(async () => ({executeSql: mockExecute})),
}));
jest.mock('react-native-fs', () => ({}));

let stored: Record<string, string>;
let version: number;
let essayColumns: string[];
let essayRows: {id: string; image_uri: string; image_uris?: string}[];
let reviewStates: Record<string, string>;
let database: typeof import('../src/db/database');

function result(items: object[]) {
  return [
    {rows: {length: items.length, item: (index: number) => items[index]}},
  ];
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  stored = {};
  version = 0;
  essayColumns = [];
  essayRows = [];
  reviewStates = {};
  mockExecute.mockImplementation(
    async (sql: string, parameters: string[] = []) => {
      if (sql.startsWith('INSERT OR REPLACE INTO roundtable_sessions')) {
        reviewStates[parameters[0]] = parameters[1];
      } else if (sql.startsWith('SELECT state_json FROM roundtable_sessions')) {
        return result(
          reviewStates[parameters[0]]
            ? [{state_json: reviewStates[parameters[0]]}]
            : [],
        );
      } else if (sql === 'DELETE FROM roundtable_sessions WHERE essay_id = ?') {
        delete reviewStates[parameters[0]];
      }
      if (sql.includes('CREATE TABLE IF NOT EXISTS essays')) {
        if (!essayColumns.length) {
          essayColumns = ['id', 'image_uri', 'image_uris'];
        }
      } else if (sql === 'PRAGMA table_info(essays)') {
        return result(essayColumns.map(name => ({name})));
      } else if (sql.startsWith('ALTER TABLE essays ADD COLUMN image_uris')) {
        if (essayColumns.includes('image_uris')) {
          // Android's native SQLite bridge rejects with an object, not Error.
          throw {message: 'duplicate column name: image_uris', code: 1};
        }
        essayColumns.push('image_uris');
        essayRows.forEach(item => (item.image_uris = '[]'));
      } else if (sql.startsWith('SELECT id, image_uri FROM essays')) {
        return result(
          essayRows.filter(
            item => !item.image_uris || item.image_uris === '[]',
          ),
        );
      } else if (sql.startsWith('UPDATE essays SET image_uris')) {
        const item = essayRows.find(value => value.id === parameters[1]);
        if (item) {
          item.image_uris = parameters[0];
        }
      }
      if (sql === 'PRAGMA user_version') {
        return result([{user_version: version}]);
      }
      if (sql.startsWith('PRAGMA user_version = ')) {
        version = Number(sql.split(' = ')[1]);
      } else if (sql === 'SELECT key, value FROM settings') {
        return result(
          Object.entries(stored).map(([key, value]) => ({key, value})),
        );
      } else if (sql.startsWith('DELETE FROM settings WHERE key')) {
        delete stored[parameters[0]];
      } else if (sql.startsWith('UPDATE settings SET value')) {
        if (parameters.length < 3 || stored[parameters[1]] === parameters[2]) {
          stored[parameters[1]] = parameters[0];
        }
      } else if (sql.startsWith('INSERT OR IGNORE INTO settings')) {
        if (!(parameters[0] in stored)) {
          stored[parameters[0]] = parameters[1];
        }
      } else if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
        stored[parameters[0]] = parameters[1];
      }
      return result([]);
    },
  );
  database = require('../src/db/database');
});

test('新安装只有一个模型配置', async () => {
  expect(await database.getSettings()).toEqual(DEFAULT_SETTINGS);
  expect(stored).not.toHaveProperty('visionModelName');
  expect(version).toBe(5);
});

test('已有安装升级默认关闭圆桌，并创建可恢复的评审状态表', async () => {
  version = 5;
  stored = {modelName: 'existing-model'};
  expect((await database.getSettings()).roundtableSize).toBe(0);
  expect(mockExecute).toHaveBeenCalledWith(
    expect.stringContaining('CREATE TABLE IF NOT EXISTS roundtable_sessions'),
  );
});

test.each([0, 3, 5] as const)(
  '圆桌人数 %s 保存到 SQLite 并恢复',
  async roundtableSize => {
    await database.saveSettings({...DEFAULT_SETTINGS, roundtableSize});
    expect((await database.getSettings()).roundtableSize).toBe(roundtableSize);
  },
);

test('非法人数不覆盖已保存的圆桌设置', async () => {
  await database.saveSettings({...DEFAULT_SETTINGS, roundtableSize: 5});
  await expect(
    database.saveSettings({
      ...DEFAULT_SETTINGS,
      roundtableSize: 4,
    } as unknown as AppSettings),
  ).rejects.toThrow('0、3 或 5');
  expect((await database.getSettings()).roundtableSize).toBe(5);
});

test('圆桌状态跨数据库连接恢复，删除作文同步删除其状态', async () => {
  const state = {
    nextRound: 1,
    exchanges: {'vote:0:content': [{output: 'stored vote', feedback: ''}]},
  };
  await database.saveRoundtableState('essay-1', state);
  await database.saveRoundtableState('essay-2', state);
  jest.resetModules();
  database = require('../src/db/database');
  expect(await database.getRoundtableState('essay-1')).toEqual(state);
  await database.deleteEssay('essay-1');
  expect(await database.getRoundtableState('essay-1')).toBeUndefined();
  expect(await database.getRoundtableState('essay-2')).toEqual(state);
  await database.clearRoundtableState('essay-2');
  expect(await database.getRoundtableState('essay-2')).toBeUndefined();
});

test('启动把中断的流程变为可重试，保留评分与圆桌上下文；不会在每次读取时重置', async () => {
  await database.initDatabase();
  const recoveries = mockExecute.mock.calls.filter(([sql]) =>
    sql.startsWith("UPDATE essays SET status = 'failed'"),
  );
  expect(recoveries).toHaveLength(1);
  expect(recoveries[0][0]).toContain(
    "WHERE status IN ('queued', 'local_ocr', 'vision_ocr', 'reconcile', 'scoring')",
  );
  expect(recoveries[0][0]).not.toContain('score_json');
  expect(recoveries[0][1][0]).toContain('从已保存的进度继续');
  expect(
    mockExecute.mock.calls.some(([sql]) =>
      sql.includes("WHERE status = 'running' AND essay_id IN"),
    ),
  ).toBe(true);
  expect(
    mockExecute.mock.calls.some(([sql]) =>
      sql.startsWith('DELETE FROM roundtable_sessions'),
    ),
  ).toBe(false);
  await database.getSettings();
  await database.initDatabase();
  expect(
    mockExecute.mock.calls.filter(([sql]) =>
      sql.startsWith("UPDATE essays SET status = 'failed'"),
    ),
  ).toHaveLength(1);
});

test('已有安装删除独立 OCR 设置，保留用户自定义主模型和密钥', async () => {
  version = 1;
  stored = {
    modelName: 'my-multimodal-model',
    visionModelName: 'old-ocr-model',
    apiKey: 'existing-key',
    reasoningEffort: 'none',
  };
  const settings = await database.getSettings();
  expect(settings.modelName).toBe('my-multimodal-model');
  expect(settings.apiKey).toBe('existing-key');
  expect(settings.reasoningEffort).toBe('none');
  expect(settings).not.toHaveProperty('visionModelName');
  expect(stored).not.toHaveProperty('visionModelName');
  expect(version).toBe(5);
});

test('最早的安装先迁移默认值，再删除旧 OCR 设置', async () => {
  stored = {
    modelName: 'gpt-5.5',
    visionModelName: 'gpt-4.1-mini',
    apiBaseUrl: 'https://api.openai.com/v1',
    reasoningEffort: 'medium',
  };
  expect(await database.getSettings()).toMatchObject({
    modelName: 'deepseek-flash',
    reasoningEffort: 'high',
    apiBaseUrl: 'https://api.deepseek.com',
  });
  expect(stored).not.toHaveProperty('visionModelName');
});

test('保存并读取关闭思考和数值设置，不再写入独立 OCR 模型', async () => {
  await database.saveSettings({
    ...DEFAULT_SETTINGS,
    modelName: 'shared-model',
    reasoningEffort: 'none',
    retryCount: '0',
    visionModelName: 'ignored-model',
  } as unknown as AppSettings);
  const loaded = await database.getSettings();
  expect(loaded.modelName).toBe('shared-model');
  expect(loaded.reasoningEffort).toBe('none');
  expect(loaded.retryCount).toBe(0);
  expect(stored).not.toHaveProperty('visionModelName');
});

test('非法设置不会写入 SQLite', async () => {
  await database.initDatabase();
  const snapshot = {...stored};
  await expect(
    database.saveSettings({...DEFAULT_SETTINGS, contextWindow: NaN}),
  ).rejects.toThrow();
  expect(stored).toEqual(snapshot);
});

test('升级不会把自定义 GPT 模型配到新的默认服务商', async () => {
  stored = {
    modelName: 'gpt-4.1',
    apiBaseUrl: 'https://api.openai.com/v1',
    contextWindow: '128000',
  };
  const loaded = await database.getSettings();
  expect(loaded.modelName).toBe('gpt-4.1');
  expect(loaded.apiBaseUrl).toBe('https://api.openai.com/v1');
  expect(loaded.contextWindow).toBe(128000);
});

test('旧版单页作文升级后保留原图，不重复添加已经存在的列', async () => {
  version = 2;
  essayColumns = ['id', 'image_uri'];
  essayRows = [{id: 'old-essay', image_uri: 'file:///旧作文.jpg'}];
  await database.initDatabase();
  expect(version).toBe(5);
  expect(JSON.parse(essayRows[0].image_uris!)).toEqual(['file:///旧作文.jpg']);
  expect(essayColumns.filter(name => name === 'image_uris')).toHaveLength(1);
});

test('中断过的迁移按实际表结构继续，保留已经保存的多页图片', async () => {
  version = 2;
  essayColumns = ['id', 'image_uri', 'image_uris'];
  const images = JSON.stringify(['file:///1.jpg', 'file:///2.jpg']);
  essayRows = [
    {id: 'new-essay', image_uri: 'file:///1.jpg', image_uris: images},
    {id: 'old-essay', image_uri: 'file:///3.jpg', image_uris: '[]'},
  ];
  await database.initDatabase();
  expect(version).toBe(5);
  expect(essayRows[0].image_uris).toBe(images);
  expect(JSON.parse(essayRows[1].image_uris!)).toEqual(['file:///3.jpg']);
});

test('升级时把未修改的旧默认 5K 改为 32K，保留用户自定义输出长度', async () => {
  version = 3;
  stored = {maxOutputTokens: '5000'};
  await database.initDatabase();
  expect(version).toBe(5);
  expect(stored.maxOutputTokens).toBe('32000');

  jest.resetModules();
  version = 3;
  stored = {maxOutputTokens: '8192'};
  database = require('../src/db/database');
  await database.initDatabase();
  expect(version).toBe(5);
  expect(stored.maxOutputTokens).toBe('8192');
});

test('数据库操作失败后允许重新初始化，不永久缓存失败状态', async () => {
  const error = {message: 'database is locked', code: 5};
  mockExecute.mockRejectedValueOnce(error);
  await expect(database.initDatabase()).rejects.toEqual(error);
  await expect(database.initDatabase()).resolves.toBeUndefined();
  expect(version).toBe(5);
});
