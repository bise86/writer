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
  mockExecute.mockImplementation(
    async (sql: string, parameters: string[] = []) => {
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
  expect(version).toBe(3);
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
  expect(version).toBe(3);
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
  expect(version).toBe(3);
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
  expect(version).toBe(3);
  expect(essayRows[0].image_uris).toBe(images);
  expect(JSON.parse(essayRows[1].image_uris!)).toEqual(['file:///3.jpg']);
});

test('数据库操作失败后允许重新初始化，不永久缓存失败状态', async () => {
  const error = {message: 'database is locked', code: 5};
  mockExecute.mockRejectedValueOnce(error);
  await expect(database.initDatabase()).rejects.toEqual(error);
  await expect(database.initDatabase()).resolves.toBeUndefined();
  expect(version).toBe(3);
});
