import {cloudOcr, reconcileOcr} from '../src/services/ocr';
import {parseJson, visionResponse} from '../src/services/openai';
import {DEFAULT_SETTINGS} from '../src/settings';

jest.mock('../src/services/openai', () => ({
  visionResponse: jest.fn(),
  parseJson: jest.fn(jest.requireActual('../src/services/openai').parseJson),
}));
jest.mock('react-native-fs', () => ({}));
beforeEach(() => {
  jest.clearAllMocks();
});
test('逐页独立识别、按顺序保留结果并实时报告，不混入本地乱码', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '初春\n第一段。'})
    .mockResolvedValueOnce({text: '第二段。'});
  const onPage = jest.fn();
  const result = await cloudOcr(['page1', 'page2'], DEFAULT_SETTINGS, {onPage});
  expect((visionResponse as jest.Mock).mock.calls.map(call => call[0])).toEqual(
    ['page1', 'page2'],
  );
  expect(result.text).toBe(
    '【第 1 页】\n初春\n第一段。\n\n【第 2 页】\n第二段。',
  );
  expect(onPage).toHaveBeenCalledTimes(2);
  expect(onPage.mock.calls[0][0]).not.toContain('第二段');
  expect(result).not.toHaveProperty('confidence');
});
test('任何一页无可读文字时都失败，不跳过缺页', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '{"text":"第一页"}'})
    .mockResolvedValueOnce({text: '{"text":""}'});
  await expect(cloudOcr(['page1', 'page2'], DEFAULT_SETTINGS)).rejects.toThrow(
    '未从图片识别到作文',
  );
});
test('复核把原照片和初稿一起传给视觉模型，保留学生原有错字', async () => {
  (visionResponse as jest.Mock).mockResolvedValue({
    text: '{"text":"正确标题\\n原文。","corrections":"标题识别更正"}',
  });
  const result = await reconcileOcr(
    ['page1', 'page2'],
    '错误标题\n原文。',
    DEFAULT_SETTINGS,
  );
  expect(visionResponse).toHaveBeenCalledWith(
    ['page1', 'page2'],
    expect.stringContaining('错误标题'),
    DEFAULT_SETTINGS,
    expect.objectContaining({
      history: [],
      textFormat: expect.objectContaining({type: 'json_schema', strict: true}),
    }),
  );
  expect((visionResponse as jest.Mock).mock.calls[0][1]).toContain(
    '不要纠正学生原本的语病或错别字',
  );
  expect(result.text).toContain('正确标题');
});
test('复核 JSON 缺失字段会失败，不能保存伪成功', async () => {
  (visionResponse as jest.Mock).mockResolvedValue({text: '{"text":"正文"}'});
  await expect(
    reconcileOcr(['page'], '正文', DEFAULT_SETTINGS),
  ).rejects.toThrow('复核说明');
  expect(parseJson).toHaveBeenCalled();
  expect(visionResponse).toHaveBeenCalledTimes(3);
});

test.each([
  '初春\n他说：“春天来了。”\n第二段。',
  '```text\n初春\n他说：“春天来了。”\n第二段。\n```',
  JSON.stringify({text: '初春\n他说：“春天来了。”\n第二段。'}),
  '```json\n' +
    JSON.stringify({text: '初春\n他说：“春天来了。”\n第二段。'}) +
    '\n```',
  '```\n' +
    JSON.stringify({text: '初春\n他说：“春天来了。”\n第二段。'}) +
    '\n```',
])('逐页识别兼容原文、代码块和已有 JSON 包装：%s', async output => {
  (visionResponse as jest.Mock).mockResolvedValue({text: output});
  const result = await cloudOcr('page', DEFAULT_SETTINGS);
  expect(result.text).toBe('【第 1 页】\n初春\n他说：“春天来了。”\n第二段。');
  expect(visionResponse).toHaveBeenCalledTimes(1);
});

test('复核格式错误时保留原图、初稿和上轮回复追加纠正，不改写原文', async () => {
  const malformed = '{"text":"春天\n花开了。","corrections":"已核对"}';
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: malformed})
    .mockResolvedValueOnce({
      text: JSON.stringify({text: '春天\n花开了。', corrections: '已核对原图'}),
    });
  const onProgress = jest.fn();
  const history = [{role: 'user' as const, content: '历史参考'}];
  const result = await reconcileOcr(
    ['one', 'two'],
    '春夭\n花开了。',
    {...DEFAULT_SETTINGS, retryCount: 0},
    {history, onProgress},
  );
  expect(result.text).toBe('春天\n花开了。');
  const [first, second] = (visionResponse as jest.Mock).mock.calls;
  expect(second[0]).toEqual(['one', 'two']);
  expect(second[1]).toContain('春夭');
  expect(second[1]).toContain('上一轮格式校验反馈');
  expect(second[3].history).toEqual([
    ...history,
    {role: 'assistant', content: malformed},
    {role: 'user', content: expect.stringContaining('格式校验未通过')},
  ]);
  expect(first[3].history).toEqual(history);
  expect(history).toHaveLength(1);
  expect(onProgress).toHaveBeenCalledWith(
    expect.stringContaining('第 2 轮纠正'),
  );
});

