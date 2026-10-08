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

/** Actual searchable PDF: complete original text, then each section's comments. */
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
  let page: PDFPage;
  let y = 0;
  const leftX = 36;
  const bodyWidth = 523;
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
    y = headingY - 35;
  };
  newPage();
  for (const section of sections) {
    const label = sectionLabel(section);
    const bodySize = section.kind === 'title' ? 16 : 12;
    if (y - bottom < 80) {
      newPage();
    }
    draw(page!, `${label} · 原文`, leftX, y, 10, COLORS.muted);
    y -= 26;
    const body = wrapPdfText(
      section.text,
      bodyWidth,
      measure(bodySize),
      section.start,
    );
    // Render every original line before any feedback. A long paragraph carries
    // on to the next page; neither model quotes nor summaries replace its text.
    for (const line of body) {
      if (y - bottom < 4) {
        newPage();
        draw(page!, `${label} · 原文（续）`, leftX, y, 10, COLORS.muted);
        y -= 26;
      }
      const ranges = annotations.filter(
        item => item.start < line.end && item.end > line.start,
      );
      for (const annotation of ranges) {
        const from = Math.max(line.start, annotation.start) - line.start;
        const to = Math.min(line.end, annotation.end) - line.start;
        const x = leftX + measure(bodySize)(line.text.slice(0, from));
        const width = measure(bodySize)(line.text.slice(from, to));
        page!.drawRectangle({
          x,
          y: y - 3,
          width,
          height: bodySize + 4,
          color: colorFor(annotation.type),
          opacity: 0.13,
        });
        page!.drawLine({
          start: {x, y: y - 3},
          end: {x: x + width, y: y - 3},
          color: colorFor(annotation.type),
          thickness: 0.6,
        });
      }
      draw(page!, line.text, leftX, y, bodySize);
      const markers = ranges
        .filter(item => item.start >= line.start && item.start < line.end)
        .map(item => item.number);
      if (markers.length) {
        draw(
          page!,
          `[${markers.join(',')}]`,
          leftX,
          y + bodySize + 1,
          6,
          COLORS.muted,
        );
      }
      y -= bodySize + 12;
    }
    y -= 6;
    const addNote = (value: string, color = COLORS.muted) => {
      for (const line of wrapPdfText(value, bodyWidth, measure(10))) {
        if (y - bottom < 4) {
          newPage();
          draw(page!, `${label} · 批注（续）`, leftX, y, 10, COLORS.muted);
          y -= 24;
        }
        draw(page!, line.text, leftX, y, 10, color);
        y -= 16;
      }
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
    }
    const sectionAnnotations = annotations.filter(
      item => item.start < section.end && item.end > section.start,
    );
    for (const annotation of sectionAnnotations) {
      y -= 8;
      addNote(
        `[${annotation.number}] ${LABELS[annotation.type]}`,
        colorFor(annotation.type),
      );
      addNote(`引用：${annotation.quote}`);
      addNote(`评语：${annotation.comment}`);
      addNote(`建议：${annotation.suggestion}`, COLORS.improvement);
    }
    if (!review && !sectionAnnotations.length) {
      addNote('此处暂无已保存的批注。');
    }
    y -= 24;
    // Yield between paragraphs so React Native can paint progress indicators.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    draw(
      item,
      `${index + 1} / ${pages.length}    原文完整展示，修改建议列于各段下方`,
      leftX,
      25,
      8,
      COLORS.muted,
    );
  });
  return pdf.saveAsBase64({objectsPerTick: 30});
}
