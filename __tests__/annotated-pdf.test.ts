import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  buildAnnotatedPdf,
  locateAnnotations,
  wrapPdfText,
} from '../src/services/annotated-pdf';
import {ScoreResult} from '../src/types';
import {writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

const score: ScoreResult = {
  score: 80,
  bandId: 'high',
  summary: '中心明确',
  dimensionScores: {},
  strengths: [],
  weaknesses: [],
  improvements: [],
  suggestions: [],
  annotations: [
    {
      quote: '雨声',
      type: 'strength',
      comment: '以声音带出环境',
      suggestion: '保留细节，并联系心情',
    },
    {
      quote: '我很难过',
      type: 'improvement',
      comment: '情绪表达较笼统',
      suggestion: '用具体动作表现难过',
    },
  ],
  paragraphReviews: [
    {
      paragraphIndex: 1,
      strengths: ['有具体声音'],
      weaknesses: ['情绪尚不够具体'],
      improvements: ['补充动作'],
    },
    {
      paragraphIndex: 2,
      strengths: ['结尾有变化'],
      weaknesses: [],
      improvements: ['联系开头的雨声'],
    },
  ],
};

test('换行保留中文与代理对字符的位置，不丢失或拆坏原文', () => {
  const text = '甲乙𠀀丙丁';
  const lines = wrapPdfText(text, 2, value => Array.from(value).length, 5);
  expect(lines.map(item => item.text).join('')).toBe(text);
  lines.forEach(line =>
    expect(text.slice(line.start - 5, line.end - 5)).toBe(line.text),
  );
});
test('重复句子采用评分指定位置，失效批注不会贴到无关句子', () => {
  const text = '雨声。\n雨声。';
  const located = locateAnnotations(text, [
    {...score.annotations[0], start: 4},
  ]);
  expect(located[0].start).toBe(4);
  expect(() =>
    locateAnnotations(text, [{...score.annotations[0], quote: '风声'}]),
  ).toThrow('无法定位');
});
test('生成含中文原文和长批注的多页真实 PDF', async () => {
  const longScore = {
    ...score,
    annotations: [
      {
        ...score.annotations[0],
        comment: '声音描写应当服务于人物情绪。'.repeat(180),
      },
      score.annotations[1],
    ],
  };
  const base64 = await buildAnnotatedPdf(
    '雨声敲着窗。我很难过。\n我终于走出门，雨停了。',
    '雨中的成长',
    longScore,
  );
  const bytes = Buffer.from(base64, 'base64');
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBeGreaterThan(2);
  expect(document.getTitle()).toBe('雨中的成长 · 批改');
  let checkedGlyphs = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.has(PDFName.of('FontFile2'))) {
      const stream = document.context.lookup(
        object.get(PDFName.of('FontFile2')),
      ) as PDFRawStream;
      const embedded = fontkit.create(decodePDFRawStream(stream).decode());
      for (let i = 0; i < embedded.numGlyphs; i += 1) {
        // Decode every embedded outline; parseable PDF text alone misses broken fonts.
        expect(() => (embedded as any).getGlyph(i).path.commands).not.toThrow();
        checkedGlyphs += 1;
      }
    }
  }
  expect(checkedGlyphs).toBeGreaterThan(50);
  expect(bytes.length).toBeLessThan(500_000);
  // A real artifact is also inspected with a PDF renderer during development.
  writeFileSync(join(tmpdir(), 'writer-annotated-test.pdf'), bytes);
}, 30000);
