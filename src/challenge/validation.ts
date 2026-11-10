import {
  ChallengeFigure,
  ChallengeLevel,
  ChallengePage,
  ChallengePaper,
  ChallengeReview,
  ChallengeReviewRole,
  CHALLENGE_REVIEW_ROLES,
  DrawingFigure,
  ExamAnalysis,
  ExamDraft,
  PaperMaterial,
  PaperQuestion,
  PaperSection,
  SourceFigure,
  SubjectIdentification,
  SubjectVerification,
  ChallengeSubject,
} from './types';
import {
  applicableChallengeDirections,
  applicableChallengeMetrics,
  CHALLENGE_SUBJECTS,
  getChallengePolicy,
  isWritingQuestion,
} from './rules';
import {validateLearningGuides} from './mastery';

function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonempty);
}
function unique(values: string[]) {
  return new Set(values).size === values.length;
}
function sameList(first: unknown, second: unknown) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every((item, index) => item === second[index])
  );
}
function sameSet(first: string[], second: string[]) {
  return (
    first.length === second.length && first.every(item => second.includes(item))
  );
}
function printedKey(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, '');
}
function transcriptSourceExists(
  title: string,
  body: string,
  pages: ChallengePage[],
) {
  const titleKey = printedKey(title);
  const bodyKey = printedKey(body);
  const original = printedKey(pages.map(page => page.text).join('\n'));
  let offset = original.indexOf(titleKey);
  while (offset >= 0) {
    const titleEnd = offset + titleKey.length;
    const bodyStart = original.indexOf(bodyKey, titleEnd);
    if (
      bodyStart >= titleEnd &&
      bodyStart - titleEnd <= 12 &&
      /^[：:、，,。.;；()[\]（）【】\-—]*$/u.test(
        original.slice(titleEnd, bodyStart),
      )
    ) {
      return true;
    }
    offset = original.indexOf(titleKey, offset + 1);
  }
  return false;
}
function sameJson(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true;
  }
  if (Array.isArray(first) && Array.isArray(second)) {
    return (
      first.length === second.length &&
      first.every((item, index) => sameJson(item, second[index]))
    );
  }
  if (object(first) && object(second)) {
    const keys = Object.keys(first);
    return (
      sameSet(keys, Object.keys(second)) &&
      keys.every(key => sameJson(first[key], second[key]))
    );
  }
  return false;
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function finite(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export class ChallengeValidationError extends Error {
  constructor(public issues: string[]) {
    super(`挑战试卷校验未通过：\n${issues.join('\n')}`);
  }
}
class Check {
  issues: string[] = [];
  require(condition: unknown, message: string) {
    if (!condition) {
      this.issues.push(message);
    }
  }
  text(value: unknown, field: string, allowEmpty = false) {
    this.require(
      typeof value === 'string' && (allowEmpty || value.trim()),
      `${field} 必须是${allowEmpty ? '' : '非空'}字符串`,
    );
  }
  texts(value: unknown, field: string, min = 0, noDuplicates = false) {
    this.require(
      strings(value) && value.length >= min && (!noDuplicates || unique(value)),
      `${field} 必须是${min ? '非空' : ''}字符串数组${
        noDuplicates ? '且不得重复' : ''
      }`,
    );
  }
  array(value: unknown, field: string, min = 0, max = 500): value is any[] {
    const valid =
      Array.isArray(value) && value.length >= min && value.length <= max;
    this.require(valid, `${field} 必须是含${min}..${max}项的数组`);
    return valid;
  }
  finish<T>(value: T): T {
    if (this.issues.length) {
      throw new ChallengeValidationError(this.issues);
    }
    return value;
  }
}
function root(value: unknown) {
  if (!object(value)) {
    throw new ChallengeValidationError(['根节点必须是JSON对象']);
  }
  return value;
}
function nullableScore(value: unknown, field: string, check: Check) {
  check.require(
    value === null || finite(value, 0, 10000),
    `${field} 必须为非负有限分数或null，不能臆造未知分值`,
  );
}
function validateBox(value: unknown, field: string, check: Check) {
  if (!object(value)) {
    check.require(false, `${field} 必须是归一化裁剪框对象`);
    return;
  }
  for (const key of ['x', 'y']) {
    check.require(
      finite(value[key], 0, 1),
      `${field}.${key} 必须为0..1有限数字`,
    );
  }
  for (const key of ['width', 'height']) {
    check.require(
      finite(value[key], Number.EPSILON, 1),
      `${field}.${key} 必须大于0且不超过1`,
    );
  }
  check.require(
    value.x + value.width <= 1 + 1e-9 && value.y + value.height <= 1 + 1e-9,
    `${field} 不得超出原页`,
  );
}
function sourceFigure(
  value: unknown,
  field: string,
  check: Check,
  expectedPage?: number,
) {
  if (!object(value)) {
    check.require(false, `${field} 必须是图形对象`);
    return;
  }
  check.text(value.id, `${field}.id`);
  check.require(value.kind === 'source', `${field}.kind 必须为source`);
  check.require(
    integer(value.pageIndex, 0, 49) &&
      (expectedPage === undefined || value.pageIndex === expectedPage),
    `${field}.pageIndex 必须对应原图页序`,
  );
  validateBox(value.box, `${field}.box`, check);
  check.text(value.caption, `${field}.caption`, true);
  check.require(
    typeof value.containsStudentMarks === 'boolean',
    `${field}.containsStudentMarks 必须明确原图是否含学生作答`,
  );
}
function drawingFigure(value: DrawingFigure, field: string, check: Check) {
  check.require(
    finite(value.width, 40, 1000) && finite(value.height, 40, 1000),
    `${field} 绘图宽高须为40..1000有限数字`,
  );
  if (!check.array(value.elements, `${field}.elements`, 1, 300)) {
    return;
  }
  const point = (x: unknown, y: unknown, suffix: string) =>
    check.require(
      finite(x, 0, value.width) && finite(y, 0, value.height),
      `${field}.${suffix} 坐标不得越过绘图范围`,
    );
  value.elements.forEach((element, index) => {
    const path = `elements[${index}]`;
    if (!object(element)) {
      check.require(false, `${field}.${path} 必须是绘图元素对象`);
      return;
    }
    if (element.kind === 'line') {
      point(element.x1, element.y1, `${path}.start`);
      point(element.x2, element.y2, `${path}.end`);
    } else if (element.kind === 'circle') {
      point(element.x, element.y, `${path}.center`);
      check.require(
        finite(element.radius, Number.EPSILON, 500) &&
          element.x - element.radius >= 0 &&
          element.y - element.radius >= 0 &&
          element.x + element.radius <= value.width &&
          element.y + element.radius <= value.height,
        `${field}.${path} 圆不得超出图形边界`,
      );
    } else if (element.kind === 'rect') {
      point(element.x, element.y, `${path}.origin`);
      check.require(
        finite(element.width, Number.EPSILON, value.width) &&
          finite(element.height, Number.EPSILON, value.height) &&
          element.x + element.width <= value.width &&
          element.y + element.height <= value.height,
        `${field}.${path} 矩形不得超出图形边界`,
      );
    } else if (element.kind === 'text') {
      point(element.x, element.y, `${path}.origin`);
      check.text(element.text, `${field}.${path}.text`);
      check.require(
        typeof element.text === 'string' && element.text.length <= 500,
        `${field}.${path}.text 太长，请改为材料正文`,
      );
    } else {
      check.require(false, `${field}.${path}.kind 只能为line/circle/rect/text`);
    }
  });
}
function sections(value: unknown, check: Check): PaperSection[] {
  if (!check.array(value, 'sections', 1, 100)) {
    return [];
  }
  value.forEach((item, index) => {
    if (!object(item)) {
      check.require(false, `sections[${index}] 必须为对象`);
      return;
    }
    check.text(item.id, `sections[${index}].id`);
    check.text(item.title, `sections[${index}].title`);
    check.text(item.instructions, `sections[${index}].instructions`, true);
  });
  check.require(unique(value.map(item => item?.id)), 'sections.id 不得重复');
  return value as PaperSection[];
}
function materials(
  value: unknown,
  figureIds: string[],
  check: Check,
): PaperMaterial[] {
  if (!check.array(value, 'materials', 0, 300)) {
    return [];
  }
  value.forEach((item, index) => {
    const field = `materials[${index}]`;
    if (!object(item)) {
      check.require(false, `${field} 必须为对象`);
      return;
    }
    check.text(item.id, `${field}.id`);
    check.text(item.title, `${field}.title`, true);
    check.text(item.text, `${field}.text`, true);
    check.require(
      typeof item.isListening === 'boolean',
      `${field}.isListening 必须为布尔值`,
    );
    check.texts(item.figureIds, `${field}.figureIds`, 0, true);
    if (strings(item.figureIds)) {
      check.require(
        item.figureIds.every((id: string) => figureIds.includes(id)),
        `${field}.figureIds 引用了不存在的图形`,
      );
    }
    check.require(
      nonempty(item.text) ||
        (Array.isArray(item.figureIds) && item.figureIds.length),
      `${field} 必须有材料正文或可见图形，不能生成空材料`,
    );
  });
  check.require(unique(value.map(item => item?.id)), 'materials.id 不得重复');
  return value as PaperMaterial[];
}
function question(
  value: unknown,
  field: string,
  sectionIds: string[],
  materialIds: string[],
  figureIds: string[],
  check: Check,
) {
  if (!object(value)) {
    check.require(false, `${field} 必须为题目对象`);
    return;
  }
  for (const key of ['id', 'number', 'sectionId', 'type', 'stem']) {
    check.text(value[key], `${field}.${key}`);
  }
  check.require(
    sectionIds.includes(value.sectionId),
    `${field}.sectionId 必须对应已有题组`,
  );
  if (check.array(value.options, `${field}.options`, 0, 20)) {
    value.options.forEach((option: unknown, index: number) => {
      if (!object(option)) {
        check.require(false, `${field}.options[${index}] 必须为对象`);
        return;
      }
      check.text(option.label, `${field}.options[${index}].label`);
      check.text(option.text, `${field}.options[${index}].text`);
    });
    check.require(
      unique(value.options.map((item: any) => item?.label)),
      `${field}.options.label 不得重复`,
    );
  }
  for (const key of ['materialIds', 'figureIds', 'knowledgePoints']) {
    check.texts(
      value[key],
      `${field}.${key}`,
      key === 'knowledgePoints' ? 1 : 0,
      true,
    );
  }
  if (strings(value.materialIds)) {
    check.require(
      value.materialIds.every((id: string) => materialIds.includes(id)),
      `${field}.materialIds 引用了不存在的材料`,
    );
  }
  if (strings(value.figureIds)) {
    check.require(
      value.figureIds.every((id: string) => figureIds.includes(id)),
      `${field}.figureIds 引用了不存在的图形`,
    );
  }
  nullableScore(value.score, `${field}.score`, check);
  check.require(
    typeof value.isListening === 'boolean',
    `${field}.isListening 必须为布尔值`,
  );
  check.require(
    integer(value.answerLines, 0, 100),
    `${field}.answerLines 必须为0..100整数`,
  );
}
function questionTotals(value: Record<string, any>, check: Check) {
  nullableScore(value.totalScore, 'totalScore', check);
  check.require(
    value.timeLimitMinutes === null || integer(value.timeLimitMinutes, 1, 720),
    'timeLimitMinutes 必须为1..720整数或null',
  );
  if (
    Array.isArray(value.questions) &&
    value.questions.length &&
    value.questions.every(
      (item: any) => object(item) && typeof item.score === 'number',
    ) &&
    typeof value.totalScore === 'number'
  ) {
    const sum = value.questions.reduce(
      (total: number, item: any) => total + item.score,
      0,
    );
    check.require(
      Math.abs(sum - value.totalScore) < 1e-6,
      `totalScore 必须等于全部独立小题分值之和${sum}，复合题不得重复计分`,
    );
  }
}

export function validateChallengePage(
  value: unknown,
  pageIndex: number,
): ChallengePage {
  const data = root(value);
  const check = new Check();
  check.require(
    integer(pageIndex, 0, 49) && data.pageIndex === pageIndex,
    'pageIndex 必须等于当前输入图片的实际页序',
  );
  check.require(
    ['exam', 'exam_continuation', 'not_exam', 'uncertain'].includes(
      data.documentType,
    ),
    'documentType 必须明确本页是否属于试卷',
  );
  check.text(
    data.text,
    'text',
    data.documentType === 'not_exam' || data.documentType === 'uncertain',
  );
  check.require(
    typeof data.hasStudentAnswers === 'boolean',
    'hasStudentAnswers 必须为布尔值',
  );
  check.texts(data.unreadableParts, 'unreadableParts');
  if (check.array(data.figures, 'figures', 0, 100)) {
    data.figures.forEach((item: unknown, index: number) =>
      sourceFigure(item, `figures[${index}]`, check, pageIndex),
    );
    check.require(
      unique(data.figures.map((item: any) => item?.id)),
      'figures.id 不得重复',
    );
  }
  return check.finish(data as ChallengePage);
}

export function subjectTitleSupportsCourse(
  subject: ChallengeSubject,
  courseName: string,
  verification: SubjectVerification,
): boolean {
  if (!CHALLENGE_SUBJECTS.includes(subject)) {
    return false;
  }
  const titles = verification.titleEvidence.map(ref => ref.quote).join('\n');
  const aliases: Record<Exclude<ChallengeSubject, 'other'>, RegExp> = {
    math: /数学|mathematics|\bmath\b/i,
    english: /英语|英文|english/i,
    chinese: /语文|chinese/i,
    physics: /物理|physics/i,
    chemistry: /化学|chemistry/i,
    biology: /生物|biology/i,
    history: /历史|history/i,
    geography: /地理|geography/i,
    politics: /政治|道德与法治|思想品德|politics|civics/i,
    science: /科学|理综|理科综合|理化合卷|物理化学合卷|science/i,
  };
  return subject === 'other'
    ? nonempty(courseName) &&
        titles
          .normalize('NFKC')
          .toLowerCase()
          .includes(courseName.normalize('NFKC').toLowerCase())
    : !!aliases[subject]?.test(titles);
}

export function validateSubjectVerification(
  value: unknown,
  pages: ChallengePage[],
): SubjectVerification {
  const data = root(value);
  const check = new Check();
  check.require(
    data.mode === 'title_sample' || data.mode === 'expanded',
    '识科核验模式必须为title_sample/expanded',
  );
  const refs = (valueRefs: unknown, path: string, min: number) => {
    if (check.array(valueRefs, path, min, 100)) {
      valueRefs.forEach((ref: unknown, index: number) => {
        check.require(
          object(ref) &&
            nonempty(ref.quote) &&
            pages.some(
              page =>
                page.pageIndex === ref.pageIndex &&
                page.text.includes(ref.quote),
            ),
          `${path}[${index}] 必须逐字来自对应原页印刷文字`,
        );
      });
    }
  };
  refs(
    data.titleEvidence,
    'titleEvidence',
    data.mode === 'title_sample' ? 1 : 0,
  );
  if (
    check.array(
      data.samples,
      'samples',
      data.mode === 'title_sample' ? 1 : 0,
      300,
    )
  ) {
    const groups: string[] = [];
    data.samples.forEach((sample: unknown, index: number) => {
      const path = `samples[${index}]`;
      if (!object(sample)) {
        check.require(false, `${path} 必须是已随机抽取的小题记录`);
        return;
      }
      for (const key of [
        'majorQuestionId',
        'majorQuestionTitle',
        'selectedQuestionId',
        'selectedQuestionNumber',
      ]) {
        check.text(sample[key], `${path}.${key}`);
      }
      check.texts(
        sample.candidateQuestionIds,
        `${path}.candidateQuestionIds`,
        1,
        true,
      );
      check.require(
        Array.isArray(sample.candidateQuestionIds) &&
          sample.candidateQuestionIds.includes(sample.selectedQuestionId),
        `${path} 抽中小题必须来自该大题完整候选集合`,
      );
      refs(sample.sourceRefs, `${path}.sourceRefs`, 1);
      groups.push(sample.majorQuestionId);
    });
    check.require(
      unique(groups),
      '每大题恰好一份随机抽样记录，不得重复或以同一题替代多组',
    );
  }
  if (data.mode === 'expanded') {
    check.text(data.expansionReason, 'expansionReason');
  }
  return JSON.parse(JSON.stringify(check.finish(data))) as SubjectVerification;
}

export function validateSubjectIdentification(
  value: unknown,
  pages: ChallengePage[],
  expectedVerification?: SubjectVerification,
): SubjectIdentification {
  const data = root(value);
  const verification =
    expectedVerification || data.verification
      ? validateSubjectVerification(
          expectedVerification || data.verification,
          pages,
        )
      : undefined;
  const check = new Check();
  check.require(
    pages.length > 0 && !pages.some(page => page.documentType === 'not_exam'),
    '科目识别只能基于实际试卷与可核实续页',
  );
  check.require(
    data.status === 'confirmed',
    '试卷科目尚未确认或存在混科，请补充科目证据或按科拆分后重新解析',
  );
  check.require(
    CHALLENGE_SUBJECTS.includes(data.subject),
    '科目识别必须使用明确支持的科目，不能把未知或混科默认归为other',
  );
  check.text(data.courseName, 'courseName');
  check.text(data.reason, 'reason');
  check.require(
    typeof data.integrated === 'boolean',
    'integrated 必须说明是否已确认的合法综合课程',
  );
  check.require(
    !data.integrated || data.subject === 'science',
    '多科拼页不能冒充单科；综合课程须有已核实科学或理综试卷结构证据',
  );
  if (data.integrated) {
    check.require(
      typeof data.courseName === 'string' &&
        /科学|理科综合|理综|理化合卷|物理化学合卷|综合测试/.test(
          data.courseName,
        ),
      '综合课程必须有明确的科学/理综课程标识和试卷证据，不能仅凭文件名',
    );
    check.require(
      Array.isArray(data.evidence) &&
        data.evidence.some(
          item =>
            object(item) &&
            nonempty(item.quote) &&
            nonempty(data.courseName) &&
            item.quote.includes(data.courseName),
        ) &&
        new Set(data.evidence.filter(object).map(item => item.quote)).size >= 2,
      '合法综合课程须有原页课程名称和不同的题组/连续试题结构引文，不能只用文件名或无关标题确认',
    );
  }
  if (check.array(data.evidence, 'evidence', 1, 100)) {
    data.evidence.forEach((item: unknown, index: number) => {
      if (!object(item)) {
        check.require(false, `evidence[${index}] 必须为原页连续引文`);
        return;
      }
      const page = pages.find(
        candidate => candidate.pageIndex === item.pageIndex,
      );
      check.require(
        !!page && nonempty(item.quote) && page.text.includes(item.quote),
        `evidence[${index}] 必须逐字来自对应印刷原页，不能引用学生作答或文件名`,
      );
    });
    if (verification?.mode !== 'title_sample') {
      check.require(
        pages.every(page =>
          data.evidence.some(
            (item: unknown) =>
              object(item) && item.pageIndex === page.pageIndex,
          ),
        ),
        '科目证据必须覆盖每一原页及续页归属，不能只引首页而忽略其它页混科',
      );
    }
    if (verification?.mode === 'title_sample') {
      check.require(
        subjectTitleSupportsCourse(data.subject, data.courseName, verification),
        '标题缺少对应科目线索或与识科结果冲突，应扩大整卷核验而非强套标题',
      );
      const includesRef = (ref: {pageIndex: number; quote: string}) =>
        data.evidence.some(
          (evidence: unknown) =>
            object(evidence) &&
            evidence.pageIndex === ref.pageIndex &&
            evidence.quote === ref.quote,
        );
      check.require(
        verification.titleEvidence.some(includesRef),
        '标题优先识科须保留原印刷标题引文，不能用文件名或自报科名替代',
      );
      verification.samples.forEach(sample =>
        check.require(
          sample.sourceRefs.some(includesRef),
          `大题${sample.majorQuestionTitle}抽中的${sample.selectedQuestionNumber}小题必须有真实原锚佐证，不能漏核或换题`,
        ),
      );
    }
  }
  if (data.subject === 'other') {
    check.require(
      !nonempty(data.courseName) ||
        !/^(?:数学|语文|英语|英文|物理|化学|生物|生物学|历史|地理|政治|道德与法治|思想政治|科学|理科综合|理综|理化合卷|物理化学合卷)$/u.test(
          data.courseName.normalize('NFKC').replace(/\s+/gu, ''),
        ),
      'other 只用于索引未单列的具体课程，已支持的数学/英语等科目必须路由到对应科目规则',
    );
    check.require(
      nonempty(data.courseName) &&
        !/未知|未识别|未确认|待确认|不明|不确定|混科|^(?:unknown|unidentified|unconfirmed|uncertain|mixed)\b/iu.test(
          data.courseName,
        ) &&
        !/^(?:其[他它](?:学科|课程|科目)?|未知(?:科目)?|未识别|不确定|综合(?:试卷|课程|测试)?|混科|混合试卷|unknown|other|mixed|uncertain)$/iu.test(
          data.courseName.trim(),
        ),
      'other 只能表示已经识别的具体课程，不能作为未知/混科兜底',
    );
    check.require(
      Array.isArray(data.evidence) &&
        data.evidence.some(
          item =>
            object(item) &&
            nonempty(item.quote) &&
            nonempty(data.courseName) &&
            item.quote.includes(data.courseName),
        ),
      '其他具体课程必须有原页科目名称证据，不能无依据自定课程',
    );
  }
  const valid = check.finish(data);
  return {
    status: 'confirmed',
    subject: valid.subject,
    courseName: valid.courseName,
    integrated: valid.integrated,
    reason: valid.reason,
    evidence: valid.evidence.map(
      (item: {pageIndex: number; quote: string}) => ({
        pageIndex: item.pageIndex,
        quote: item.quote,
      }),
    ),
    ...(verification ? {verification} : {}),
  };
}

function validateExamContent(
  value: unknown,
  pages: ChallengePage[],
  samplingDraft: boolean,
): ExamAnalysis | ExamDraft {
  const parsed = root(value);
  const data: Record<string, any> = {
    ...parsed,
    subjectIdentification: undefined,
  };
  const check = new Check();
  check.require(
    data.isExam === true,
    '上传内容必须是可确认的试卷，不能对非试卷内容升档',
  );
  check.require(
    pages.length > 0 && pages.length <= 50,
    '原试卷必须包含1..50页',
  );
  check.require(
    !pages.some(page => page.documentType === 'not_exam'),
    '上传页面包含非试卷内容，请移除或更换',
  );
  check.require(
    unique(pages.map(page => String(page.pageIndex))),
    '原图页序不得重复',
  );
  for (const key of ['title', 'subjectLabel', 'difficultySummary']) {
    check.text(data[key], key);
  }
  check.require(
    CHALLENGE_SUBJECTS.includes(data.subject) ||
      (samplingDraft && data.subject === 'unknown'),
    'subject 必须使用支持的学科id，草稿不明时仅可unknown且不能生成',
  );
  check.require(
    ['middle', 'high', 'unknown'].includes(data.educationLevel),
    'educationLevel 必须为middle/high/unknown',
  );
  check.require(
    data.difficultyBasis === 'estimated',
    'difficultyBasis 必须为estimated，不得伪造实测难度或正确率',
  );
  check.require(
    ['blank', 'answered', 'mixed'].includes(data.answerState),
    'answerState 必须区分空白、已作答或混合',
  );
  check.texts(data.knowledgePoints, 'knowledgePoints', 1, true);
  check.texts(data.warnings, 'warnings');
  check.texts(data.unresolvedIssues, 'unresolvedIssues');
  if (pages.some(page => page.unreadableParts.length)) {
    check.require(
      Array.isArray(data.unresolvedIssues) && data.unresolvedIssues.length,
      '原页仍有辨认不清内容，必须保留unresolvedIssues，不能凭空补齐',
    );
  }
  const allFigures = pages.flatMap(page => page.figures);
  let sourceFigures: SourceFigure[] = [];
  if (check.array(data.figures, 'figures', 0, 300)) {
    sourceFigures = data.figures;
    sourceFigures.forEach((item, index) => {
      sourceFigure(item, `figures[${index}]`, check);
      check.require(
        allFigures.some(source => sameJson(source, item)),
        `figures[${index}] 必须逐字采用原页解析的图形坐标与学生标记信息`,
      );
    });
    check.require(
      unique(sourceFigures.map(item => item?.id)),
      'figures.id 不得重复',
    );
    check.require(
      sameSet(
        sourceFigures.map(item => item?.id),
        allFigures.map(item => item.id),
      ),
      'figures 必须完整保留原页图形清单',
    );
  }
  const parsedSections = sections(data.sections, check);
  const parsedMaterials = materials(
    data.materials,
    sourceFigures.map(item => item?.id),
    check,
  );
  parsedMaterials.forEach((material, index) => {
    if (
      object(material) &&
      typeof material.title === 'string' &&
      /听力原文|录音原文|听力文本|转写|transcript/i.test(material.title) &&
      typeof material.text === 'string'
    ) {
      check.require(
        /[\p{L}\p{N}]/u.test(material.text) &&
          transcriptSourceExists(material.title, material.text, pages),
        `materials[${index}] 声称有听力原文或转写，必须将原页可见的标识标题与正文一起溯源，不能改名、伪造或采信学生填答`,
      );
    }
  });
  if (check.array(data.questions, 'questions', 1, 300)) {
    data.questions.forEach((item: unknown, index: number) => {
      const field = `questions[${index}]`;
      question(
        item,
        field,
        parsedSections.map(section => section?.id),
        parsedMaterials.map(material => material?.id),
        sourceFigures.map(sourceImage => sourceImage?.id),
        check,
      );
      if (!object(item)) {
        return;
      }
      if (typeof item.stem === 'string') {
        const transcript = item.stem.match(
          /(听力原文|录音原文|转写|transcript)\s*[:：]([\s\S]+)/i,
        );
        if (transcript) {
          check.require(
            /[\p{L}\p{N}]/u.test(transcript[2]) &&
              transcriptSourceExists(transcript[1], transcript[2], pages),
            `${field}.stem 中的听力原文或转写必须连同原页可见标识一起溯源，不能追加虚构录音文本`,
          );
        }
      }
      if (strings(item.knowledgePoints) && strings(data.knowledgePoints)) {
        check.require(
          item.knowledgePoints.every((point: string) =>
            data.knowledgePoints.includes(point),
          ),
          `${field}.knowledgePoints 超出全卷声明范围`,
        );
      }
      if (!object(item.difficulty)) {
        check.require(false, `${field}.difficulty 必须有估计难度及依据`);
      } else {
        check.require(
          integer(item.difficulty.rating, 1, 10),
          `${field}.difficulty.rating 必须为1..10估计等级`,
        );
        check.require(
          integer(item.difficulty.reasoningSteps, 0, 50),
          `${field}.difficulty.reasoningSteps 必须为0..50整数`,
        );
        check.text(
          item.difficulty.explanation,
          `${field}.difficulty.explanation`,
        );
      }
      if (check.array(item.sourceRefs, `${field}.sourceRefs`, 1, 50)) {
        item.sourceRefs.forEach((reference: unknown, refIndex: number) => {
          if (!object(reference)) {
            check.require(false, `${field}.sourceRefs[${refIndex}] 必须为对象`);
            return;
          }
          const source = pages.find(
            page => page.pageIndex === reference.pageIndex,
          );
          check.require(
            !!source &&
              nonempty(reference.quote) &&
              source.text.includes(reference.quote),
            `${field}.sourceRefs[${refIndex}] 必须引用对应原页text的连续文字`,
          );
        });
      }
    });
    check.require(
      unique(data.questions.map((item: any) => item?.id)),
      'questions.id 不得重复',
    );
    check.require(
      unique(data.questions.map((item: any) => item?.number)),
      'questions.number 不得重复，复合题请保留独立小题编号',
    );
    if (strings(data.knowledgePoints)) {
      const usedPoints = data.questions.flatMap((item: any) =>
        strings(item?.knowledgePoints) ? item.knowledgePoints : [],
      );
      check.require(
        data.knowledgePoints.every((point: string) =>
          usedPoints.includes(point),
        ),
        '全卷knowledgePoints只能列出有原题证据的考点，不得添加未考查知识',
      );
    }
  }
  if (
    samplingDraft ||
    data.titleEvidence !== undefined ||
    data.majorQuestions !== undefined
  ) {
    const refs = (items: unknown, field: string, min: number) => {
      if (check.array(items, field, min, 100)) {
        items.forEach((ref: unknown, index: number) =>
          check.require(
            object(ref) &&
              nonempty(ref.quote) &&
              pages.some(
                page =>
                  page.pageIndex === ref.pageIndex &&
                  page.text.includes(ref.quote),
              ),
            `${field}[${index}] 必须逐字引用原页印刷内容`,
          ),
        );
      }
    };
    refs(data.titleEvidence, 'titleEvidence', 0);
    if (check.array(data.majorQuestions, 'majorQuestions', 0, 300)) {
      data.majorQuestions.forEach((major: unknown, index: number) => {
        if (!object(major)) {
          check.require(false, `majorQuestions[${index}] 必须是原印刷大题结构`);
          return;
        }
        check.text(major.id, `majorQuestions[${index}].id`);
        check.text(major.title, `majorQuestions[${index}].title`);
        refs(major.sourceRefs, `majorQuestions[${index}].sourceRefs`, 1);
      });
      const ids = data.majorQuestions
        .filter(object)
        .map((major: Record<string, any>) => major.id);
      check.require(unique(ids), 'majorQuestions.id 不得重复');
      if (Array.isArray(data.questions)) {
        data.questions.forEach((questionItem: unknown, index: number) => {
          if (
            object(questionItem) &&
            questionItem.majorQuestionId !== undefined
          ) {
            check.require(
              ids.includes(questionItem.majorQuestionId),
              `questions[${index}].majorQuestionId 必须归属已识别的大题`,
            );
          }
        });
      }
    }
  }
  questionTotals(data, check);
  return check.finish(data as ExamAnalysis);
}

export function validateExamDraft(
  value: unknown,
  pages: ChallengePage[],
): ExamDraft {
  return validateExamContent(value, pages, true) as ExamDraft;
}

export function validateExamAnalysis(
  value: unknown,
  pages: ChallengePage[],
  identification?: SubjectIdentification,
): ExamAnalysis {
  const parsed = root(value);
  const identified = validateSubjectIdentification(
    identification || parsed.subjectIdentification,
    pages,
  );
  const content = validateExamContent(value, pages, false);
  if (content.subject !== identified.subject) {
    throw new ChallengeValidationError([
      '整卷分析科目必须与独立识科结果一致，不能换科套规则',
    ]);
  }
  return {
    ...content,
    subject: identified.subject,
    subjectIdentification: identified,
  };
}

function substantive(value: unknown) {
  return typeof value === 'string'
    ? (
        value.normalize('NFKC').match(/[\p{L}\p{N}]+|[+\-*/=<>≤≥≠^%()]/gu) || []
      ).join('|')
    : '';
}

function depthEvidence(
  item: Record<string, any>,
  source: PaperQuestion,
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  generatedMaterials: PaperMaterial[],
  generatedFigures: ChallengeFigure[],
  answers: unknown,
  field: string,
  check: Check,
) {
  const upgrade = item.upgrade;
  const evidenceField = `${field}.upgrade`;
  if (source.isListening) {
    for (const key of [
      'directionEvidence',
      'directionConnections',
      'depthChecks',
    ]) {
      check.require(
        upgrade[key] === undefined ||
          (Array.isArray(upgrade[key]) && upgrade[key].length === 0),
        `${evidenceField}.${key} 听力保持不变，不得附加升难方向或深挖要求`,
      );
    }
    check.require(
      upgrade.depthRoute === undefined || upgrade.depthRoute === 'combined',
      `${evidenceField}.depthRoute 听力不得使用聚焦升难路线`,
    );
    return;
  }

  const policy = getChallengePolicy(analysis.subject, level);
  const applicableDirections = applicableChallengeDirections(
    analysis.subject,
    level,
    source,
    analysis.materials,
  );
  const allowedIds = applicableDirections.map(direction => direction.id);
  const requirements = policy.depthRequirements;
  const focused = upgrade.depthRoute === 'focused';
  const focusedRequirements = requirements.focusedRoute;
  check.require(
    upgrade.depthRoute === 'combined' ||
      (focused && analysis.subject === 'math' && !!focusedRequirements),
    `${evidenceField}.depthRoute 必须为combined，或本档数学标准允许的focused`,
  );
  const minimumDirections =
    focused && focusedRequirements
      ? focusedRequirements.minDirections
      : requirements.minDirections;
  const selected: unknown[] = Array.isArray(upgrade.directionEvidence)
    ? upgrade.directionEvidence
    : [];
  const directionIds: string[] = selected
    .filter(object)
    .map(evidence => evidence.directionId);
  const answer = Array.isArray(answers)
    ? answers.find(
        candidate => object(candidate) && candidate.questionId === source.id,
      )
    : undefined;
  const solutionTexts: string[] = object(answer)
    ? [
        answer.explanation,
        ...(Array.isArray(answer.scoringPoints) ? answer.scoringPoints : []),
      ].filter(nonempty)
    : [];
  const problemTexts: string[] = [
    item.stem,
    ...(Array.isArray(item.options)
      ? item.options.filter(object).map(option => option.text)
      : []),
    ...generatedMaterials
      .filter(
        material =>
          object(material) && source.materialIds.includes(material.id),
      )
      .flatMap(material => [material.title, material.text]),
    ...generatedFigures
      .filter(
        figureItem =>
          object(figureItem) &&
          [
            ...source.figureIds,
            ...analysis.materials
              .filter(material => source.materialIds.includes(material.id))
              .flatMap(material => material.figureIds),
          ].includes(figureItem.id),
      )
      .map(figureItem => figureItem.caption),
  ].filter(nonempty);
  const quote = (value: unknown, texts: string[], path: string) => {
    check.require(
      nonempty(value) &&
        !!substantive(value) &&
        texts.some(text => text.includes(value)),
      `${path} 必须逐字引用本题实际题文或对应答案解析，不能引用别题、伪造证据或仅写方法名`,
    );
  };

  if (
    check.array(
      upgrade.directionEvidence,
      `${evidenceField}.directionEvidence`,
      minimumDirections,
      50,
    )
  ) {
    check.require(
      unique(directionIds),
      `${evidenceField}.directionEvidence.directionId 不得重复计数`,
    );
    const newDemands: string[] = [];
    selected.forEach((evidence: unknown, index: number) => {
      const path = `${evidenceField}.directionEvidence[${index}]`;
      if (!object(evidence)) {
        check.require(false, `${path} 必须为方向增量证据对象`);
        return;
      }
      check.require(
        allowedIds.includes(evidence.directionId),
        `${path}.directionId 必须属于原题任务适用的本学科深化方向，不能由新题自报标签扩展适用范围`,
      );
      for (const key of ['originalDemand', 'newDemand', 'necessity']) {
        check.text(evidence[key], `${path}.${key}`);
      }
      check.require(
        substantive(evidence.originalDemand) !==
          substantive(evidence.newDemand),
        `${path} 必须说明相对原题新增或实质加强的要求，原要求原样保留不计增量`,
      );
      const direction = applicableDirections.find(
        candidate => candidate.id === evidence.directionId,
      );
      if (direction) {
        check.require(
          [evidence.newDemand, evidence.necessity].every(
            value =>
              !!substantive(value) &&
              substantive(value) !== substantive(direction.name) &&
              substantive(value) !== substantive(direction.id),
          ),
          `${path} 必须说明该策略在有效解法中的具体职责，不能只贴方向名称`,
        );
      }
      newDemands.push(substantive(evidence.newDemand));
      quote(evidence.problemQuote, problemTexts, `${path}.problemQuote`);
      quote(evidence.solutionQuote, solutionTexts, `${path}.solutionQuote`);
    });
    check.require(
      unique(newDemands),
      `${evidenceField}.directionEvidence 不能把同一新要求重复贴多个方向标签`,
    );
  }

  const connections = Array.isArray(upgrade.directionConnections)
    ? upgrade.directionConnections
    : [];
  const minimumConnections = Math.max(
    focused ? 0 : requirements.minConnections,
    directionIds.length - 1,
  );
  const graph = new Map(directionIds.map(id => [id, new Set<string>()]));
  const pairs: string[] = [];
  if (
    check.array(
      upgrade.directionConnections,
      `${evidenceField}.directionConnections`,
      minimumConnections,
      100,
    )
  ) {
    connections.forEach((connection: unknown, index: number) => {
      const path = `${evidenceField}.directionConnections[${index}]`;
      if (!object(connection)) {
        check.require(false, `${path} 必须为方向联系对象`);
        return;
      }
      const validEndpoints =
        directionIds.includes(connection.from) &&
        directionIds.includes(connection.to) &&
        connection.from !== connection.to;
      check.require(
        validEndpoints,
        `${path} 必须联系两个已选且不同的方向，不得自连或指向外部方向`,
      );
      if (validEndpoints) {
        graph.get(connection.from)?.add(connection.to);
        graph.get(connection.to)?.add(connection.from);
        pairs.push([connection.from, connection.to].sort().join('|'));
      }
      check.text(connection.explanation, `${path}.explanation`);
      quote(connection.solutionQuote, solutionTexts, `${path}.solutionQuote`);
    });
    check.require(
      unique(pairs),
      `${evidenceField}.directionConnections 相同方向对不得倒序或重复计数`,
    );
    const visited = new Set<string>();
    const pending = directionIds.length ? [directionIds[0]] : [];
    while (pending.length) {
      const id = pending.pop()!;
      if (!visited.has(id)) {
        visited.add(id);
        pending.push(...(graph.get(id) || []));
      }
    }
    check.require(
      visited.size === new Set(directionIds).size,
      `${evidenceField}.directionConnections 必须使全部所选方向整体连通，不能用互不相干的分组凑数`,
    );
  }

  if (!focused) {
    check.require(
      upgrade.depthChecks === undefined ||
        (Array.isArray(upgrade.depthChecks) &&
          upgrade.depthChecks.length === 0),
      `${evidenceField}.depthChecks 组合路线不应叠加聚焦路线的计数`,
    );
    return;
  }
  if (
    !check.array(upgrade.depthChecks, `${evidenceField}.depthChecks`, 1, 50)
  ) {
    return;
  }
  const descriptions: string[] = [];
  const solutionChecks: string[] = [];
  let decisions = 0;
  let boundaries = 0;
  upgrade.depthChecks.forEach((entry: unknown, index: number) => {
    const path = `${evidenceField}.depthChecks[${index}]`;
    if (!object(entry)) {
      check.require(false, `${path} 必须为关键决策或边界检查对象`);
      return;
    }
    check.require(
      entry.kind === 'decision' || entry.kind === 'boundary',
      `${path}.kind 只能为decision/boundary`,
    );
    decisions += entry.kind === 'decision' ? 1 : 0;
    boundaries += entry.kind === 'boundary' ? 1 : 0;
    check.text(entry.description, `${path}.description`);
    check.text(entry.explanation, `${path}.explanation`);
    quote(entry.problemQuote, problemTexts, `${path}.problemQuote`);
    quote(entry.solutionQuote, solutionTexts, `${path}.solutionQuote`);
    descriptions.push(substantive(entry.description));
    solutionChecks.push(`${entry.kind}:${substantive(entry.solutionQuote)}`);
  });
  check.require(
    unique(descriptions) && unique(solutionChecks),
    `${evidenceField}.depthChecks 不同关键决策/边界须有不同的实际推理，不能重复配对、拆步或改写同一检查凑数`,
  );
  if (focusedRequirements) {
    check.require(
      decisions >= focusedRequirements.minDecisions,
      `${evidenceField}.depthChecks 至少${focusedRequirements.minDecisions}个不同关键决策`,
    );
    check.require(
      boundaries >= focusedRequirements.minBoundaryChecks,
      `${evidenceField}.depthChecks 至少${focusedRequirements.minBoundaryChecks}个不同真实边界检查`,
    );
  }
}
function validChoiceLabels(answer: string, labels: string[]) {
  const value = answer
    .trim()
    .replace(/^(?:答案|选择|选项|选|answer)\s*[:：]?\s*/i, '')
    .replace(/[()（）【】[\]]/g, '');
  if (
    labels.every(label => /^[A-Za-z]$/.test(label)) &&
    /^[A-Za-z\s,，、;；/|]+$/.test(value)
  ) {
    return value
      .toUpperCase()
      .replace(/[\s,，、;；/|]/g, '')
      .split('');
  }
  return value.split(/[\s,，、;；/|]+/).filter(Boolean);
}
function hasListeningTranscript(
  questionItem: PaperQuestion,
  analysis: ExamAnalysis,
) {
  const materialsForQuestion = analysis.materials.filter(material =>
    questionItem.materialIds.includes(material.id),
  );
  return (
    materialsForQuestion.some(
      material =>
        /听力原文|录音原文|听力文本|转写|transcript/i.test(material.title) &&
        /[\p{L}\p{N}]/u.test(material.text),
    ) ||
    /(?:听力原文|录音原文|转写|transcript)\s*[:：][\s\S]*[\p{L}\p{N}]/iu.test(
      questionItem.stem,
    )
  );
}
function figure(
  value: unknown,
  index: number,
  analysis: ExamAnalysis,
  check: Check,
): void {
  const field = `figures[${index}]`;
  if (!object(value)) {
    check.require(false, `${field} 必须为图形对象`);
    return;
  }
  check.text(value.id, `${field}.id`);
  check.text(value.caption, `${field}.caption`, true);
  const source = analysis.figures.find(item => item.id === value.id);
  check.require(
    !!source,
    `${field}.id 必须来自原试卷图形，不能新增无来源的图题结构`,
  );
  if (value.kind === 'source') {
    sourceFigure(value, field, check);
    check.require(
      !!source && sameJson(source, value),
      `${field} 不得修改原图来源、裁剪位置或隐瞒学生标记`,
    );
    check.require(
      source?.containsStudentMarks === false,
      `${field} 原图含学生作答标记，必须用drawing重建干净图形，不能把学生答案印进新试卷`,
    );
  } else if (value.kind === 'drawing') {
    drawingFigure(value as DrawingFigure, field, check);
  } else {
    check.require(false, `${field}.kind 只能为source/drawing`);
  }
}

export function validateChallengePaper(
  value: unknown,
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): ChallengePaper {
  if (
    analysis.subjectIdentification?.status !== 'confirmed' ||
    analysis.subjectIdentification.subject !== analysis.subject
  ) {
    throw new ChallengeValidationError([
      '原卷科目尚未独立确认，请重新识科解析后再按科生成',
    ]);
  }
  const data = root(value);
  const check = new Check();
  check.require(
    analysis.isExam === true && analysis.unresolvedIssues.length === 0,
    '原试卷尚有未解决内容，必须先补齐或重新解析，不能生成新卷',
  );
  check.require(
    [1, 2, 3].includes(level) && data.level === level,
    'level 必须与用户选择的1..3档完全一致',
  );
  check.require(data.subject === analysis.subject, 'subject 必须保持原学科');
  check.require(
    data.masteryStatus === 'training_only',
    'masteryStatus 必须为training_only，生成试卷和解析只表示掌握训练目标，不能认证学生已掌握',
  );
  check.text(data.title, 'title');
  const originalSectionIds = analysis.sections.map(item => item.id);
  const parsedSections = sections(data.sections, check);
  check.require(
    sameList(
      parsedSections.map(item => item?.id),
      originalSectionIds,
    ),
    'sections 必须保持原题组ID、数量与顺序',
  );
  analysis.sections.forEach((section, index) => {
    if (
      analysis.questions.some(
        item => item.sectionId === section.id && item.isListening,
      )
    ) {
      check.require(
        sameJson(parsedSections[index], section),
        `sections[${index}] 听力题组标题与指示必须原样保留，不能改变听几遍等作答条件`,
      );
    }
  });
  const generatedFigures: ChallengeFigure[] = Array.isArray(data.figures)
    ? data.figures
    : [];
  if (check.array(data.figures, 'figures', 0, 300)) {
    generatedFigures.forEach((item, index) =>
      figure(item, index, analysis, check),
    );
    check.require(
      unique(generatedFigures.map(item => item?.id)),
      'figures.id 不得重复',
    );
    check.require(
      sameList(
        generatedFigures.map(item => item?.id),
        analysis.figures.map(item => item.id),
      ),
      'figures 必须保持原图形ID、数量与顺序，不能丢图',
    );
  }
  const parsedMaterials = materials(
    data.materials,
    generatedFigures.map(item => item?.id),
    check,
  );
  check.require(
    sameList(
      parsedMaterials.map(item => item?.id),
      analysis.materials.map(item => item.id),
    ),
    'materials 必须保留共享材料ID、数量与顺序',
  );
  parsedMaterials.forEach((material, index) => {
    const originalMaterial = analysis.materials[index];
    if (!object(material) || !originalMaterial) {
      return;
    }
    check.require(
      material.isListening === originalMaterial.isListening &&
        sameList(material.figureIds || [], originalMaterial.figureIds),
      `materials[${index}] 不得修改听力标记或丢失材料图形`,
    );
    const usedByListening = analysis.questions.some(
      item =>
        item.isListening && item.materialIds.includes(originalMaterial.id),
    );
    if (originalMaterial.isListening || usedByListening) {
      check.require(
        sameJson(material, originalMaterial),
        `materials[${index}] 听力及听力共享材料必须完整保留，不得改写`,
      );
    }
  });
  if (check.array(data.questions, 'questions', 1, 300)) {
    check.require(
      data.questions.length === analysis.questions.length,
      'questions 必须逐题对应原卷，不得漏题、合题或新增题目',
    );
    data.questions.forEach((item: unknown, index: number) => {
      const field = `questions[${index}]`;
      question(
        item,
        field,
        originalSectionIds,
        parsedMaterials.map(material => material?.id),
        generatedFigures.map(itemFigure => itemFigure?.id),
        check,
      );
      const source = analysis.questions[index];
      if (!object(item) || !source) {
        return;
      }
      for (const key of [
        'id',
        'number',
        'sectionId',
        'type',
        'score',
        'isListening',
      ] as const) {
        check.require(
          item[key] === source[key],
          `${field}.${key} 必须与对应原题一致，不能改变题型、编号或分值`,
        );
      }
      for (const key of ['materialIds', 'figureIds'] as const) {
        check.require(
          Array.isArray(item[key]) && sameList(item[key], source[key]),
          `${field}.${key} 必须保持原题材料和图形关系`,
        );
      }
      check.require(
        Array.isArray(item.options) &&
          sameList(
            item.options.map((option: any) => option?.label),
            source.options.map(option => option.label),
          ),
        `${field}.options 必须保持选项数量、标签与顺序`,
      );
      if (strings(item.knowledgePoints)) {
        check.require(
          sameSet(item.knowledgePoints, source.knowledgePoints) &&
            item.knowledgePoints.every(
              (point: string) =>
                source.knowledgePoints.includes(point) &&
                analysis.knowledgePoints.includes(point),
            ),
          `${field}.knowledgePoints 必须保留对应原题全部核心考查目标，不得新增、删除或超出全卷范围`,
        );
      }
      if (!object(item.upgrade)) {
        check.require(false, `${field}.upgrade 必须说明逐题升档指标`);
        return;
      }
      const upgrade = item.upgrade;
      check.require(
        upgrade.level === level,
        `${field}.upgrade.level 必须与当前升档一致`,
      );
      depthEvidence(
        item,
        source,
        analysis,
        level,
        parsedMaterials,
        generatedFigures,
        data.answers,
        field,
        check,
      );
      check.text(upgrade.scopeExplanation, `${field}.upgrade.scopeExplanation`);
      check.texts(
        upgrade.changes,
        `${field}.upgrade.changes`,
        source.isListening ? 0 : 1,
        true,
      );
      check.texts(
        upgrade.pitfalls,
        `${field}.upgrade.pitfalls`,
        source.isListening ? 0 : 1,
        true,
      );
      for (const key of ['changes', 'pitfalls']) {
        if (strings(upgrade[key])) {
          const substantiveEntries = upgrade[key].map(substantive);
          check.require(
            substantiveEntries.every(Boolean) && unique(substantiveEntries),
            `${field}.upgrade.${key} 必须是不同实质条件或错误来源，不能靠空格、标点和重复内容凑指标`,
          );
        }
      }
      if (!object(upgrade.metrics)) {
        check.require(false, `${field}.upgrade.metrics 必须为数字指标对象`);
        return;
      }
      check.require(
        Object.values(upgrade.metrics).every(metric => integer(metric, 0, 100)),
        `${field}.upgrade.metrics 必须使用0..100有限整数`,
      );
      if (source.isListening) {
        for (const key of [
          'stem',
          'options',
          'knowledgePoints',
          'answerLines',
        ] as const) {
          check.require(
            sameJson(item[key], source[key]),
            `${field}.${key} 听力题必须原样保留`,
          );
        }
        check.require(
          Array.isArray(upgrade.changes) &&
            upgrade.changes.length === 0 &&
            Array.isArray(upgrade.pitfalls) &&
            upgrade.pitfalls.length === 0 &&
            Object.values(upgrade.metrics).every(metric => metric === 0),
          `${field} 听力不升档，changes/pitfalls须空且全部指标须为0`,
        );
        const listeningMaterialFigures = analysis.materials
          .filter(material => source.materialIds.includes(material.id))
          .flatMap(material => material.figureIds);
        [
          ...new Set([...source.figureIds, ...listeningMaterialFigures]),
        ].forEach(id => {
          const before = analysis.figures.find(
            itemFigure => itemFigure.id === id,
          );
          const after = generatedFigures.find(
            itemFigure => itemFigure?.id === id,
          );
          check.require(
            sameJson(after, before) ||
              (before?.containsStudentMarks === true &&
                after?.kind === 'drawing'),
            `${field} 听力图形不得变化；只有含学生标记的原图可等内容重建以清除作答`,
          );
        });
      } else {
        const ownChanged =
          nonempty(item.stem) &&
          substantive(item.stem) !== substantive(source.stem);
        const optionsChanged =
          Array.isArray(item.options) &&
          item.options.some(
            (option: any, optionIndex: number) =>
              nonempty(option?.text) &&
              substantive(option.text) !==
                substantive(source.options[optionIndex]?.text || ''),
          );
        const materialChanged = source.materialIds.some(id => {
          const before = analysis.materials.find(
            material => material.id === id,
          );
          const after = parsedMaterials.find(material => material?.id === id);
          return (
            before &&
            after &&
            substantive(after.text) !== substantive(before.text)
          );
        });
        check.require(
          ownChanged || optionsChanged || materialChanged,
          `${field} 必须形成实质变种，不能原样照抄或仅改标点空格`,
        );
        const metrics = applicableChallengeMetrics(
          analysis.subject,
          level,
          source,
          analysis.materials,
        );
        for (const metric of metrics) {
          check.require(
            integer(upgrade.metrics[metric.key], metric.min, metric.max ?? 100),
            `${field}.upgrade.metrics.${metric.key} 必须为${metric.min}..${
              metric.max ?? 100
            }，并在changes及解题中有实际依据`,
          );
        }
        check.require(
          !Array.isArray(upgrade.changes) ||
            upgrade.metrics.changedConditions === upgrade.changes.length,
          `${field}.upgrade.metrics.changedConditions 必须等于实际changes条数`,
        );
        check.require(
          !Array.isArray(upgrade.pitfalls) ||
            upgrade.metrics.pitfallDistinctions === upgrade.pitfalls.length,
          `${field}.upgrade.metrics.pitfallDistinctions 必须等于实际pitfalls条数`,
        );
        if (isWritingQuestion(source) && strings(upgrade.changes)) {
          const pairedChanges = upgrade.changes.filter((change: string) =>
            /→|->|原.{1,100}(?:新|改为|加强|调整)/.test(change),
          );
          check.require(
            integer(upgrade.metrics.writingConstraints, 1, 4) &&
              pairedChanges.length >= upgrade.metrics.writingConstraints,
            `${field} 写作升档要求必须在changes逐条给出“原要求→新要求”对照，不能把原有要求重新计数`,
          );
        }
      }
    });
  }
  questionTotals(data, check);
  check.require(
    data.totalScore === analysis.totalScore &&
      data.timeLimitMinutes === analysis.timeLimitMinutes,
    '新卷总分与考试时间必须沿用原卷，未知值保持null',
  );
  if (
    check.array(
      data.answers,
      'answers',
      analysis.questions.length,
      analysis.questions.length,
    )
  ) {
    check.require(
      unique(data.answers.map((item: any) => item?.questionId)),
      'answers.questionId 不得重复，每题恰有一份答案',
    );
    data.answers.forEach((item: unknown, index: number) => {
      const field = `answers[${index}]`;
      if (!object(item)) {
        check.require(false, `${field} 必须为答案对象`);
        return;
      }
      const questionItem = Array.isArray(data.questions)
        ? data.questions.find(
            (candidate: any) => candidate?.id === item.questionId,
          )
        : undefined;
      const source = analysis.questions.find(
        candidate => candidate.id === item.questionId,
      );
      check.require(
        !!questionItem && !!source,
        `${field}.questionId 必须对应原题`,
      );
      check.require(
        item.status === 'verified' || item.status === 'requires_audio',
        `${field}.status 只能为verified/requires_audio`,
      );
      check.text(
        item.answer,
        `${field}.answer`,
        item.status === 'requires_audio',
      );
      check.text(item.explanation, `${field}.explanation`);
      check.texts(
        item.scoringPoints,
        `${field}.scoringPoints`,
        item.status === 'requires_audio' ? 0 : 1,
      );
      if (!source || !questionItem) {
        return;
      }
      validateLearningGuides(
        item,
        questionItem,
        source,
        analysis,
        level,
        parsedMaterials,
        generatedFigures,
        field,
        check,
      );
      if (item.status === 'requires_audio') {
        check.require(
          source.isListening,
          `${field} 只有听力题能标记requires_audio，其他题必须给出确定答案和解析`,
        );
        check.require(
          typeof item.answer === 'string' &&
            (!item.answer.trim() ||
              /待核|无法确定|需.*(?:录音|音频)|未提供.*(?:录音|音频)/.test(
                item.answer,
              )) &&
            typeof item.explanation === 'string' &&
            /待核|录音|音频|转写/.test(item.explanation),
          `${field}.answer 必须明确听力待核，不能猜测选项`,
        );
      } else if (source.isListening) {
        check.require(
          hasListeningTranscript(source, analysis),
          `${field} 未提供听力原录音转写，不得将学生填答或猜测标为verified，应标requires_audio`,
        );
      }
      const optionQuestion =
        Array.isArray(questionItem.options) &&
        questionItem.options.length > 0 &&
        !isWritingQuestion(source);
      if (
        item.status === 'verified' &&
        optionQuestion &&
        typeof item.answer === 'string'
      ) {
        const labels = questionItem.options.map((option: any) => option.label);
        const selected = validChoiceLabels(item.answer, labels);
        check.require(
          selected.length > 0 &&
            unique(selected) &&
            selected.every(label => labels.includes(label)),
          `${field}.answer 必须引用实际选项标签且不得重复`,
        );
        const multiple =
          /多项|多选|不定项|multiple[_ -]?(?:choice|select)|multi[_ -]?(?:choice|select)/i.test(
            source.type,
          );
        if (!multiple) {
          check.require(
            selected.length === 1,
            `${field} 单选题必须恰有一个正确选项`,
          );
        }
      }
    });
  }
  return check.finish(data as ChallengePaper);
}

export function validateChallengeReview(
  value: unknown,
  role: ChallengeReviewRole,
  paper: ChallengePaper,
): ChallengeReview {
  const data = root(value);
  const check = new Check();
  check.require(
    CHALLENGE_REVIEW_ROLES.includes(role) && data.role === role,
    'role 必须与当前指定的校核角色完全一致',
  );
  check.require(
    data.verdict === 'approve' || data.verdict === 'revise',
    'verdict 必须为approve/revise',
  );
  check.text(data.summary, 'summary');
  check.texts(
    data.checkedQuestionIds,
    'checkedQuestionIds',
    paper.questions.length,
    true,
  );
  check.require(
    strings(data.checkedQuestionIds) &&
      sameSet(
        data.checkedQuestionIds,
        paper.questions.map(item => item.id),
      ),
    'checkedQuestionIds 必须恰好覆盖所有题目，不得漏审或新增题ID',
  );
  if (check.array(data.issues, 'issues', 0, paper.questions.length * 10 + 20)) {
    data.issues.forEach((issue: unknown, index: number) => {
      if (!object(issue)) {
        check.require(false, `issues[${index}] 必须为对象`);
        return;
      }
      check.require(
        issue.questionId === '*' ||
          paper.questions.some(item => item.id === issue.questionId),
        `issues[${index}].questionId 必须对应题目或全卷*`,
      );
      for (const key of ['code', 'comment', 'fix']) {
        check.text(issue[key], `issues[${index}].${key}`);
      }
    });
    check.require(
      (data.verdict === 'approve') === (data.issues.length === 0),
      'approve必须没有待修问题，revise必须列出可定位问题和修复方法',
    );
  }
  return check.finish(data as ChallengeReview);
}
