import {
  ChallengePage,
  ExamAnalysis,
  ExamDraft,
  OriginalQuestionRegion,
  SourceQuestion,
} from './types';

const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
const textList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numberKey = (value: string) =>
  value.normalize('NFKC').replace(/\s/gu, '');

export function validOriginalRegion(region: OriginalQuestionRegion): boolean {
  const box = region?.box;
  return (
    Number.isInteger(region?.pageIndex) &&
    region.pageIndex >= 0 &&
    region.pageIndex < 50 &&
    !!box &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1 + 1e-9 &&
    box.y + box.height <= 1 + 1e-9
  );
}

function matchesQuestion(issue: string, question: SourceQuestion) {
  if (!text(question.id) || !text(question.number)) {
    return false;
  }
  const normalized = numberKey(issue);
  const number = escape(numberKey(String(question.number)));
  return (
    new RegExp(
      `第${number}(?:题|小题|问)(?!\\d)|(?:题|小题)${number}(?![\\d(])`,
      'u',
    ).test(normalized) ||
    new RegExp(`(?:^|[^\\w])${escape(question.id)}(?:$|[^\\w])`, 'u').test(
      issue,
    )
  );
}

/** Keep parse failures local. Never invent missing conditions, options or facts. */
export function prepareRetainedAnalysis<T extends ExamAnalysis | ExamDraft>(
  input: T,
  pages: ChallengePage[] = [],
): T {
  if (
    !Array.isArray(input.questions) ||
    input.questions.some(question => !question || typeof question !== 'object')
  ) {
    return input;
  }
  const questions = input.questions.map(question => ({
    ...question,
    analysisIssues: textList(question.analysisIssues)
      ? [...question.analysisIssues]
      : [],
  }));
  const imageIds = new Set<string>();
  const addIssue = (
    question: SourceQuestion,
    issue: string,
    image: boolean,
  ) => {
    if (!question.analysisIssues!.includes(issue)) {
      question.analysisIssues!.push(issue);
    }
    if (image) {
      imageIds.add(question.id);
    }
  };
  const pageIndices = (question: SourceQuestion) => [
    ...(Array.isArray(question.sourceRefs)
      ? question.sourceRefs.map(ref => ref?.pageIndex)
      : []),
    ...(Array.isArray(question.originalRegions)
      ? question.originalRegions.map(region => region?.pageIndex)
      : []),
    ...pages
      .filter(page =>
        page.questionRegions?.some(
          region =>
            numberKey(region.number) === numberKey(String(question.number)),
        ),
      )
      .map(page => page.pageIndex),
  ];
  const locateIssue = (issue: string, pageIndex?: number) => {
    let targets = questions.filter(question =>
      matchesQuestion(issue, question),
    );
    if (!targets.length) {
      const pageNumbers = [...issue.matchAll(/第\s*(\d+)\s*页/gu)].map(
        match => Number(match[1]) - 1,
      );
      if (pageIndex !== undefined) {
        pageNumbers.push(pageIndex);
      }
      targets = questions.filter(question =>
        pageIndices(question).some(index => pageNumbers.includes(index)),
      );
      const localized = targets.filter(question =>
        question.analysisIssues.some(detail =>
          /题干|选项|图表|材料|识别|遮挡|缺失|不完整|不清|不全|解析失败|无法解析/u.test(
            detail,
          ),
        ),
      );
      if (localized.length) {
        targets = localized;
      }
    }
    if (!targets.length) {
      targets = questions.filter(question => question.analysisIssues.length);
    }
    // Old records may have only a whole-paper warning. Preserve the originals
    // rather than dropping the warning or guessing which question is affected.
    if (!targets.length) {
      targets = questions;
    }
    targets.forEach(question => addIssue(question, issue, true));
  };
  if (textList(input.unresolvedIssues)) {
    input.unresolvedIssues.forEach(issue => locateIssue(issue));
  }
  for (const page of pages) {
    for (const issue of page.unreadableParts || []) {
      locateIssue(issue, page.pageIndex);
    }
  }
  for (const question of questions) {
    const issues: string[] = [];
    if (
      question.upgradeEligibility === 'retain' &&
      text(question.retentionReason) &&
      /解析|识别|待核|辨认|遮挡|缺失|不完整|不清|不全/u.test(
        question.retentionReason,
      )
    ) {
      addIssue(
        question,
        question.retentionReason,
        /题干|选项|图表|材料/u.test(question.retentionReason),
      );
    }
    if (!text(question.stem)) {
      issues.push('题干未完整识别');
    }
    if (
      !Array.isArray(question.options) ||
      question.options.some(
        option => !text(option?.label) || !text(option?.text),
      ) ||
      (/选择|choice/iu.test(question.type) && !question.options.length)
    ) {
      issues.push('选项未完整识别');
    }
    if (
      !textList(question.knowledgePoints) ||
      !question.knowledgePoints.length
    ) {
      issues.push('知识点分析待核');
    }
    const difficulty = question.difficulty;
    if (
      !difficulty ||
      !Number.isInteger(difficulty.rating) ||
      difficulty.rating! < 1 ||
      difficulty.rating! > 10 ||
      !Number.isInteger(difficulty.reasoningSteps) ||
      difficulty.reasoningSteps! < 0 ||
      difficulty.reasoningSteps! > 50 ||
      !text(difficulty.explanation)
    ) {
      issues.push('难度分析待核');
    }
    issues.forEach(issue =>
      addIssue(question, issue, /题干|选项/u.test(issue)),
    );
    if (
      question.analysisIssues.some(issue =>
        /辨认|识别|遮挡|缺失|不完整|不清|不全|解析失败|无法解析|漏题/iu.test(
          issue,
        ),
      )
    ) {
      imageIds.add(question.id);
    }
    if (
      !question.analysisIssues.length &&
      question.upgradeEligibility !== 'retain'
    ) {
      continue;
    }
    question.upgradeEligibility = 'retain';
    question.retentionReason =
      question.retentionReason ||
      question.analysisIssues.join('；') ||
      '原题保留';
    if (imageIds.has(question.id) && !question.originalRegions?.length) {
      const parentPages = question.materialIds?.length
        ? input.majorQuestions
            ?.find(major => major.id === question.majorQuestionId)
            ?.sourceRefs.map(ref => ref.pageIndex) || []
        : [];
      const sourcePages = [
        ...new Set([...pageIndices(question), ...parentPages]),
      ]
        .filter(index => Number.isInteger(index) && index >= 0 && index < 50)
        .sort((first, second) => first - second);
      question.originalRegions = sourcePages.flatMap(pageIndex => {
        const regions = pages
          .find(page => page.pageIndex === pageIndex)
          ?.questionRegions?.filter(
            region => numberKey(region.number) === numberKey(question.number),
          );
        return regions?.length
          ? regions.map(region => ({pageIndex, box: {...region.box}}))
          : [{pageIndex, box: {x: 0, y: 0, width: 1, height: 1}}];
      });
    }
    if (!text(question.stem) && question.originalRegions?.length) {
      question.stem = '';
    }
    if (!Array.isArray(question.options)) {
      question.options = [];
    } else {
      question.options = question.options.filter(
        option => text(option?.label) && text(option?.text),
      );
    }
    if (!textList(question.knowledgePoints)) {
      question.knowledgePoints = [];
    }
    if (issues.includes('难度分析待核')) {
      question.difficulty = {
        rating: null,
        reasoningSteps: null,
        explanation: '本题解析待核，保持原题，不估造难度或推理步骤。',
      };
    }
  }
  const unresolvedIssues = textList(input.unresolvedIssues)
    ? [
        ...new Set([
          ...input.unresolvedIssues,
          ...pages.flatMap(page =>
            page.unreadableParts.map(
              issue => `第${page.pageIndex + 1}页：${issue}`,
            ),
          ),
        ]),
      ]
    : input.unresolvedIssues;
  return {...input, questions, unresolvedIssues};
}
