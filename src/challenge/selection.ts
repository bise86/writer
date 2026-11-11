import {CHALLENGE_RULES} from './rules';
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
  const retained = new Set(
    analysis.questions
      .filter(sourceRequiresRetention)
      .map(question => question.id),
  );
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
export function challengeCoverage(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  paper?: ChallengePaper,
) {
  const total = analysis.questions.filter(
    question => !question.isListening,
  ).length;
  const retainedIds = requiredRetentionIds(analysis);
  const upgraded =
    paper?.questions.filter(
      question => question && !isRetainedQuestion(question),
    ).length || 0;
  return {
    total,
    required: minimumUpgradeCount(total, level),
    minimumPercent: minimumUpgradePercent(level),
    eligible: analysis.questions.filter(
      question => !retainedIds.has(question.id),
    ).length,
    upgraded,
    retained: paper
      ? paper.questions.filter(question => question && !question.isListening)
          .length - upgraded
      : 0,
    percent: total ? (upgraded * 100) / total : 0,
  };
}
