import {
  sameJson,
  validateExamDraft,
  validateExamAnalysis,
  ChallengeValidationError,
} from './validation';
import type {
  ChallengePage,
  ExamDraft,
  ExamAnalysis,
  SourceQuestion,
  SubjectIdentification,
} from './types';

const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (reason: string): never => {
  throw new ChallengeValidationError([reason]);
};

export function emptyExamDraft(pages: ChallengePage[]): ExamDraft {
  return {
    isExam: true,
    title: '原卷草稿',
    subject: 'unknown',
    subjectLabel: '待确认',
    educationLevel: 'unknown',
    knowledgePoints: [],
    difficultySummary: '原卷结构分批解析中',
    difficultyBasis: 'estimated',
    answerState: pages.every(page => !page.hasStudentAnswers)
      ? 'blank'
      : pages.every(page => page.hasStudentAnswers)
      ? 'answered'
      : 'mixed',
    sections: [],
    materials: [],
    figures: pages.flatMap(page => page.figures),
    questions: [],
    totalScore: null,
    timeLimitMinutes: null,
    warnings: [],
    unresolvedIssues: [],
    titleEvidence: [],
    majorQuestions: [],
  };
}
const uniqueTexts = (values: unknown[], field: string): string[] => {
  if (values.some(value => typeof value !== 'string')) {
    return invalid(`${field}必须是字符串数组`);
  }
  return [...new Set(values as string[])];
};
const texts = (value: unknown, field: string): string[] =>
  value === undefined
    ? []
    : Array.isArray(value)
    ? uniqueTexts(value, field)
    : invalid(`${field}必须是字符串数组`);
const numberKey = (value: string) =>
  value.normalize('NFKC').replace(/\s/gu, '');

/** OCR regions missed by structural extraction remain original images, never disappear. */
export function retainUnparsedRegions(
  base: ExamDraft,
  pages: ChallengePage[],
): ExamDraft {
  const questions = [...base.questions];
  const sections = [...base.sections];
  for (const page of pages) {
    for (const [index, region] of (page.questionRegions || []).entries()) {
      const number = numberKey(region.number);
      const covered = questions.some(question => {
        const key = numberKey(question.number);
        return (
          (key === number || key.startsWith(`${number}(`)) &&
          [
            ...question.sourceRefs,
            ...(question.originalRegions || []),
            ...(base.majorQuestions?.find(
              major => major.id === question.majorQuestionId,
            )?.sourceRefs || []),
          ].some(ref => ref.pageIndex === page.pageIndex)
        );
      });
      if (covered) {
        continue;
      }
      const existing = questions.find(
        question => numberKey(question.number) === number,
      );
      const issue = `第${page.pageIndex + 1}页第${
        region.number
      }题结构未完整解析，保留原图`;
      const originalRegion = {pageIndex: page.pageIndex, box: region.box};
      if (existing) {
        const position = questions.indexOf(existing);
        questions[position] = {
          ...existing,
          originalRegions: [
            ...(existing.originalRegions || []),
            originalRegion,
          ],
          upgradeEligibility: 'retain',
          retentionReason: issue,
          analysisIssues: [...(existing.analysisIssues || []), issue],
        };
      } else {
        if (!sections.length) {
          sections.push({
            id: 'original-retained',
            title: '原卷题目',
            instructions: '',
          });
        }
        let id = `original-p${page.pageIndex}-${index}`;
        while (questions.some(question => question.id === id)) {
          id += '-retained';
        }
        const placeholder: SourceQuestion = {
          id,
          number: region.number,
          sectionId: sections[sections.length - 1].id,
          type: '原卷题目',
          stem: '',
          options: [],
          materialIds: [],
          figureIds: [],
          knowledgePoints: [],
          score: null,
          isListening: false,
          answerLines: 0,
          sourceRefs: [],
          originalRegions: [originalRegion],
          difficulty: {rating: null, reasoningSteps: null, explanation: issue},
          analysisIssues: [issue],
          upgradeEligibility: 'retain',
          retentionReason: issue,
        };
        // OCR regions follow printed order; insert before the next located original.
        const nextNumbers = (page.questionRegions || [])
          .slice(index + 1)
          .map(item => numberKey(item.number));
        const next = questions.findIndex(question =>
          nextNumbers.includes(numberKey(question.number)),
        );
        if (next < 0) {
          questions.push(placeholder);
        } else {
          questions.splice(next, 0, placeholder);
        }
      }
    }
  }
  return {...base, questions, sections};
}

