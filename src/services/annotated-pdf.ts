import {PDFDocument, PDFFont, PDFPage, rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {Annotation, ScoreResult} from '../types';
import {essayParagraphs} from './essay-text';

const COLORS = {
  text: rgb(0.12, 0.16, 0.22),
  muted: rgb(0.35, 0.4, 0.46),
  strength: rgb(0.08, 0.42, 0.24),
  problem: rgb(0.67, 0.16, 0.15),
  improvement: rgb(0.56, 0.32, 0.06),
};
const LABELS = {
  strength: '亮点',
  improvement: '待改进',
  grammar: '字词语病',
  structure: '结构问题',
  style: '表达改进',
};
const colorFor = (type: Annotation['type']) =>
  type === 'strength'
    ? COLORS.strength
    : type === 'grammar' || type === 'structure'
    ? COLORS.problem
    : COLORS.improvement;

type Line = {text: string; start: number; end: number};

/** Code-point wrapping retains UTF-16 offsets used by the scorer. */
export function wrapPdfText(
  text: string,
  width: number,
  measure: (text: string) => number,
  offset = 0,
): Line[] {
  const lines: Line[] = [];
  let line = '';
  let start = offset;
  let position = offset;
  let lineWidth = 0;
  for (const char of text) {
    if (char === '\r') {
      position += 1;
      continue;
    }
    if (char === '\n') {
      lines.push({text: line, start, end: position});
      line = '';
      lineWidth = 0;
      start = ++position;
      continue;
    }
    const charWidth = measure(char);
    if (line && lineWidth + charWidth > width) {
      lines.push({text: line, start, end: position});
      line = '';
      lineWidth = 0;
      start = position;
    }
    line += char;
    lineWidth += charWidth;
    position += char.length;
  }
  if (line) {
    lines.push({text: line, start, end: position});
  }
  return lines;
}

export function locateAnnotations(text: string, annotations: Annotation[]) {
  return annotations.map((annotation, index) => {
    const start =
      Number.isInteger(annotation.start) &&
      annotation.start! >= 0 &&
      text.slice(
        annotation.start,
        annotation.start! + annotation.quote.length,
      ) === annotation.quote
        ? annotation.start!
        : text.indexOf(annotation.quote);
    if (!annotation.quote || start < 0) {
      throw new Error(`第 ${index + 1} 条批注无法定位到原文，请重新评分`);
    }
    return {
      ...annotation,
      number: index + 1,
      start,
      end: start + annotation.quote.length,
    };
  });
}

/** Actual searchable PDF, with a bundled CJK font and printed margin comments. */
export async function buildAnnotatedPdf(
  text: string,
  title: string,
  score: ScoreResult,
  fontData?: string | Uint8Array,
) {
  if (!text.trim()) {
    throw new Error('原文识别完成后才能生成批改 PDF');
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Deferred until the user opens the correction tab; works offline on all platforms.
  const font: PDFFont = await pdf.embedFont(
    fontData || (require('../assets/fonts/noto-sans-sc.json') as string),
    {subset: true},
  );
  const supported = new Set(font.getCharacterSet());
  const display = (value: string) =>
    Array.from(value, char => {
      if (char === '\t') {
        return ' ';
      }
      if (!supported.has(char.codePointAt(0)!)) {
        // Never silently drop rare characters. The visible code point preserves identity.
        return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`;
      }
      return char;
    }).join('');
  const measure = (size: number) => (value: string) =>
    font.widthOfTextAtSize(display(value), size);
  const draw = (
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    size: number,
    color = COLORS.text,
  ) => page.drawText(display(value), {font, x, y, size, color});
  const annotations = locateAnnotations(text, score.annotations);
  const paragraphs = essayParagraphs(text);
  pdf.setTitle(`${title || '未命名作文'} · 批改`);
  pdf.setAuthor('EssayLens');
  pdf.setSubject('原文、分段评语和句子批注');
  let page: PDFPage;
  let y = 0;
  const leftX = 36;
  const rightX = 356;
  const bodyWidth = 292;
  const noteWidth = 203;
  const bottom = 48;
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    const heading = wrapPdfText(title || '未命名作文', 520, measure(15));
    let headingY = 807;
    heading.forEach(line => {
      draw(page, line.text, leftX, headingY, 15);
      headingY -= 21;
    });
    draw(
      page,
      '绿色：亮点   红色：问题   棕色：改进   方括号编号对应句子批注',
      leftX,
      headingY - 3,
      9,
      COLORS.muted,
    );
    draw(page, '原文', leftX, headingY - 28, 11);
    draw(page, '批注', rightX, headingY - 28, 11);
    page.drawLine({
      start: {x: 341, y: headingY - 14},
      end: {x: 341, y: bottom},
      thickness: 0.6,
      color: rgb(0.83, 0.86, 0.9),
    });
    y = headingY - 54;
  };
  newPage();
  for (const paragraph of paragraphs) {
    const body = wrapPdfText(
      paragraph.text,
      bodyWidth,
      measure(12),
      paragraph.start,
    );
    const notes: {text: string; color: ReturnType<typeof rgb>}[] = [];
    const addNote = (value: string, color = COLORS.muted) => {
      notes.push(
        ...wrapPdfText(value, noteWidth, measure(9)).map(line => ({
          text: line.text,
          color,
        })),
      );
    };
    for (const annotation of annotations.filter(
      item => item.start >= paragraph.start && item.start < paragraph.end,
    )) {
      addNote(
        `[${annotation.number}] ${LABELS[annotation.type]}：${
          annotation.quote
        }`,
        colorFor(annotation.type),
      );
      addNote(`评语：${annotation.comment}`);
      addNote(`建议：${annotation.suggestion}`, COLORS.improvement);
      addNote(' ');
    }
    const review = score.paragraphReviews?.find(
      item => item.paragraphIndex === paragraph.index,
    );
    if (review) {
      addNote(`第 ${paragraph.index} 段整体评价`);
      review.strengths.forEach(item =>
        addNote(`优点：${item}`, COLORS.strength),
      );
      review.weaknesses.forEach(item =>
        addNote(`不足：${item}`, COLORS.problem),
      );
      review.improvements.forEach(item =>
        addNote(`改进：${item}`, COLORS.improvement),
      );
    }
    if (!notes.length) {
      addNote('本段暂无已保存的批注。');
    }
    let bodyIndex = 0;
    let noteIndex = 0;
    let continuation = false;
    while (bodyIndex < body.length || noteIndex < notes.length) {
      if (y - bottom < 65) {
        newPage();
      }
      draw(
        page!,
        `第 ${paragraph.index} 段${continuation ? '（续）' : ''}`,
        leftX,
        y,
        9,
        COLORS.muted,
      );
      y -= 21;
      const bodyCount = Math.min(
        body.length - bodyIndex,
        Math.floor((y - bottom) / 21) + 1,
      );
      const noteCount = Math.min(
        notes.length - noteIndex,
        Math.floor((y - bottom) / 14) + 1,
      );
      for (let i = 0; i < bodyCount; i += 1) {
        const line = body[bodyIndex + i];
        const lineY = y - i * 21;
        const ranges = annotations.filter(
          item => item.start < line.end && item.end > line.start,
        );
        for (const annotation of ranges) {
          const from = Math.max(line.start, annotation.start) - line.start;
          const to = Math.min(line.end, annotation.end) - line.start;
          const x = leftX + measure(12)(line.text.slice(0, from));
          const width = measure(12)(line.text.slice(from, to));
          page!.drawRectangle({
            x,
            y: lineY - 3,
            width,
            height: 16,
            color: colorFor(annotation.type),
            opacity: 0.13,
          });
          page!.drawLine({
            start: {x, y: lineY - 3},
            end: {x: x + width, y: lineY - 3},
            color: colorFor(annotation.type),
            thickness: 0.6,
          });
        }
        draw(page!, line.text, leftX, lineY, 12);
        const markers = ranges
          .filter(item => item.start >= line.start && item.start < line.end)
          .map(item => item.number);
        if (markers.length) {
          draw(
            page!,
            `[${markers.join(',')}]`,
            leftX,
            lineY + 13,
            6,
            COLORS.muted,
          );
        }
      }
      for (let i = 0; i < noteCount; i += 1) {
        const note = notes[noteIndex + i];
        draw(page!, note.text, rightX, y - i * 14, 9, note.color);
      }
      y -= Math.max(bodyCount * 21, noteCount * 14) + 18;
      bodyIndex += bodyCount;
      noteIndex += noteCount;
      continuation = true;
      if (bodyIndex < body.length || noteIndex < notes.length) {
        newPage();
      }
    }
    // Yield between paragraphs so React Native can paint progress indicators.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    draw(
      item,
      `${index + 1} / ${pages.length}    原文保持识别结果，修改建议列于旁注`,
      leftX,
      25,
      8,
      COLORS.muted,
    );
  });
  return pdf.saveAsBase64({objectsPerTick: 30});
}
