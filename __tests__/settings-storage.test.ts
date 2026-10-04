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
  mockExecute.mockImplementation(
    async (sql: string, parameters: string[] = []) => {
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
        stored[parameters[1]] = parameters[0];
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
  expect(version).toBe(2);
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
  expect(version).toBe(2);
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
