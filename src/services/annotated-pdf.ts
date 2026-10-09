import {PDFDocument, PDFFont, PDFPage, rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {Annotation, ScoreResult} from '../types';
import {
  essaySections,
  normalizeSavedParagraphReviews,
  sectionLabel,
} from './essay-text';

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

/** Partition, rather than overpaint, so colored text remains searchable once.
 * Overlapping annotations use problem > improvement > strength precedence. */
export function coloredPdfRuns(
  line: Line,
  annotations: (Annotation & {start: number; end: number})[],
) {
  const ranges = annotations.filter(
    item => item.start < line.end && item.end > line.start,
  );
  const boundaries = [
    ...new Set([
      line.start,
      line.end,
      ...ranges.flatMap(item => [
        Math.max(line.start, item.start),
        Math.min(line.end, item.end),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const priority = (type: Annotation['type']) =>
    type === 'grammar' || type === 'structure'
      ? 3
      : type === 'strength'
      ? 1
      : 2;
  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1];
    const strongest = ranges
      .filter(item => item.start < end && item.end > start)
      .sort((a, b) => priority(b.type) - priority(a.type))[0];
    return {
      text: line.text.slice(start - line.start, end - line.start),
      start,
      end,
      type: strongest?.type,
    };
  });
}

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

/** Draw each original character once. Paragraphs and comments stay aligned. */
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
  const sections = essaySections(text);
  const feedback = normalizeSavedParagraphReviews(score, text);
  pdf.setTitle(`${title || '未命名作文'} · 批改`);
  pdf.setAuthor('EssayLens');
  pdf.setSubject('原文、分段评语和句子批注');
  let page: PDFPage | undefined;
  let y = 0;
  const leftX = 36;
  const bodyWidth = 292;
  const rightX = 356;
  const noteWidth = 203;
  const bottom = 48;
  const heading = wrapPdfText(title || '未命名作文', 520, measure(15));
  const headerSpace = 34.89 + heading.length * 21 + 54;
  const newPage = (height: number) => {
    page = pdf.addPage([595.28, height]);
    let headingY = height - 34.89;
    heading.forEach(line => {
      draw(page!, line.text, leftX, headingY, 15);
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
  for (const section of sections) {
    const label = sectionLabel(section);
    const bodySize = section.kind === 'title' ? 16 : 12;
    const bodyHeight = bodySize + 10;
    const body = wrapPdfText(
      section.text,
      bodyWidth,
      measure(bodySize),
      section.start,
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
    const review =
      section.kind === 'title'
        ? feedback.titleFeedback
        : feedback.paragraphReviews?.find(
            item => item.paragraphIndex === section.index,
          );
    if (review) {
      addNote(`${label}整体评价`);
      review.strengths.forEach(item =>
        addNote(`优点：${item}`, COLORS.strength),
      );
      review.weaknesses.forEach(item =>
        addNote(`不足：${item}`, COLORS.problem),
      );
      review.improvements.forEach(item =>
        addNote(`改进：${item}`, COLORS.improvement),
      );
      addNote(' ');
    }
    for (const annotation of annotations.filter(
      item => item.start < section.end && item.end > section.start,
    )) {
      addNote(
        `[${annotation.number}] ${LABELS[annotation.type]}`,
        colorFor(annotation.type),
      );
      addNote(`引用：${annotation.quote}`);
      addNote(`评语：${annotation.comment}`);
      addNote(`建议：${annotation.suggestion}`, COLORS.improvement);
      addNote(' ');
    }
    if (!notes.length) {
      addNote('此处暂无已保存的批注。');
    }
    let bodyIndex = 0;
    let noteIndex = 0;
    const blockHeight =
      28 + Math.max(body.length * bodyHeight, notes.length * 14);
    // Keep a whole paragraph and its notes together at readable sizes where
    // possible. Respect the PDF page-size limit for unusually large sections.
    const pageHeight = Math.min(
      14400,
      Math.max(841.89, headerSpace + blockHeight + bottom),
    );
    while (bodyIndex < body.length || noteIndex < notes.length) {
      if (
        !page ||
        y - bottom + 0.01 <
          Math.min(blockHeight, pageHeight - headerSpace - bottom)
      ) {
        newPage(pageHeight);
      }
      if (bodyIndex < body.length) {
        draw(
          page!,
          `${label} · 原文${bodyIndex ? '（续）' : ''}`,
          leftX,
          y,
          10,
          COLORS.muted,
        );
      }
      if (noteIndex < notes.length) {
        draw(
          page!,
          `${label} · 批注${noteIndex ? '（续）' : ''}`,
          rightX,
          y,
          10,
          COLORS.muted,
        );
      }
      y -= 28;
      const bodyCount = Math.min(
        body.length - bodyIndex,
        Math.floor((y - bottom) / bodyHeight) + 1,
      );
      const noteCount = Math.min(
        notes.length - noteIndex,
        Math.floor((y - bottom) / 14) + 1,
      );
      for (let i = 0; i < bodyCount; i += 1) {
        const line = body[bodyIndex + i];
        const lineY = y - i * bodyHeight;
        for (const run of coloredPdfRuns(line, annotations)) {
          const x =
            leftX +
            measure(bodySize)(line.text.slice(0, run.start - line.start));
          const color = run.type ? colorFor(run.type) : COLORS.text;
          draw(page!, run.text, x, lineY, bodySize, color);
          if (run.type) {
            page!.drawLine({
              start: {x, y: lineY - 3},
              end: {x: x + measure(bodySize)(run.text), y: lineY - 3},
              color,
              thickness: 0.8,
            });
          }
        }
        const markers = annotations
          .filter(item => item.start >= line.start && item.start < line.end)
          .map(item => item.number);
        if (markers.length) {
          draw(
            page!,
            `[${markers.join(',')}]`,
            leftX,
            lineY + bodySize + 1,
            6,
            COLORS.muted,
          );
        }
      }
      for (let i = 0; i < noteCount; i += 1) {
        const note = notes[noteIndex + i];
        draw(page!, note.text, rightX, y - i * 14, 9, note.color);
      }
      bodyIndex += bodyCount;
      noteIndex += noteCount;
      y -= Math.max(bodyCount * bodyHeight, noteCount * 14) + 18;
      if (bodyIndex < body.length || noteIndex < notes.length) {
        newPage(pageHeight);
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    draw(
      item,
      `${index + 1} / ${
        pages.length
      }    左侧完整原文 · 右侧批注 · 编号对应彩色划线`,
      leftX,
      25,
      8,
      COLORS.muted,
    );
  });
  return pdf.saveAsBase64({objectsPerTick: 30});
}