test('复核缺少说明会要求补齐，不能将不完整结果当成功', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '{"text":"原文"}'})
    .mockResolvedValueOnce({
      text: '{"text":"原文","corrections":"已逐页核实"}',
    });
  await expect(
    reconcileOcr(['page'], '原文', DEFAULT_SETTINGS),
  ).resolves.toEqual({
    text: '原文',
    corrections: '已逐页核实',
  });
  expect((visionResponse as jest.Mock).mock.calls[1][1]).toContain(
    'corrections',
  );
});

test('坏 JSON 不作为作文存储，格式纠正有上限且保留已完成页面', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '第一页原文'})
    .mockResolvedValue({text: '{"text":"未闭合'});
  const onPage = jest.fn();
  await expect(
    cloudOcr(['one', 'two'], DEFAULT_SETTINGS, {onPage}),
  ).rejects.toThrow('第 2 页图片识别连续 3 轮格式校验未通过');
  expect(onPage.mock.calls).toEqual([['【第 1 页】\n第一页原文']]);
  expect(visionResponse).toHaveBeenCalledTimes(4);
});

test('一页的格式纠正历史不会混入下一页', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '{"text":123}'})
    .mockResolvedValueOnce({text: '第一页'})
    .mockResolvedValueOnce({text: '第二页'});
  await cloudOcr(['one', 'two'], DEFAULT_SETTINGS);
  expect((visionResponse as jest.Mock).mock.calls[2][3].history).toEqual([]);
});

test('明确无法辨认时立即说明原因，不反复要求模型猜测文字', async () => {
  (visionResponse as jest.Mock).mockResolvedValue({text: '【未识别到作文】'});
  await expect(cloudOcr('page', DEFAULT_SETTINGS)).rejects.toThrow(
    '未从图片识别到作文',
  );
  expect(visionResponse).toHaveBeenCalledTimes(1);
});

test('网络或截断错误不触发格式纠正，也不掩盖原始错误', async () => {
  (visionResponse as jest.Mock).mockRejectedValue(new Error('模型输出被截断'));
  await expect(
    reconcileOcr(['page'], '原文', DEFAULT_SETTINGS),
  ).rejects.toThrow('被截断');
  expect(visionResponse).toHaveBeenCalledTimes(1);
});

test('格式纠正可取消，取消后不会继续请求模型', async () => {
  const controller = new AbortController();
  (visionResponse as jest.Mock).mockResolvedValue({text: '不是 JSON'});
  await expect(
    reconcileOcr(['page'], '原文', DEFAULT_SETTINGS, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toThrow('已停止');
  expect(visionResponse).toHaveBeenCalledTimes(1);
});

test('最终失败信息包含模型返回片段，但不泄露密钥', async () => {
  const settings = {...DEFAULT_SETTINGS, apiKey: 'test-credential'};
  (visionResponse as jest.Mock).mockResolvedValue({
    text: 'test-credential 模型解释',
  });
  await expect(reconcileOcr(['page'], '原文', settings)).rejects.toThrow(
    '最后回复：[已隐藏密钥] 模型解释',
  );
});

test('逐页识别和原图复核都按版面分段，复核后的段界原样保留', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '春天\n\n第一段的上半句'})
    .mockResolvedValueOnce({text: '接着写完。\n\n第二段。'})
    .mockResolvedValueOnce({
      text: JSON.stringify({
        text: '春天\n\n第一段的上半句接着写完。\n\n第二段。',
        corrections:
          '正文共 2 段。第 2 页首行为续段，合并第 1 段跨页文字；其后的缩进段首单独保留。',
      }),
    });
  const draft = await cloudOcr(['one', 'two'], DEFAULT_SETTINGS);
  const result = await reconcileOcr(
    ['one', 'two'],
    draft.text,
    DEFAULT_SETTINGS,
  );
  expect(result.text.split('\n\n')).toEqual([
    '春天',
    '第一段的上半句接着写完。',
    '第二段。',
  ]);
  for (const call of (visionResponse as jest.Mock).mock.calls) {
    expect(call[1]).toContain('段首缩进');
    expect(call[1]).toContain('段内不插入换行');
    expect(call[1]).toContain('不要按文意');
  }
  const reviewPrompt = (visionResponse as jest.Mock).mock.calls[2][1];
  expect(reviewPrompt).toContain('确认是同一自然段才无换行拼接');
  expect(reviewPrompt).toContain('正文段数');
  expect(reviewPrompt).toContain('无法确定的段界');
});
