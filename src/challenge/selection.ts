import {CHALLENGE_RULES} from './rules';
import {prepareRetainedAnalysis} from './retention';
import {
  ChallengeLevel,
  ChallengePaper,
  ExamAnalysis,
  GeneratedQuestion,
  SourceQuestion,
} from './types';

export const CHALLENGE_SELECTION_POLICY_VERSION =
  CHALLENGE_RULES.selectionPolicy.id;

export function minimumUpgradePercent(level: ChallengeLevel) {
  return CHALLENGE_RULES.selectionPolicy.minimumPercent[
    String(level) as '1' | '2' | '3'
  ];
}
export function minimumUpgradeCount(total: number, level: ChallengeLevel) {
  return Math.ceil((total * minimumUpgradePercent(level)) / 100);
}
export function sourceRequiresRetention(question: SourceQuestion) {
  return (
    question.isListening ||
    question.upgradeEligibility === 'retain' ||
    !!question.analysisIssues?.length
  );
}
export function isRetainedQuestion(question: GeneratedQuestion) {
  return question?.isListening || question?.upgrade?.mode === 'retained';
}
export function requiredRetentionIds(analysis: ExamAnalysis) {
  analysis = prepareRetainedAnalysis(analysis);
  const retained = new Set(
    analysis.questions
      .filter(sourceRequiresRetention)
      .map(question => question.id),
  );
  for (const id of analysisRetentionIds(analysis)) {
    retained.add(id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of analysis.questions) {
      if (!retained.has(question.id)) {
        continue;
      }
      for (const id of question.dependsOnQuestionIds || []) {
        if (!retained.has(id)) {
          retained.add(id);
          changed = true;
        }
      }
    }
  }
  return retained;
}
export function analysisRetentionIds(analysis: ExamAnalysis) {
  const questions = prepareRetainedAnalysis(analysis).questions;
  const uncertain = new Set(
    questions
      .filter(question => question.analysisIssues?.length)
      .map(question => question.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of questions) {
      const dependencies = question.dependsOnQuestionIds || [];
      if (
        !uncertain.has(question.id) &&
        dependencies.some(id => uncertain.has(id))
      ) {
        uncertain.add(question.id);
        changed = true;
      }
    }
  }
  // Freeze needed earlier questions, but do not mistake a readable frozen
  // prerequisite for another parse failure and retain all its other users.
  const retained = new Set(uncertain);
  changed = true;
  while (changed) {
    changed = false;
    for (const question of questions) {
      if (!retained.has(question.id)) {
        continue;
      }
      for (const id of question.dependsOnQuestionIds || []) {
        if (!retained.has(id)) {
          retained.add(id);
          changed = true;
        }
      }
    }
  }
  return retained;
}
export function challengeCoverage(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  paper?: ChallengePaper,
) {
  const total = analysis.questions.filter(
    question => !question.isListening,
  ).length;
  const retainedIds = requiredRetentionIds(analysis);
  const uncertainIds = analysisRetentionIds(analysis);
  const analysisRetained = analysis.questions.filter(
    question => !question.isListening && uncertainIds.has(question.id),
  ).length;
  const targetRequired = minimumUpgradeCount(total, level);
  const eligible = analysis.questions.filter(
    question => !retainedIds.has(question.id),
  ).length;
  // Keep the original denominator and target visible. Parse failures must not
  // prevent the reliable remainder from being upgraded or force invented work.
  const required = analysisRetained
    ? Math.min(targetRequired, eligible)
    : targetRequired;
  const upgraded =
    paper?.questions.filter(
      question => question && !isRetainedQuestion(question),
    ).length || 0;
  return {
    total,
    required,
    targetRequired,
    analysisRetained,
    limitedByAnalysis: required < targetRequired,
    minimumPercent: minimumUpgradePercent(level),
    eligible,
    upgraded,
    retained: paper
      ? paper.questions.filter(question => question && !question.isListening)
          .length - upgraded
      : 0,
    percent: total ? (upgraded * 100) / total : 0,
  };
}

export function retainEntirePaper(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): ChallengePaper {
  return {
    title: `${analysis.title} · 挑战升${level}档（原题保留）`,
    subject: analysis.subject,
    level,
    masteryStatus: 'training_only',
    sections: analysis.sections,
    materials: analysis.materials,
    figures: analysis.figures,
    totalScore: analysis.totalScore,
    timeLimitMinutes: analysis.timeLimitMinutes,
    questions: analysis.questions.map(source => ({
      ...source,
      upgrade: {
        mode: 'retained',
        level,
        metrics: {},
        changes: [],
        pitfalls: [],
        retentionReason:
          source.retentionReason ||
          source.analysisIssues?.join('；') ||
          (source.isListening
            ? '听力保持不变，沿用原录音。'
            : '本档未形成可可靠发布的变式，本题原样保留。'),
        scopeExplanation: '原题及其原有位置、条件全部保留，不计入升档。',
      },
    })),
    answers: analysis.questions.map(source => ({
      questionId: source.id,
      status: source.isListening ? 'requires_audio' : 'requires_review',
      answer: '',
      explanation: source.isListening
        ? '原题保留，答案待核，需结合原录音核验。'
        : `原题保留，参考答案待核：${
            source.retentionReason ||
            source.analysisIssues?.join('；') ||
            '本次未独立核实原题解答'
          }。`,
      scoringPoints: [],
      learningGuide: [],
    })),
  };
}

