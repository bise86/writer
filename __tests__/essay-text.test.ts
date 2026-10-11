import {
  essayParagraphs,
  essaySections,
  normalizeSavedParagraphReviews,
  recognizedTitle,
  sectionLabel,
} from '../src/services/essay-text';
import {ScoreResult} from '../src/types';

const savedScore: ScoreResult = {
  score: 60,
  bandId: 'pass',
  dimensionScores: {},
  summary: '总评',
  strengths: [],
  weaknesses: [],
  improvements: [],
  suggestions: [],
  annotations: [],
};

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

test('无标题英文首段的句点不能导致正文被当作标题或丢失编号', () => {
  const text = 'I went home.\n\nI helped my mother.';
  expect(recognizedTitle(text)).toBe('');
  expect(essaySections(text).map(sectionLabel)).toEqual(['第 1 段', '第 2 段']);
  expect(essayParagraphs(text)[0].text).toBe('I went home.');
  expect(recognizedTitle('Title: Mr. Green\n\nHe is my teacher.')).toBe('Mr. Green');
});

test('旧版单换行英文标题保持标题和正文评价对应', () => {
  const text = 'My Day\nI went home.';
  expect(recognizedTitle(text)).toBe('My Day');
  expect(essaySections(text).map(sectionLabel)).toEqual(['标题', '第 1 段']);
  const saved = {...savedScore, paragraphIndexing: 'body-v1' as const,
    titleFeedback: {strengths: ['标题评价'], weaknesses: [], improvements: ['保留标题']},
    paragraphReviews: [{paragraphIndex: 1, strengths: ['正文评价'], weaknesses: [], improvements: ['补充动作']}],
  };
  const normalized = normalizeSavedParagraphReviews(saved, text);
  expect(normalized.titleFeedback?.strengths).toEqual(['标题评价']);
  expect(normalized.paragraphReviews?.[0].strengths).toEqual(['正文评价']);
});

test('旧称呼评价缺失时迁移只能发生一次，不会在第二次规范化时吞掉正文', () => {
  const text = 'Dear Tom,\n\nI went home.';
  const saved = {...savedScore, paragraphReviews: [
    {paragraphIndex: 2, strengths: ['正文评价'], weaknesses: [], improvements: ['补充动作']},
  ]};
  const first = normalizeSavedParagraphReviews(saved, text);
  const second = normalizeSavedParagraphReviews(first, text);
  expect(second).toBe(first);
  expect(second.paragraphReviews?.[0]).toMatchObject({paragraphIndex: 1, strengths: ['正文评价']});
  expect(second.salutationFeedback).toBeUndefined();
});

test('段落索引保留原文位置，供评分批注定位', () => {
  const original = '第一段。\n\n第二段。';
  const result = essayParagraphs(original);
  expect(result.map(item => item.index)).toEqual([1, 2]);
  expect(original.slice(result[1].start, result[1].end)).toBe('第二段。');
});

test('标题单列，正文从第 1 段开始，所有部分保持原文位置和全文', () => {
  const text =
    '【第 1 页】\r\n  《春天的发现》  \r\n\r\n  我看见了嫩芽。\r\n【第 2 页】\r\n  我走向河边。';
  const sections = essaySections(text);
  expect(sections.map(sectionLabel)).toEqual(['标题', '第 1 段', '第 2 段']);
  expect(essayParagraphs(text).map(item => item.text)).toEqual([
    '我看见了嫩芽。',
    '我走向河边。',
  ]);
  sections.forEach(section => {
    expect(text.slice(section.start, section.end)).toBe(section.text);
  });
});

test('无标题作文的首段不能被跳过或重新编号', () => {
  const text = '清晨，我推开窗。\n我看见了嫩芽。';
  expect(essaySections(text).map(sectionLabel)).toEqual(['第 1 段', '第 2 段']);
  expect(
    essayParagraphs(text)
      .map(item => item.text)
      .join('\n'),
  ).toBe(text);
});

test('旧评分的标题评价和正文评价正确对应，不改写或丢弃旧记录', () => {
  const reviews = ['标题评价', '第一段评价', '第二段评价'].map((value, i) => ({
    paragraphIndex: i + 1,
    strengths: [value],
    weaknesses: [],
    improvements: ['具体建议'],
  }));
  const stored: ScoreResult = {...savedScore, paragraphReviews: reviews};
  const snapshot = JSON.stringify(stored);
  const adapted = normalizeSavedParagraphReviews(
    stored,
    '春天\n第一段。\n第二段。',
  );
  expect(adapted.titleFeedback?.strengths).toEqual(['标题评价']);
  expect(
    adapted.paragraphReviews?.map(item => [
      item.paragraphIndex,
      item.strengths[0],
    ]),
  ).toEqual([
    [1, '第一段评价'],
    [2, '第二段评价'],
  ]);
  expect(JSON.stringify(stored)).toBe(snapshot);
  expect(
    normalizeSavedParagraphReviews(adapted, '春天\n第一段。\n第二段。'),
  ).toBe(adapted);
});

test('旧评分包含称呼时迁移称呼评价，新版编号不误删正文首段', () => {
  const old: ScoreResult = {
    ...savedScore,
    paragraphReviews: [
      {paragraphIndex: 1, strengths: ['称呼'], weaknesses: [], improvements: ['称呼建议']},
      {paragraphIndex: 2, strengths: ['正文'], weaknesses: [], improvements: ['正文建议']},
    ],
  };
  const migrated = normalizeSavedParagraphReviews(old, 'Dear Tom,\n\nI went home.');
  expect(migrated.salutationFeedback?.strengths).toEqual(['称呼']);
  expect(migrated.paragraphReviews?.[0].strengths).toEqual(['正文']);
  const oldBody = normalizeSavedParagraphReviews({...old, paragraphIndexing: 'body-v1'}, 'Dear Tom,\n\nI went home.');
  expect(oldBody.salutationFeedback?.strengths).toEqual(['称呼']);
  expect(oldBody.paragraphReviews?.[0].paragraphIndex).toBe(1);
  expect(normalizeSavedParagraphReviews(oldBody, 'Dear Tom,\n\nI went home.')).toBe(oldBody);
  const alreadyBody = normalizeSavedParagraphReviews(
    {...old, paragraphIndexing: 'body-v2', paragraphReviews: [{paragraphIndex: 1, strengths: ['正文'], weaknesses: [], improvements: ['正文建议']} ]},
    'Dear Tom,\n\nI went home.',
  );
  expect(alreadyBody.paragraphReviews?.[0].strengths).toEqual(['正文']);
  expect(alreadyBody.salutationFeedback).toBeUndefined();
});

test('没有标题的旧记录保持原有段落编号', () => {
  const stored: ScoreResult = {
    ...savedScore,
    paragraphReviews: [
      {
        paragraphIndex: 1,
        strengths: ['正文评价'],
        weaknesses: [],
        improvements: ['具体建议'],
      },
    ],
  };
  const adapted = normalizeSavedParagraphReviews(stored, '我看见了嫩芽。');
  expect(adapted.paragraphReviews).toEqual(stored.paragraphReviews);
  expect(adapted.titleFeedback).toBeUndefined();
});
