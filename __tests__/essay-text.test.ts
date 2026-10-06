import {essayParagraphs, recognizedTitle} from '../src/services/essay-text';

test('从 OCR 首行识别标题并忽略多页标记', () => {
  expect(recognizedTitle('【第 1 页】\n《雨中的等待》\n我站在窗前。')).toBe(
    '雨中的等待',
  );
  expect(recognizedTitle('【第 1 页】\n题目：第一次学会等待\n正文')).toBe(
    '第一次学会等待',
  );
});

test('没有明确标题时不把带句号的正文误当作文标题', () => {
  expect(recognizedTitle('【第 1 页】\n我站在窗前，看着雨慢慢落下。')).toBe('');
});

test('段落索引保留原文位置，供评分批注定位', () => {
  const result = essayParagraphs('第一段\n\n第二段');
  expect(result.map(item => item.index)).toEqual([1, 2]);
  expect('第一段\n\n第二段'.slice(result[1].start, result[1].end)).toBe(
    '第二段',
  );
});