/** Merge only new original questions. Earlier validated bodies are immutable. */
export function mergeExamDraftBatch(
  base: ExamDraft,
  value: unknown,
  pages: ChallengePage[],
  pageIndex: number,
  limit: number,
): {draft: ExamDraft; pageComplete: boolean} {
  if (
    !object(value) ||
    !Array.isArray(value.questions) ||
    value.questions.length > limit ||
    typeof value.pageComplete !== 'boolean'
  ) {
    return invalid(
      `分批原卷解析必须返回questions（至多${limit}道新小题）和布尔pageComplete，不返回完整整卷`,
    );
  }
  const aliases = new Map<string, string>();
  const inventory = <T extends {id: string}>(
    key: 'sections' | 'materials' | 'majorQuestions',
    previous: T[],
  ): T[] => {
    if (value[key] === undefined) {
      return previous;
    }
    if (!Array.isArray(value[key])) {
      return invalid(`${key}必须只返回新增的关联条目`);
    }
    const merged = [...previous];
    for (const entry of value[key]) {
      if (!object(entry) || typeof entry.id !== 'string') {
        return invalid(`${key}.id无效`);
      }
      const sameId = merged.find(item => item.id === entry.id);
      if (sameId) {
        if (!sameJson(sameId, entry)) {
          return invalid(
            `${key}.${entry.id}已经保存，不得在后批暗改；新对象须使用新ID`,
          );
        }
        continue;
      }
      const withoutId = (item: object) =>
        Object.fromEntries(
          Object.entries(item).filter(([name]) => name !== 'id'),
        );
      const equivalent = merged.find(item =>
        sameJson(withoutId(item), withoutId(entry)),
      );
      if (equivalent) {
        aliases.set(`${key}:${entry.id}`, equivalent.id);
      } else {
        merged.push(entry as T);
      }
    }
    return merged;
  };
  const sections = inventory('sections', base.sections);
  const materials = inventory('materials', base.materials);
  const majorQuestions = inventory('majorQuestions', base.majorQuestions || []);
  const figures = pages.flatMap(page => page.figures);
  if (
    value.figures !== undefined &&
    (!Array.isArray(value.figures) ||
      value.figures.some(
        (figure: unknown) => !figures.some(source => sameJson(source, figure)),
      ))
  ) {
    return invalid('图形只能采用逐页识别的真实原图，不能重写图形条件');
  }
  const additions: SourceQuestion[] = [];
  for (const raw of value.questions) {
    if (
      !object(raw) ||
      typeof raw.id !== 'string' ||
      !Array.isArray(raw.sourceRefs)
    ) {
      return invalid('每个新小题必须有原ID与原页引文');
    }
    const question = {
      ...raw,
      sectionId: aliases.get(`sections:${raw.sectionId}`) || raw.sectionId,
      majorQuestionId:
        aliases.get(`majorQuestions:${raw.majorQuestionId}`) ||
        raw.majorQuestionId,
      materialIds: Array.isArray(raw.materialIds)
        ? raw.materialIds.map(
            (id: string) => aliases.get(`materials:${id}`) || id,
          )
        : raw.materialIds,
    } as SourceQuestion;
    const previous = base.questions.find(
      item => item.id === question.id || item.number === question.number,
    );
    if (previous) {
      if (!sameJson(previous, question)) {
        return invalid(`第${previous.number}题已保存，本批不能重写或重复编号`);
      }
      continue;
    }
    if (
      ![...question.sourceRefs, ...(question.originalRegions || [])].some(
        ref => ref?.pageIndex === pageIndex,
      )
    ) {
      return invalid(
        `新小题必须确实出现在本批第${pageIndex + 1}页，其他页只作上下文`,
      );
    }
    additions.push(question);
  }
  if (!additions.length && !value.pageComplete) {
    return invalid('本批没有新增题目，不能声明还要继续以循环请求');
  }
  const questions = [...base.questions, ...additions];
  const location = (question: SourceQuestion) =>
    Math.min(
      ...[...question.sourceRefs, ...(question.originalRegions || [])].map(
        ref => ref.pageIndex,
      ),
    );
  const offset = (question: SourceQuestion) =>
    Math.min(
      ...question.sourceRefs
        .filter(ref => ref.pageIndex === location(question))
        .map(
          ref =>
            pages
              .find(page => page.pageIndex === ref.pageIndex)
              ?.text.indexOf(ref.quote) ?? 0,
        ),
      Infinity,
    );
  questions.sort((a, b) => {
    const pageOrder = location(a) - location(b);
    if (pageOrder) {
      return pageOrder;
    }
    const regions =
      pages.find(page => page.pageIndex === location(a))?.questionRegions || [];
    const position = (question: SourceQuestion) =>
      regions.findIndex(region => {
        const number = numberKey(question.number),
          key = numberKey(region.number);
        return number === key || number.startsWith(`${key}(`);
      });
    const first = position(a),
      second = position(b);
    if (first >= 0 && second >= 0 && first !== second) {
      return first - second;
    }
    return Number.isFinite(offset(a)) && Number.isFinite(offset(b))
      ? offset(a) - offset(b)
      : 0;
  });
  const draft = validateExamDraft(
    {
      ...base,
      sections,
      materials,
      majorQuestions,
      figures,
      questions,
      totalScore: null,
      knowledgePoints: [
        ...new Set(
          questions.flatMap(question => question.knowledgePoints || []),
        ),
      ],
      warnings: uniqueTexts(
        [...base.warnings, ...texts(value.warnings, 'warnings')],
        'warnings',
      ),
      unresolvedIssues: uniqueTexts(
        [
          ...base.unresolvedIssues,
          ...texts(value.unresolvedIssues, 'unresolvedIssues'),
        ],
        'unresolvedIssues',
      ),
    },
    pages,
    {partial: true},
  );
  return {draft, pageComplete: value.pageComplete};
}

