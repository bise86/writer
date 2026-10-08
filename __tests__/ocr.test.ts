import {cloudOcr, reconcileOcr} from '../src/services/ocr';
import {parseJson, visionResponse} from '../src/services/openai';
import {DEFAULT_SETTINGS} from '../src/settings';

jest.mock('../src/services/openai', () => ({
  visionResponse: jest.fn(),
  parseJson: jest.fn(JSON.parse),
}));
beforeEach(() => {
  jest.clearAllMocks();
});
test('逐页独立识别、按顺序保留结果并实时报告，不混入本地乱码', async () => {
  (visionResponse as jest.Mock)
    .mockResolvedValueOnce({text: '{"text":"初春\\n第一段。"}'})
    .mockResolvedValueOnce({text: '{"text":"第二段。"}'});
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
    {},
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
});
