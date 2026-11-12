import {
  ChallengeRecord,
  ChallengeReviewRole,
  ChallengeReviewRound,
  ChallengeRoundtableSize,
  CHALLENGE_REVIEW_ROLES,
} from './types';
import {CHALLENGE_RULES} from './rules';
import {isRetainedQuestion} from './selection';

export const CHALLENGE_REVIEW_PROTOCOL_VERSION = `${CHALLENGE_RULES.runtimeReviewPolicy.id}:${CHALLENGE_RULES.runtimeReviewPolicy.version}`;
export const LEGACY_CHALLENGE_REVIEW_PROTOCOL_VERSION =
  'challenge-runtime-review-v1:1';

export function challengeReviewQuestionIds(
  record: Pick<ChallengeRecord, 'candidate' | 'reviewProtocolVersion'>,
): string[] {
  const questions = record.candidate?.questions || [];
  return (
    record.reviewProtocolVersion === CHALLENGE_REVIEW_PROTOCOL_VERSION
      ? questions.filter(question => !isRetainedQuestion(question))
      : questions
  ).map(question => question.id);
}

export function isChallengeRoundtableSize(
  value: unknown,
): value is ChallengeRoundtableSize {
  return value === 0 || value === 3 || value === 5;
}

export function getChallengeReviewRoles(
  size: ChallengeRoundtableSize,
): ChallengeReviewRole[] {
  if (size === 0) {
    return ['answers'];
  }
  if (size === 3) {
    return ['subject', 'difficulty', 'answers'];
  }
  if (size === 5) {
    return [...CHALLENGE_REVIEW_ROLES];
  }
  throw new Error('新卷圆桌评审人数必须为0、3或5');
}

export function challengeReviewRoleLabel(
  role: ChallengeReviewRole,
  size: ChallengeRoundtableSize = 5,
) {
  if (size === 0) {
    return '基础综合校核';
  }
  const labels: Record<ChallengeReviewRole, string> = {
    subject: size === 3 ? '学科命题与知识范围' : '学科命题',
    scope: '知识范围与原卷保真',
    difficulty: '难度与知识点掌握',
    answers: size === 3 ? '答案、图文与评分' : '答案与评分',
    presentation: '图文与试卷呈现',
  };
  return labels[role];
}

export function challengeReviewRoundComplete(
  record: ChallengeRecord,
  round: ChallengeReviewRound | undefined = record.reviewRounds[
    record.reviewRounds.length - 1
  ],
): boolean {
  const size = record.reviewRoundtableSize ?? 0;
  if (
    !isChallengeRoundtableSize(size) ||
    !round ||
    !record.candidate ||
    !Array.isArray(record.candidate.questions) ||
    !Number.isInteger(record.candidateRevision) ||
    round.candidateRevision !== record.candidateRevision
  ) {
    return false;
  }
  const modern =
    record.reviewRoundtableSize !== undefined ||
    record.reviewProtocolVersion !== undefined;
  if (modern) {
    if (
      ![
        CHALLENGE_REVIEW_PROTOCOL_VERSION,
        LEGACY_CHALLENGE_REVIEW_PROTOCOL_VERSION,
      ].includes(record.reviewProtocolVersion || '') ||
      record.reviewRoundtableSize === undefined ||
      round.roundtableSize !== size
    ) {
      return false;
    }
  } else if (round.roundtableSize !== undefined) {
    return false;
  }
  const allIds = record.candidate.questions.map(question => question?.id);
  if (
    !allIds.length ||
    allIds.some(id => typeof id !== 'string' || !id.trim()) ||
    new Set(allIds).size !== allIds.length ||
    (record.analysis &&
      (record.analysis.questions.length !== allIds.length ||
        record.analysis.questions.some(
          (question, index) => question.id !== allIds[index],
        )))
  ) {
    return false;
  }
  const roles = getChallengeReviewRoles(size);
  const ids = challengeReviewQuestionIds(record);
  if (
    !ids.length &&
    record.reviewProtocolVersion === CHALLENGE_REVIEW_PROTOCOL_VERSION
  ) {
    return Array.isArray(round.reviews) && round.reviews.length === 0;
  }
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    !Array.isArray(round.reviews) ||
    round.reviews.length !== roles.length
  ) {
    return false;
  }
  return roles.every(role => {
    const reports = round.reviews.filter(report => report.role === role);
    if (reports.length !== 1) {
      return false;
    }
    const report = reports[0];
    return (
      (report.verdict === 'approve' || report.verdict === 'revise') &&
      Array.isArray(report.issues) &&
      (report.verdict === 'approve') === (report.issues.length === 0) &&
      typeof report.summary === 'string' &&
      !!report.summary.trim() &&
      Array.isArray(report.checkedQuestionIds) &&
      report.checkedQuestionIds.length === ids.length &&
      new Set(report.checkedQuestionIds).size === ids.length &&
      ids.every(id => report.checkedQuestionIds.includes(id))
    );
  });
}

export function hasPassedChallengeReview(
  record: ChallengeRecord,
  round: ChallengeReviewRound | undefined = record.reviewRounds[
    record.reviewRounds.length - 1
  ],
): boolean {
  return (
    challengeReviewRoundComplete(record, round) &&
    !!round?.reviews.every(report => report.verdict === 'approve')
  );
}