/** Metadata-only finalization prevents a second full copy of all question bodies. */
export function finalizeExamDraft(
  base: ExamDraft,
  summary: unknown,
  pages: ChallengePage[],
  identification?: SubjectIdentification,
): ExamDraft | ExamAnalysis {
  if (
    !object(summary) ||
    Object.keys(summary).some(
      key =>
        ![
          'isExam',
          'title',
          'subject',
          'subjectLabel',
          'educationLevel',
          'difficultySummary',
          'answerState',
          'totalScore',
          'timeLimitMinutes',
          'warnings',
          'unresolvedIssues',
          'titleEvidence',
        ].includes(key),
    )
  ) {
    return invalid(
      '整卷汇总仅返回标题、学段、难度摘要等元数据，不重复返回questions、材料或图',
    );
  }
  base = retainUnparsedRegions(base, pages);
  const draft = {
    ...base,
    ...summary,
    knowledgePoints: [
      ...new Set(base.questions.flatMap(question => question.knowledgePoints)),
    ],
    unresolvedIssues: uniqueTexts(
      [
        ...base.unresolvedIssues,
        ...texts(summary.unresolvedIssues, 'unresolvedIssues'),
        ...pages.flatMap(page =>
          page.unreadableParts.map(
            issue => `第${page.pageIndex + 1}页：${issue}`,
          ),
        ),
      ],
      'unresolvedIssues',
    ),
    warnings: uniqueTexts(
      [...base.warnings, ...texts(summary.warnings, 'warnings')],
      'warnings',
    ),
  };
  // Unresolved dependency labels cannot be treated as known source conditions.
  const blocked = new Set<string>();
  const questions = draft.questions
    .map((question, index) => {
      const missing = question.dependsOnQuestionIds?.filter(
        id => !draft.questions.some(item => item.id === id),
      );
      if (!missing?.length) {
        return question;
      }
      draft.questions.slice(0, index + 1).forEach(item => blocked.add(item.id));
      return {
        ...question,
        dependsOnQuestionIds: question.dependsOnQuestionIds!.filter(
          id => !missing.includes(id),
        ),
        analysisIssues: [
          ...(question.analysisIssues || []),
          `必要前问${missing.join('、')}无法可靠定位，按原位置保留`,
        ],
      };
    })
    .map(question =>
      blocked.has(question.id)
        ? {
            ...question,
            upgradeEligibility: 'retain' as const,
            analysisIssues: [
              ...(question.analysisIssues || []),
              '与未核实前问可能有关，保持原题',
            ],
            retentionReason: '必要前问关系尚未核实，保留原题而不猜补条件',
          }
        : question,
    );
  return identification
    ? validateExamAnalysis({...draft, questions}, pages, identification)
    : validateExamDraft({...draft, questions}, pages);
}

export function mergeConfirmedQuestionBatch(
  base: ExamDraft,
  value: unknown,
  pages: ChallengePage[],
  ids: string[],
): ExamDraft {
  if (
    !object(value) ||
    !Array.isArray(value.questions) ||
    value.questions.length !== ids.length ||
    Object.keys(value).some(key => !['questions', 'warnings'].includes(key))
  ) {
    return invalid(
      '科目核验后只返回本批questionIds的知识、难度等字段，不返回完整试卷',
    );
  }
  const allowed = [
    'id',
    'knowledgePoints',
    'difficulty',
    'analysisIssues',
    'upgradeEligibility',
    'retentionReason',
    'score',
    'type',
    'isListening',
    'answerLines',
    'dependsOnQuestionIds',
  ];
  const seen = new Set<string>();
  for (const patch of value.questions) {
    if (
      !object(patch) ||
      !ids.includes(patch.id) ||
      seen.has(patch.id) ||
      Object.keys(patch).some(key => !allowed.includes(key)) ||
      !Array.isArray(patch.knowledgePoints) ||
      !object(patch.difficulty)
    ) {
      return invalid(
        '本批只能修正指定原题的知识与分析字段，不能增删题目或返回题干',
      );
    }
    seen.add(patch.id);
  }
  const questions = base.questions.map(source => {
    const patch = value.questions.find((item: any) => item.id === source.id);
    return patch
      ? {
          ...source,
          ...patch,
          analysisIssues: [
            ...new Set([
              ...(source.analysisIssues || []),
              ...(patch.analysisIssues || []),
            ]),
          ],
        }
      : source;
  });
  return validateExamDraft(
    {
      ...base,
      questions,
      totalScore: null,
      knowledgePoints: [
        ...new Set(questions.flatMap(question => question.knowledgePoints)),
      ],
      warnings: uniqueTexts(
        [...base.warnings, ...texts(value.warnings, 'warnings')],
        'warnings',
      ),
    },
    pages,
    {partial: true},
  );
}
