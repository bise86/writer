import {batchAnalysis, generationSignature} from './generation';
import {CHALLENGE_POLICY_VERSION} from './rules';
import {CHALLENGE_REVIEW_PROTOCOL_VERSION} from './review';
import {getChallengeReviewRoles} from './review';
import {isRetainedQuestion} from './selection';
import {validateChallengeReview} from './validation';
import type {
  ChallengeCandidateCheckpoint,
  ChallengePage,
  ChallengePaper,
  ChallengeRecord,
  ChallengeRoundtableSize,
  ExamAnalysis,
  ChallengeReviewProgress,
  ChallengeReviewBatch,
} from './types';

/** Exact signatures retain array order while ignoring JSON object key order. */
export function checkpointSignature(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]]),
        )
      : item,
  );
}
export function analysisSourceSignature(
  record: Pick<ChallengeRecord, 'sources' | 'pageUris'>,
) {
  return checkpointSignature({
    sources: record.sources,
    pageUris: record.pageUris,
  });
}
export function analysisPagesSignature(pages: ChallengePage[]) {
  return checkpointSignature(pages);
}
export function analysisRequestSignature(input: unknown, instructions: string) {
  // Original image files are already bound by analysisSourceSignature. Do not
  // duplicate their base64 bytes inside the durable JSON checkpoint.
  const normalized = JSON.parse(
    JSON.stringify(input, (key, item) =>
      key === 'image_url' &&
      typeof item === 'string' &&
      item.startsWith('data:')
        ? 'bound-original-image'
        : item,
    ),
  );
  return checkpointSignature({input: normalized, instructions});
}
export function candidateCheckpoint(
  analysis: ExamAnalysis,
  paper: ChallengePaper,
  pageUris: string[],
  candidateRevision: number,
  roundtableSize: ChallengeRoundtableSize,
): ChallengeCandidateCheckpoint {
  return {
    sourceSignature: checkpointSignature({
      source: generationSignature(analysis),
      pageUris,
    }),
    candidateSignature: checkpointSignature(paper),
    candidateRevision,
    policyVersion: CHALLENGE_POLICY_VERSION,
    reviewProtocolVersion: CHALLENGE_REVIEW_PROTOCOL_VERSION,
    roundtableSize,
  };
}
export function sameCandidateCheckpoint(
  stored: ChallengeCandidateCheckpoint | undefined,
  expected: ChallengeCandidateCheckpoint,
) {
  return (
    !!stored &&
    (
      [
        'sourceSignature',
        'candidateSignature',
        'candidateRevision',
        'policyVersion',
        'reviewProtocolVersion',
        'roundtableSize',
      ] as const
    ).every(key => stored[key] === expected[key])
  );
}

/** Reuse only reports bound to this exact source, candidate, role and image page. */
export function resumableReviewBatches(
  stored: ChallengeReviewProgress | undefined,
  expected: ChallengeCandidateCheckpoint,
  round: number,
  analysis: ExamAnalysis,
  paper: ChallengePaper,
): ChallengeReviewBatch[] {
  if (
    stored?.version !== 'review-batches-v1' ||
    stored.round !== round ||
    !sameCandidateCheckpoint(stored, expected) ||
    !Array.isArray(stored.batches)
  ) {
    return [];
  }
  const roles = getChallengeReviewRoles(expected.roundtableSize);
  const pages = new Map(
    paper.questions
      .filter(question => !isRetainedQuestion(question))
      .map(question => {
        const indices = [
          ...new Set(
            batchAnalysis(analysis, [question.id]).figures.map(
              figure => figure.pageIndex,
            ),
          ),
        ];
        return [question.id, new Set(indices.length ? indices : [-1])] as const;
      }),
  );
  const seen = new Set<string>();
  const result: ChallengeReviewBatch[] = [];
  for (const batch of stored.batches) {
    if (
      !batch ||
      !roles.includes(batch.role) ||
      !Number.isInteger(batch.pageIndex) ||
      !Array.isArray(batch.questionIds) ||
      !batch.questionIds.length ||
      new Set(batch.questionIds).size !== batch.questionIds.length ||
      batch.questionIds.some(
        id =>
          !pages.get(id)?.has(batch.pageIndex) ||
          seen.has(JSON.stringify([batch.role, batch.pageIndex, id])),
      )
    ) {
      continue;
    }
    try {
      const report = validateChallengeReview(batch.report, batch.role, {
        ...paper,
        questions: paper.questions.filter(question =>
          batch.questionIds.includes(question.id),
        ),
      });
      result.push({...batch, report});
      batch.questionIds.forEach(id =>
        seen.add(JSON.stringify([batch.role, batch.pageIndex, id])),
      );
    } catch (_) {
      // A malformed or stale sub-report is rerun, never promoted into a vote.
    }
  }
  return result;
}
