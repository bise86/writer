import {CHALLENGE_POLICY_VERSION} from './rules';
import {prepareRetainedAnalysis} from './retention';
import {
  isRetainedQuestion,
  preserveRequiredOriginals,
  requiredRetentionIds,
  retainEntirePaper,
} from './selection';
import {
  ChallengeGenerationProgress,
  ChallengeLevel,
  ChallengePaper,
  ExamAnalysis,
} from './types';
import {ChallengeValidationError, sameJson} from './validation';

export function generationSignature(analysis: ExamAnalysis): string {
  return JSON.stringify({
    subject: analysis.subject,
    title: analysis.title,
    educationLevel: analysis.educationLevel,
    sections: analysis.sections,
    materials: analysis.materials,
    figures: analysis.figures,
    totalScore: analysis.totalScore,
    timeLimitMinutes: analysis.timeLimitMinutes,
    questions: analysis.questions.map(question => ({
      ...question,
      originalRegions: undefined,
      analysisIssues: undefined,
      retentionReason: undefined,
      upgradeEligibility: undefined,
    })),
    requiredRetentionIds: [...requiredRetentionIds(analysis)].sort(),
  });
}

/** Only marked source figures need a bitmap fallback for otherwise readable originals. */
export function generationAnalysis(input: ExamAnalysis): ExamAnalysis {
  const analysis = prepareRetainedAnalysis(input);
  return {
    ...analysis,
    questions: analysis.questions.map(question => {
      const figures = analysis.figures.filter(
        figure =>
          question.figureIds.includes(figure.id) ||
          analysis.materials.some(
            material =>
              question.materialIds.includes(material.id) &&
              material.figureIds.includes(figure.id),
          ),
      );
      if (
        question.originalRegions?.length ||
        !figures.some(figure => figure.containsStudentMarks)
      ) {
        return question;
      }
      return {
        ...question,
        originalRegions: [
          ...new Set([
            ...question.sourceRefs.map(ref => ref.pageIndex),
            ...figures.map(figure => figure.pageIndex),
          ]),
        ]
          .sort((a, b) => a - b)
          .map(pageIndex => ({
            pageIndex,
            box: {x: 0, y: 0, width: 1, height: 1},
          })),
      };
    }),
  };
}

export function generationSeed(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): ChallengePaper {
  return {
    ...retainEntirePaper(analysis, level),
    title: `${analysis.title} · 挑战升${level}档`,
  };
}

export function generationCheckpoint(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  completed: readonly string[],
  paper: ChallengePaper,
): ChallengeGenerationProgress {
  return {
    version: 'question-patches-v1',
    policyVersion: CHALLENGE_POLICY_VERSION,
    sourceSignature: generationSignature(analysis),
    level,
    completedQuestionIds: [...completed],
    paper,
  };
}

export function canResumeGeneration(
  checkpoint: ChallengeGenerationProgress | undefined,
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): checkpoint is ChallengeGenerationProgress {
  const forced = requiredRetentionIds(analysis);
  const eligible = new Set(
    analysis.questions
      .filter(question => !forced.has(question.id))
      .map(question => question.id),
  );
  return (
    !!checkpoint &&
    checkpoint.version === 'question-patches-v1' &&
    checkpoint.policyVersion === CHALLENGE_POLICY_VERSION &&
    checkpoint.level === level &&
    checkpoint.sourceSignature === generationSignature(analysis) &&
    Array.isArray(checkpoint.completedQuestionIds) &&
    new Set(checkpoint.completedQuestionIds).size ===
      checkpoint.completedQuestionIds.length &&
    checkpoint.completedQuestionIds.every(id => eligible.has(id))
  );
}

export function questionContextIds(
  analysis: ExamAnalysis,
  ids: readonly string[],
): Set<string> {
  const selected = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of analysis.questions) {
      if (!selected.has(question.id)) {
        continue;
      }
      for (const dependency of question.dependsOnQuestionIds || []) {
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }
  return selected;
}

