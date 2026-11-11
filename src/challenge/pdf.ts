import {Image} from 'react-native';
import RNFS from 'react-native-fs';
import {PDFDocument, PDFFont, PDFImage, PDFPage, rgb} from 'pdf-lib';
import {createPdfWithFont} from '../shared/pdf/core';
import {wrapPdfText} from '../shared/pdf/text';
import {
  ChallengeFigure,
  ChallengeLearningGuide,
  ChallengePaper,
  DrawingFigure,
  ExamAnalysis,
  SourceFigure,
} from './types';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const BOTTOM = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TEXT = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.36, 0.4, 0.47);
const LIGHT = rgb(0.78, 0.81, 0.85);

function localPath(uri: string) {
  const path = uri.startsWith('file://')
    ? decodeURIComponent(uri.slice(7))
    : uri;
  if (!path.startsWith('/') || path.includes('\0')) {
    throw new Error('试卷图示必须来自本机已保存的图片');
  }
  return path;
}

function sameBox(first: SourceFigure, second: SourceFigure) {
  return (
    first.pageIndex === second.pageIndex &&
    (['x', 'y', 'width', 'height'] as const).every(
      key => first.box[key] === second.box[key],
    )
  );
}

/** Preserve Latin words where possible; long words and Chinese still wrap. */
function readableLines(
  text: string,
  width: number,
  measure: (value: string) => number,
) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .flatMap(paragraph => {
      const tokens = paragraph.match(/[A-Za-z0-9_'’]+|[^\r\n]/gu) || [];
      const lines: string[] = [];
      let line = '';
      for (const token of tokens) {
        if (line && measure(line + token) > width) {
          lines.push(line);
          line = '';
        }
        if (measure(token) > width) {
          const pieces = wrapPdfText(token, width, measure).map(
            item => item.text,
          );
          lines.push(...pieces.slice(0, -1));
          line = pieces[pieces.length - 1] || '';
        } else {
          line += token;
        }
      }
      if (line || !lines.length) {
        lines.push(line);
      }
      return lines;
    });
}

class PaperWriter {
  private page!: PDFPage;
  private cursor = 0;
  private context = '';
  private readonly supported: Set<number>;

  constructor(
    readonly pdf: PDFDocument,
    readonly font: PDFFont,
    private readonly heading: string,
    private readonly kind: '试卷' | '答案与解析',
  ) {
    this.supported = new Set(font.getCharacterSet());
    this.newPage();
  }

  display(value: string) {
    return Array.from(value, char => {
      if (char === '\t') {
        return '    ';
      }
      if (!this.supported.has(char.codePointAt(0)!)) {
        return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`;
      }
      return char;
    }).join('');
  }

  private newPage() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.page.drawText(this.display(this.heading), {
      x: MARGIN,
      y: PAGE_HEIGHT - 30,
      size: 9,
      font: this.font,
      color: MUTED,
    });
    this.page.drawLine({
      start: {x: MARGIN, y: PAGE_HEIGHT - 38},
      end: {x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 38},
      thickness: 0.5,
      color: LIGHT,
    });
    this.cursor = PAGE_HEIGHT - 61;
    if (this.context) {
      this.line(`${this.context}（续）`, 9, 17, MUTED);
    }
  }

  setContext(value: string) {
    this.context = value;
  }

  ensure(height: number) {
    if (this.cursor - height < BOTTOM) {
      this.newPage();
    }
  }

  private line(value: string, size: number, leading: number, color = TEXT) {
    this.ensure(leading);
    if (value) {
      this.page.drawText(this.display(value), {
        x: MARGIN,
        y: this.cursor,
        size,
        font: this.font,
        color,
      });
    }
    this.cursor -= leading;
  }

  text(value: string, size = 12, leading = 19, color = TEXT) {
    const measure = (part: string) =>
      this.font.widthOfTextAtSize(this.display(part), size);
    for (const line of readableLines(value, CONTENT_WIDTH, measure)) {
      this.line(line, size, leading, color);
    }
  }

  gap(amount = 10) {
    this.cursor = Math.max(BOTTOM, this.cursor - amount);
  }

  answerSpace(lines: number) {
    if (!Number.isInteger(lines) || lines < 0 || lines > 100) {
      throw new Error('试卷答题留白行数无效，请重新生成');
    }
    for (let index = 0; index < lines; index += 1) {
      this.ensure(25);
      this.page.drawLine({
        start: {x: MARGIN, y: this.cursor - 6},
        end: {x: PAGE_WIDTH - MARGIN, y: this.cursor - 6},
        thickness: 0.45,
        color: LIGHT,
      });
      this.cursor -= 25;
    }
  }

  image(image: PDFImage) {
    const scale = Math.min(CONTENT_WIDTH / image.width, 310 / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    this.ensure(height + 12);
    this.page.drawImage(image, {
      x: MARGIN + (CONTENT_WIDTH - width) / 2,
      y: this.cursor - height,
      width,
      height,
    });
    this.cursor -= height + 12;
  }

  drawing(figure: DrawingFigure) {
    if (
      !Number.isFinite(figure.width) ||
      !Number.isFinite(figure.height) ||
      figure.width <= 0 ||
      figure.height <= 0 ||
      figure.width > 2000 ||
      figure.height > 2000 ||
      !Array.isArray(figure.elements) ||
      figure.elements.length > 400
    ) {
      throw new Error('试卷图示尺寸或元素无效');
    }
    const scale = Math.min(
      CONTENT_WIDTH / figure.width,
      310 / figure.height,
      1,
    );
    const height = figure.height * scale;
    const left = MARGIN + (CONTENT_WIDTH - figure.width * scale) / 2;
    this.ensure(height + 14);
    const top = this.cursor;
    const point = (x: number, y: number) => {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > figure.width ||
        y > figure.height
      ) {
        throw new Error('试卷图示坐标超出范围');
      }
      return {x: left + x * scale, y: top - y * scale};
    };
    for (const element of figure.elements) {
      if (element.kind === 'line') {
        this.page.drawLine({
          start: point(element.x1, element.y1),
          end: point(element.x2, element.y2),
          thickness: 0.9,
          color: TEXT,
        });
      } else if (element.kind === 'circle') {
        const center = point(element.x, element.y);
        if (!Number.isFinite(element.radius) || element.radius <= 0) {
          throw new Error('试卷图示半径无效');
        }
        point(element.x - element.radius, element.y - element.radius);
        point(element.x + element.radius, element.y + element.radius);
        this.page.drawCircle({
          ...center,
          size: element.radius * scale,
          borderColor: TEXT,
          borderWidth: 0.9,
        });
      } else if (element.kind === 'rect') {
        point(element.x, element.y);
        const bottomLeft = point(element.x, element.y + element.height);
        point(element.x + element.width, element.y + element.height);
        if (
          !Number.isFinite(element.width) ||
          !Number.isFinite(element.height) ||
          element.width <= 0 ||
          element.height <= 0
        ) {
          throw new Error('试卷图示矩形尺寸无效');
        }
        this.page.drawRectangle({
          ...bottomLeft,
          width: element.width * scale,
          height: element.height * scale,
          borderColor: TEXT,
          borderWidth: 0.9,
        });
      } else if (element.kind === 'text') {
        const origin = point(element.x, element.y);
        const size = Math.max(8, 12 * scale);
        const label = this.display(element.text);
        if (
          !label.trim() ||
          this.font.widthOfTextAtSize(label, size) >
            PAGE_WIDTH - MARGIN - origin.x ||
          origin.y - size < top - height
        ) {
          throw new Error('试卷图示文字超出绘图区，请修正图示');
        }
        this.page.drawText(label, {
          x: origin.x,
          y: origin.y - size,
          size,
          font: this.font,
          color: TEXT,
        });
      } else {
        throw new Error('试卷图示包含不支持的元素');
      }
    }
    this.cursor -= height + 14;
  }

  async finish() {
    const pages = this.pdf.getPages();
    pages.forEach((page, index) => {
      page.drawText(
        this.display(`${this.kind} · ${index + 1} / ${pages.length}`),
        {
          x: MARGIN,
          y: 26,
          size: 9,
          font: this.font,
          color: MUTED,
        },
      );
    });
    return this.pdf.saveAsBase64({objectsPerTick: 30});
  }
}

async function newWriter(
  analysis: ExamAnalysis,
  paper: ChallengePaper,
  answers: boolean,
  fontData?: string | Uint8Array,
) {
  const {pdf, font} = await createPdfWithFont(fontData);
  const kind = answers ? '答案与解析' : '试卷';
  pdf.setTitle(`${paper.title} · ${kind}`);
  pdf.setAuthor('EssayLens');
  pdf.setSubject(`${analysis.subjectLabel} · 挑战升${paper.level}档 · ${kind}`);
  return new PaperWriter(
    pdf,
    font,
    `挑战 · ${analysis.subjectLabel} · 升${paper.level}档 · ${kind}`,
    kind,
  );
}

async function croppedSourceImage(
  writer: PaperWriter,
  figure: SourceFigure,
  analysis: ExamAnalysis,
  pageUris: string[],
) {
  const original = analysis.figures.find(item => item.id === figure.id);
  const box = figure.box;
  if (
    !original ||
    original.containsStudentMarks ||
    figure.containsStudentMarks ||
    !sameBox(original, figure) ||
    !Number.isInteger(figure.pageIndex) ||
    !pageUris[figure.pageIndex] ||
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.x < 0 ||
    box.y < 0 ||
    box.width <= 0 ||
    box.height <= 0 ||
    box.x + box.width > 1 ||
    box.y + box.height > 1
  ) {
    throw new Error(
      '图示不能直接复用：图框未确认、缺少源页或包含学生作答，请重建图示',
    );
  }
  const uri = pageUris[figure.pageIndex];
  const sourcePath = localPath(uri);
  const size = await new Promise<{width: number; height: number}>(
    (resolve, reject) => {
      Image.getSize(
        uri,
        (width, height) => resolve({width, height}),
        () => reject(new Error('无法读取试卷源图尺寸，请重新导入')),
      );
    },
  );
  if (
    ![size.width, size.height].every(
      value => Number.isFinite(value) && value > 0 && value <= 100000,
    )
  ) {
    throw new Error('试卷源图尺寸无效');
  }
  const x = Math.round(box.x * size.width);
  const y = Math.round(box.y * size.height);
  const width = Math.min(size.width - x, Math.round(box.width * size.width));
  const height = Math.min(
    size.height - y,
    Math.round(box.height * size.height),
  );
  if (width < 1 || height < 1) {
    throw new Error('试卷图示裁切范围过小，请重新确认');
  }
  let temporaryPath = '';
  try {
    // Actual raster cropping is intentional: clipping a full-page PDF image
    // would still embed hidden student answers in extractable image resources.
    const imported = require('@react-native-community/image-editor');
    const editor = (imported.default ||
      imported) as typeof import('@react-native-community/image-editor').default;
    const scale = Math.min(1, 1800 / Math.max(width, height));
    const result = await editor.cropImage(uri, {
      offset: {x, y},
      size: {width, height},
      displaySize: {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      },
      quality: 1,
      format: 'png',
    });
    const outputUri = typeof result === 'string' ? result : result.uri;
    temporaryPath = localPath(outputUri);
    if (temporaryPath === sourcePath) {
      temporaryPath = '';
      throw new Error('图示裁切未生成独立图片');
    }
    const bytes = await RNFS.readFile(temporaryPath, 'base64');
    // Request PNG above, but accept native-compatible JPEG results as well.
    return bytes.startsWith('iVBOR')
      ? await writer.pdf.embedPng(bytes)
      : await writer.pdf.embedJpg(bytes);
  } finally {
    if (temporaryPath) {
      await RNFS.unlink(temporaryPath).catch(() => undefined);
    }
  }
}

function writeLearningGuides(
  writer: PaperWriter,
  guides: ChallengeLearningGuide[],
  questionLabel: string,
) {
  writer.gap(7);
  writer.ensure(75);
  writer.text('知识点掌握解析（学习说明，不另计分）', 12, 21);
  for (const [index, guide] of guides.entries()) {
    writer.ensure(72);
    writer.setContext(`${questionLabel} · 掌握解析 ${index + 1}`);
    writer.text(`知识点 ${index + 1}：${guide.knowledgePoint}`, 12, 21);
    writer.text(`核心理解：${guide.coreInsight}`, 11, 18);
    writer.text(`适用条件与边界：${guide.conditionBoundary}`, 11, 18);
    writer.text(`推理依据：${guide.reasoning}`, 11, 18);
    for (const [mistakeIndex, mistake] of guide.misconceptions.entries()) {
      writer.ensure(60);
      writer.text(
        `可能误区 ${mistakeIndex + 1}：${mistake.wrongApproach}`,
        11,
        18,
      );
      writer.text(`错因：${mistake.whyWrong}`, 11, 18);
      writer.text(`纠正方法：${mistake.correction}`, 11, 18);
    }
    for (const [linkIndex, link] of guide.transferLinks.entries()) {
      writer.ensure(100);
      const fromSource = link.kind === 'source_to_variant';
      writer.text(
        `变式迁移 ${linkIndex + 1} · ${fromSource ? '原题到新题' : '条件对比'}`,
        11,
        19,
      );
      writer.text(
        `${fromSource ? '原题条件' : '对比条件一'}：${link.originalCondition}`,
        11,
        18,
      );
      writer.text(
        `${fromSource ? '新题条件' : '对比条件二'}：${link.changedCondition}`,
        11,
        18,
      );
      writer.text(`不变原理：${link.invariant}`, 11, 18);
      writer.text(`推理调整：${link.adaptation}`, 11, 18);
    }
    for (const [checkIndex, check] of guide.selfChecks.entries()) {
      writer.ensure(42);
      const kind = {
        conditions: '条件',
        reasoning: '推理',
        result: '结果',
      }[check.kind];
      writer.text(`${kind}自检 ${checkIndex + 1}：${check.method}`, 11, 18);
      writer.text(`预期：${check.expected}`, 11, 18);
    }
    writer.gap(8);
  }
}

/** Build separate printable artifacts from the validated candidate only. */
export async function buildChallengePdfs(
  analysis: ExamAnalysis,
  paper: ChallengePaper,
  pageUris: string[],
  fontData?: string | Uint8Array,
): Promise<{paperBase64: string; answersBase64: string}> {
  if (
    !analysis.isExam ||
    analysis.unresolvedIssues.length ||
    !paper.title.trim() ||
    !paper.questions.length
  ) {
    throw new Error('试卷尚未完整解析，不能生成 PDF');
  }
  if (
    paper.subject !== analysis.subject ||
    ![1, 2, 3].includes(paper.level) ||
    paper.questions.length !== analysis.questions.length ||
    paper.questions.some(
      (question, index) => question.id !== analysis.questions[index]?.id,
    ) ||
    new Set(paper.questions.map(question => question.id)).size !==
      paper.questions.length ||
    paper.answers.length !== paper.questions.length ||
    paper.questions.some(
      question =>
        paper.answers.filter(answer => answer.questionId === question.id)
          .length !== 1,
    )
  ) {
    throw new Error('新试卷题号、顺序或答案对应不完整，不能生成 PDF');
  }
  const writer = await newWriter(analysis, paper, false, fontData);
  writer.text(paper.title, 18, 26);
  writer.text(
    `${analysis.subjectLabel}  ·  升${paper.level}档${
      paper.totalScore === null ? '' : `  ·  满分 ${paper.totalScore} 分`
    }${
      paper.timeLimitMinutes === null
        ? ''
        : `  ·  ${paper.timeLimitMinutes} 分钟`
    }`,
    10,
    18,
    MUTED,
  );
  writer.text('姓名：________________  班级：________________', 11, 20);
  if (paper.questions.some(question => question.isListening)) {
    writer.text('听力题保持原样，请配合原卷录音作答。', 10, 17, MUTED);
  }
  writer.gap();
  const materialLabels = new Map(
    paper.materials.map((material, index) => [
      material.id,
      `材料 ${index + 1}`,
    ]),
  );
  const figureLabels = new Map(
    paper.figures.map((figure, index) => [figure.id, `图 ${index + 1}`]),
  );
  const materialIds = new Set<string>();
  const figureIds = new Set<string>();
  const figure = async (id: string) => {
    if (figureIds.has(id)) {
      return;
    }
    const item: ChallengeFigure | undefined = paper.figures.find(
      value => value.id === id,
    );
    if (!item) {
      throw new Error('试卷缺少题目引用的图示');
    }
    writer.ensure(70);
    writer.text(figureLabels.get(id)!, 10, 17, MUTED);
    if (item.kind === 'source') {
      writer.image(await croppedSourceImage(writer, item, analysis, pageUris));
    } else {
      writer.drawing(item);
    }
    if (item.caption.trim()) {
      writer.text(item.caption, 10, 17, MUTED);
    }
    writer.gap(5);
    figureIds.add(id);
  };
  let sectionId = '';
  for (const question of paper.questions) {
    if (sectionId !== question.sectionId) {
      const section = paper.sections.find(
        item => item.id === question.sectionId,
      );
      if (!section) {
        throw new Error('试卷缺少题目所属部分');
      }
      writer.ensure(72);
      writer.text(section.title, 14, 23);
      if (section.instructions.trim()) {
        writer.text(section.instructions, 11, 18);
      }
      writer.gap(5);
      sectionId = section.id;
    }
    for (const id of question.materialIds) {
      if (materialIds.has(id)) {
        continue;
      }
      const material = paper.materials.find(item => item.id === id);
      if (!material) {
        throw new Error('试卷缺少题目引用的材料');
      }
      const label = materialLabels.get(id)!;
      writer.ensure(65);
      writer.text(
        `${label}${material.title.trim() ? ` · ${material.title}` : ''}`,
        12,
        20,
      );
      writer.setContext(label);
      writer.text(material.text);
      for (const idOfFigure of material.figureIds) {
        await figure(idOfFigure);
      }
      writer.setContext('');
      writer.gap();
      materialIds.add(id);
    }
    writer.ensure(60);
    const label = `第 ${question.number} 题`;
    writer.text(
      `${label} · ${question.type}${
        question.score === null ? '' : `（${question.score}分）`
      }`,
      12,
      21,
    );
    writer.setContext(label);
    if (question.materialIds.length) {
      writer.text(
        `依据${question.materialIds
          .map(id => materialLabels.get(id))
          .join('、')}`,
        9,
        16,
        MUTED,
      );
    }
    writer.text(question.stem);
    for (const option of question.options) {
      writer.text(`${option.label}. ${option.text}`, 12, 19);
    }
    if (question.figureIds.length) {
      writer.text(
        `图示：${question.figureIds
          .map(id => figureLabels.get(id) || id)
          .join('、')}`,
        9,
        16,
        MUTED,
      );
    }
    for (const id of question.figureIds) {
      await figure(id);
    }
    writer.answerSpace(question.answerLines);
    writer.setContext('');
    writer.gap(13);
  }
  const paperBase64 = await writer.finish();
  const answers = await newWriter(analysis, paper, true, fontData);
  answers.text(`${paper.title} · 答案与解析`, 18, 26);
  answers.text(
    `${analysis.subjectLabel}  ·  升${paper.level}档  ·  题号与新试卷一致`,
    10,
    18,
    MUTED,
  );
  if (paper.answers.some(answer => answer.status === 'requires_audio')) {
    answers.text(
      '听力题沿用原卷；缺少可靠原录音或转写时，相关答案标为待核，不作确定答案。',
      10,
      17,
      MUTED,
    );
  }
  answers.gap();
  for (const question of paper.questions) {
    const answer = paper.answers.find(item => item.questionId === question.id)!;
    if (
      (answer.status === 'verified' && !answer.answer.trim()) ||
      !answer.explanation.trim() ||
      (answer.status === 'requires_audio' && !question.isListening)
    ) {
      throw new Error('答案或解析不完整，不能生成 PDF');
    }
    const label = `第 ${question.number} 题`;
    answers.ensure(66);
    answers.text(
      `${label} · ${question.type}${
        question.score === null ? '' : `（${question.score}分）`
      }`,
      13,
      22,
    );
    answers.setContext(label);
    if (answer.status === 'requires_audio') {
      answers.text('听力答案待核：需结合原录音或可靠听力转写核验。', 12, 20);
      answers.text(`核验说明：${answer.explanation}`, 11, 18);
    } else if (answer.status === 'verified') {
      answers.text(`参考答案：${answer.answer}`);
      answers.text(`解析：${answer.explanation}`, 11, 18);
      answer.scoringPoints.forEach((point, index) =>
        answers.text(`评分点 ${index + 1}：${point}`, 11, 18),
      );
    } else if (
      answer.status === 'requires_review' &&
      question.upgrade.mode === 'retained'
    ) {
      answers.text('原题保留，参考答案待核。', 12, 20);
      answers.text(`核验说明：${answer.explanation}`, 11, 18);
    } else {
      throw new Error('答案核验状态无效');
    }
    answers.text(
      `知识点：${question.knowledgePoints.join('；')}`,
      10,
      17,
      MUTED,
    );
    if (
      !question.isListening &&
      question.upgrade.mode !== 'retained' &&
      answer.learningGuide?.length
    ) {
      writeLearningGuides(answers, answer.learningGuide, label);
    }
    answers.setContext('');
    answers.gap(15);
  }
  return {paperBase64, answersBase64: await answers.finish()};
}