/** Required originals belong to the app, not to the variant-writing model. */
function preserveInventory<T extends {id: string}>(
  items: T[],
  originals: T[],
  locked: Set<string>,
) {
  if (
    !Array.isArray(items) ||
    new Set(items.map(item => item?.id)).size !== items.length ||
    items.some(item => !originals.some(original => original.id === item?.id))
  ) {
    return items;
  }
  return originals.map(original =>
    locked.has(original.id)
      ? original
      : items.find(item => item.id === original.id),
  );
}

export function preserveRequiredOriginals(
  value: unknown,
  analysis: ExamAnalysis,
  level: ChallengeLevel,
): unknown {
  analysis = prepareRetainedAnalysis(analysis);
  if (!value || typeof value !== 'object') {
    return value;
  }
  const data = value as ChallengePaper;
  if (!Array.isArray(data.questions) || !Array.isArray(data.answers)) {
    return value;
  }
  const ids = data.questions.map(question => question?.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some(id => !analysis.questions.some(question => question.id === id))
  ) {
    return value;
  }
  const retained = requiredRetentionIds(analysis);
  const materials = new Set(
    analysis.questions
      .filter(question => retained.has(question.id))
      .flatMap(question => question.materialIds),
  );
  const imageQuestions = analysis.questions.filter(
    question => retained.has(question.id) && question.originalRegions?.length,
  );
  const imageFigures = new Set(
    imageQuestions
      .flatMap(question => [
        ...question.figureIds,
        ...analysis.materials
          .filter(material => question.materialIds.includes(material.id))
          .flatMap(material => material.figureIds),
      ])
      .filter(id =>
        analysis.questions
          .filter(
            question =>
              question.figureIds.includes(id) ||
              analysis.materials.some(
                material =>
                  question.materialIds.includes(material.id) &&
                  material.figureIds.includes(id),
              ),
          )
          .every(question =>
            imageQuestions.some(item => item.id === question.id),
          ),
      ),
  );
  const frozenFigures = new Set(
    analysis.questions
      .filter(question => retained.has(question.id))
      .flatMap(question => [
        ...question.figureIds,
        ...analysis.materials
          .filter(material => question.materialIds.includes(material.id))
          .flatMap(material => material.figureIds),
      ])
      .filter(
        id =>
          imageFigures.has(id) ||
          analysis.figures.find(figure => figure.id === id)
            ?.containsStudentMarks === false,
      ),
  );
  return {
    ...data,
    sections: preserveInventory(
      data.sections,
      analysis.sections,
      new Set(
        analysis.questions
          .filter(question => retained.has(question.id))
          .map(question => question.sectionId),
      ),
    ),
    materials: preserveInventory(data.materials, analysis.materials, materials),
    figures: preserveInventory(data.figures, analysis.figures, frozenFigures),
    questions: analysis.questions.map(source => {
      const generated = data.questions.find(
        question => question.id === source.id,
      );
      if (!retained.has(source.id)) {
        return generated;
      }
      const {
        id,
        number,
        sectionId,
        type,
        stem,
        options,
        materialIds,
        figureIds,
        knowledgePoints,
        score,
        isListening,
        answerLines,
      } = source;
      return {
        id,
        number,
        sectionId,
        type,
        stem,
        options,
        materialIds,
        figureIds,
        knowledgePoints,
        score,
        isListening,
        answerLines,
        upgrade: {
          mode: 'retained',
          level,
          metrics: {},
          changes: [],
          pitfalls: [],
          retentionReason:
            source.retentionReason ||
            source.analysisIssues?.join('；') ||
            (source.isListening
              ? '听力保持不变，沿用原录音。'
              : '与解析待核题存在依赖，保持原题。'),
          scopeExplanation: '保持原题及其原有位置、材料和条件，不计入升档。',
        },
      };
    }),
    answers: [
      ...data.answers.filter(answer => !retained.has(answer?.questionId)),
      ...analysis.questions
        .filter(source => retained.has(source.id))
        .map(source => {
          const answer = data.answers.find(
            item => item?.questionId === source.id,
          );
          if (
            !source.analysisIssues?.length &&
            !source.originalRegions?.length &&
            answer &&
            typeof answer.explanation === 'string' &&
            answer.explanation.trim() &&
            (answer.status !== 'verified' ||
              (typeof answer.answer === 'string' &&
                answer.answer.trim() &&
                answer.scoringPoints?.length))
          ) {
            return answer;
          }
          return {
            questionId: source.id,
            status: source.isListening ? 'requires_audio' : 'requires_review',
            answer: '',
            explanation: `原题保留，参考答案待核：${
              source.retentionReason ||
              source.analysisIssues?.join('；') ||
              '原题解答尚未可靠核实'
            }${source.isListening ? '，需结合原录音核验' : ''}。`,
            scoringPoints: [],
            learningGuide: [],
          };
        }),
    ],
  };
}