export function batchAnalysis(
  analysis: ExamAnalysis,
  ids: readonly string[],
): ExamAnalysis {
  const contexts = questionContextIds(analysis, ids);
  const questions = analysis.questions.filter(question =>
    contexts.has(question.id),
  );
  const sections = new Set(questions.map(question => question.sectionId));
  const materials = new Set(
    questions.flatMap(question => question.materialIds),
  );
  const figures = new Set([
    ...questions.flatMap(question => question.figureIds),
    ...analysis.materials
      .filter(material => materials.has(material.id))
      .flatMap(material => material.figureIds),
  ]);
  return {
    ...analysis,
    questions: questions.filter(question => ids.includes(question.id)),
    sections: analysis.sections.filter(section => sections.has(section.id)),
    materials: analysis.materials.filter(material =>
      materials.has(material.id),
    ),
    figures: analysis.figures.filter(figure => figures.has(figure.id)),
    knowledgePoints: [
      ...new Set(
        questions
          .filter(question => ids.includes(question.id))
          .flatMap(question => question.knowledgePoints),
      ),
    ],
    majorQuestions: analysis.majorQuestions?.filter(major =>
      questions.some(question => question.majorQuestionId === major.id),
    ),
    unresolvedIssues: questions.flatMap(
      question => question.analysisIssues || [],
    ),
    warnings: [],
  };
}

