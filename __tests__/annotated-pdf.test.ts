import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFPage,
  decodePDFRawStream,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  buildAnnotatedPdf,
  coloredPdfRuns,
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

test('交叠批注按问题优先着色，每个原文字只绘制一次', () => {
  const text = '风吹过树梢，我记下颜色与声音。';
  const runs = coloredPdfRuns({text, start: 10, end: 10 + text.length}, [
    {...score.annotations[0], start: 10, end: 16},
    {...score.annotations[1], start: 13, end: 19},
    {...score.annotations[1], type: 'grammar', start: 14, end: 15},
  ]);
  expect(runs.map(run => run.text).join('')).toBe(text);
  expect(runs.find(run => run.start === 14)?.type).toBe('grammar');
  expect(runs.find(run => run.start === 13)?.type).toBe('improvement');
  expect(runs[0].type).toBe('strength');
  expect(runs[runs.length - 1].type).toBeUndefined();
});

test('左栏原文以绿色、红色、棕色文字及同色下划线标记，右栏包含对应编号', async () => {
  const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
  const drawLine = jest.spyOn(PDFPage.prototype, 'drawLine');
  const annotations = [
    {...score.annotations[0], quote: '雨声'},
    {...score.annotations[1], quote: '声因', type: 'grammar' as const},
    {...score.annotations[1], quote: '我很难过'},
  ];
  try {
    await buildAnnotatedPdf('雨声很响，声因清晰，我很难过。', '听雨', {
      ...score,
      annotations,
    });
    const body = drawText.mock.calls.filter(
      ([, options]) => options?.size === 12,
    );
    const colored = body.filter(([value]) =>
      ['雨声', '声因', '我很难过'].includes(value),
    );
    expect(colored).toHaveLength(3);
    expect(
      new Set(colored.map(([, opts]) => JSON.stringify(opts?.color))).size,
    ).toBe(3);
    for (const [, opts] of colored) {
      expect(drawLine.mock.calls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              start: {x: opts!.x, y: opts!.y! - 3},
              color: opts!.color,
              thickness: 0.8,
            }),
          ],
        ]),
      );
    }
    const notes = drawText.mock.calls
      .filter(([, opts]) => opts?.x === 356)
      .map(([value]) => value)
      .join('');
    expect(notes).toContain('[1] 亮点');
    expect(notes).toContain('[2] 字词语病');
    expect(notes).toContain('[3] 待改进');
  } finally {
    drawText.mockRestore();
    drawLine.mockRestore();
  }
});
test('生成含中文原文和长批注的多页真实 PDF', async () => {
  const comment = Array.from(
    {length: 400},
    (_, i) => `第${i + 1}条：声音描写应当服务于人物情绪。`,
  ).join('');
  const longScore = {
    ...score,
    annotations: [
      {
        ...score.annotations[0],
        comment,
      },
      score.annotations[1],
    ],
  };
  const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
  let base64: string;
  try {
    base64 = await buildAnnotatedPdf(
      '雨声敲着窗。我很难过。\n我终于走出门，雨停了。',
      '雨中的成长',
      longScore,
    );
    const notes = drawText.mock.calls
      .filter(([, opts]) => opts?.x === 356 && opts?.size === 9)
      .map(([value]) => value)
      .join('');
    expect(notes).toContain(comment);
    const body = drawText.mock.calls
      .filter(([, opts]) => opts?.size === 12)
      .map(([value]) => value)
      .join('');
    expect(body).toBe('雨声敲着窗。我很难过。我终于走出门，雨停了。');
  } finally {
    drawText.mockRestore();
  }
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

test('标题独立编号，长段原文和全部评语完整绘制并跨页接续', async () => {
  const title = '春天的发现';
  const first =
    '段首：我推开窗。' +
    Array.from(
      {length: 100},
      (_, i) => `第${i + 1}处细节，风吹过树梢，我记下眼前的颜色与声音。`,
    ).join('') +
    '段尾：这些发现让我学会认真观察生活。';
  const second = '最后一段：我合上本子，准备明天继续观察。';
  const original = `${title}\n\n${first}\n\n${second}`;
  const legacy = {
    ...score,
    annotations: [
      {...score.annotations[0], quote: title, comment: '标题聚焦发现'},
      {
        ...score.annotations[0],
        quote: '段首：我推开窗。',
        comment: '观察从具体场景开始',
      },
      {...score.annotations[1], quote: second, suggestion: '保留下一步行动'},
    ],
    paragraphReviews: [
      '标题的旧评价',
      '正文首段的旧评价',
      '正文末段的旧评价',
    ].map((value, i) => ({
      paragraphIndex: i + 1,
      strengths: [value],
      weaknesses: [],
      improvements: [`${value}的完整修改建议`],
    })),
  };
  const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
  try {
    const base64 = await buildAnnotatedPdf(original, title, legacy);
    const calls = [...drawText.mock.calls];
    const drawnBody = calls
      .filter(([, options]) => options?.size === 12)
      .map(([value]) => value)
      .join('');
    expect(drawnBody).toBe(first + second);
    expect(
      calls
        .filter(([, options]) => options?.size === 16)
        .map(([value]) => value),
    ).toEqual([title]);
    const drawn = calls.map(([value]) => value).join('\n');
    expect(drawn).toContain('标题 · 原文');
    expect(drawn).toContain('第 1 段 · 原文（续）');
    expect(drawn).toContain('第 2 段 · 原文');
    expect(drawn).not.toContain('第 3 段');
    expect(drawn.indexOf('标题整体评价')).toBeLessThan(
      drawn.indexOf('标题的旧评价'),
    );
    expect(drawn.indexOf('第 1 段整体评价')).toBeLessThan(
      drawn.indexOf('正文首段的旧评价'),
    );
    const drawnNotes = calls
      .filter(([, options]) => options?.x === 356)
      .map(([value]) => value)
      .join('');
    expect(drawnNotes).toContain('正文末段的旧评价的完整修改建议');
    for (const [, options] of calls.filter(
      ([, opts]) => opts?.size === 12 || opts?.size === 16,
    )) {
      expect(options?.x).toBeGreaterThanOrEqual(36);
      expect(options?.x).toBeLessThan(341);
    }
    for (const [, options] of calls.filter(
      ([, drawOptions]) => drawOptions?.size !== 8,
    )) {
      expect(options?.y).toBeGreaterThanOrEqual(48);
      expect(options?.y).toBeLessThanOrEqual(807);
    }
    const bytes = Buffer.from(base64, 'base64');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
    writeFileSync(join(tmpdir(), 'writer-full-paragraph-test.pdf'), bytes);
    writeFileSync(
      join(tmpdir(), 'writer-full-paragraph-expected.json'),
      JSON.stringify({title, first, second}),
    );
  } finally {
    drawText.mockRestore();
  }
}, 30000);