function invalid(message: string): never {
  throw new ChallengeValidationError([message]);
}
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Apply only changed entities. Omitted question IDs remain at their original positions. */
export function mergeGenerationPatch(
  value: unknown,
  analysis: ExamAnalysis,
  current: ChallengePaper,
  ids: readonly string[],
  completedQuestionIds: readonly string[],
): ChallengePaper {
  if (
    !record(value) ||
    !Array.isArray(value.questions) ||
    !Array.isArray(value.answers)
  ) {
    return invalid(
      '本批必须返回{questions:[],answers:[]}，只包含实际升档题；没有升档题用空数组',
    );
  }
  for (const key of [
    'subject',
    'level',
    'totalScore',
    'timeLimitMinutes',
    'masteryStatus',
  ] as const) {
    if (value[key] !== undefined && !sameJson(value[key], current[key])) {
      invalid(
        `${key} 必须保持原卷和所选档次，不能通过分批输出改科、改分或宣称已掌握`,
      );
    }
  }
  if (
    value.sections !== undefined &&
    !sameJson(value.sections, analysis.sections)
  ) {
    invalid('sections 必须保持原题组，本批不返回或更改题组');
  }
  const questionIds = new Set<string>();
  const retainedReasons = record(value.retainedReasons)
    ? value.retainedReasons
    : {};
  const variants = value.questions.filter((question: unknown) => {
    if (
      !record(question) ||
      typeof question.id !== 'string' ||
      !analysis.questions.some(source => source.id === question.id)
    ) {
      return invalid('本批questions.id必须是原卷题ID，不能增加或替换题目');
    }
    if (question.upgrade?.mode === 'retained') {
      // Read older full-paper replies, but never copy their unchanged bodies.
      if (
        ids.includes(question.id) &&
        typeof question.upgrade.retentionReason === 'string'
      ) {
        retainedReasons[question.id] = question.upgrade.retentionReason;
      }
      return false;
    }
    if (!ids.includes(question.id) || questionIds.has(question.id)) {
      return invalid(
        '本批只能返回指定题ID的一份升档题，不能输出其它批次或重复题',
      );
    }
    questionIds.add(question.id);
    return true;
  });
  const answerIds = new Set<string>();
  const answers = value.answers.filter((answer: unknown) => {
    if (!record(answer) || typeof answer.questionId !== 'string') {
      return invalid('本批answers必须按questionId关联升档题');
    }
    if (!questionIds.has(answer.questionId)) {
      if (
        value.questions.some(
          (question: any) =>
            question?.id === answer.questionId &&
            question?.upgrade?.mode === 'retained',
        )
      ) {
        return false;
      }
      return invalid(
        '本批answers只能返回本批实际升档题的答案，不返回保留题答案',
      );
    }
    if (answerIds.has(answer.questionId)) {
      return invalid('本批每道升档题必须恰有一份答案');
    }
    answerIds.add(answer.questionId);
    return true;
  });
  if (answerIds.size !== questionIds.size) {
    invalid('本批每道升档题必须恰有一份答案，不能漏掉详解');
  }
  const updateAssets = <T extends {id: string}>(
    key: 'materials' | 'figures',
    originals: T[],
    existing: T[],
  ): T[] => {
    if (value[key] === undefined) {
      return existing;
    }
    if (!Array.isArray(value[key])) {
      return invalid(`${key} 必须只列实际变更对象，未改动时省略或空数组`);
    }
    const seen = new Set<string>();
    const result = [...existing];
    for (const item of value[key]) {
      if (!record(item) || typeof item.id !== 'string' || seen.has(item.id)) {
        invalid(`${key}.id无效或重复`);
      }
      seen.add(item.id);
      const index = originals.findIndex(original => original.id === item.id);
      if (index < 0) {
        invalid(`${key}不得新增无来源的材料或图形`);
      }
      if (sameJson(item, result[index])) {
        continue;
      }
      const usesAsset = (question: ExamAnalysis['questions'][number]) =>
        key === 'materials'
          ? question.materialIds.includes(item.id)
          : question.figureIds.includes(item.id) ||
            analysis.materials.some(
              material =>
                question.materialIds.includes(material.id) &&
                material.figureIds.includes(item.id),
            );
      const users = analysis.questions.filter(question => {
        const contexts = questionContextIds(analysis, [question.id]);
        return analysis.questions.some(
          source => contexts.has(source.id) && usesAsset(source),
        );
      });
      if (
        !users.some(
          question => ids.includes(question.id) && questionIds.has(question.id),
        )
      ) {
        invalid(`${key}.${item.id}不属于本批实际升档题，不能返回无关变更`);
      }
      const redraw =
        key === 'figures' &&
        (originals[index] as any).containsStudentMarks === true &&
        item.kind === 'drawing' &&
        item.caption === (originals[index] as any).caption;
      if (
        !users.length ||
        users.some(
          question =>
            !ids.includes(question.id) || !questionIds.has(question.id),
        )
      ) {
        if (!redraw) {
          invalid(
            `${key}.${item.id}还供其它批次或保留题使用，必须保持原条件；仅可等内容清除图上学生标记`,
          );
        }
      }
      result[index] = item as T;
    }
    return result;
  };
  const original = generationSeed(analysis, current.level);
  let paper: ChallengePaper = {
    ...current,
    title:
      typeof value.title === 'string' && value.title.trim()
        ? value.title
        : current.title,
    materials: updateAssets('materials', analysis.materials, current.materials),
    figures: updateAssets('figures', analysis.figures, current.figures),
    questions: current.questions.map(question => {
      if (!ids.includes(question.id)) {
        return question;
      }
      const changed = variants.find(
        (variant: any) => variant.id === question.id,
      );
      if (changed) {
        return changed;
      }
      const source = original.questions.find(item => item.id === question.id)!;
      const reason = retainedReasons[question.id];
      return {
        ...source,
        upgrade: {
          ...source.upgrade,
          retentionReason:
            typeof reason === 'string' && reason.trim()
              ? reason
              : source.upgrade.retentionReason,
        },
      };
    }),
    answers: current.answers.map(answer => {
      if (!ids.includes(answer.questionId)) {
        return answer;
      }
      return (
        answers.find(
          (changed: any) => changed.questionId === answer.questionId,
        ) ||
        original.answers.find(item => item.questionId === answer.questionId)!
      );
    }),
  };
  // Only completed, actually retained questions freeze their earlier dependencies.
  // Unattempted placeholders must not roll back a valid earlier batch.
  const completed = new Set([...completedQuestionIds, ...ids]);
  const dynamic: ExamAnalysis = {
    ...analysis,
    questions: analysis.questions.map(question =>
      completed.has(question.id) &&
      isRetainedQuestion(paper.questions.find(item => item.id === question.id)!)
        ? {
            ...question,
            upgradeEligibility: 'retain',
            retentionReason: paper.questions.find(
              item => item.id === question.id,
            )!.upgrade.retentionReason,
          }
        : question,
    ),
  };
  paper = preserveRequiredOriginals(
    paper,
    dynamic,
    current.level,
  ) as ChallengePaper;
  return paper;
}
