import {
  CHALLENGE_REVIEW_PROTOCOL_VERSION,
  LEGACY_CHALLENGE_REVIEW_PROTOCOL_VERSION,
  challengeReviewQuestionIds,
  getChallengeReviewRoles,
  hasPassedChallengeReview,
} from '../src/challenge/review';
import type {
  ChallengeRecord,
  ChallengeRoundtableSize,
} from '../src/challenge/types';

function record(size: ChallengeRoundtableSize = 3): ChallengeRecord {
  const questions = ['changed', 'original'].map((id, index) => ({
    id,
    number: String(index + 1),
    sectionId: 's',
    type: '解答题',
    stem: '原题或变式',
    options: [],
    materialIds: [],
    figureIds: [],
    knowledgePoints: ['等量关系'],
    score: 5,
    isListening: false,
    answerLines: 2,
    upgrade: {
      mode: index ? ('retained' as const) : ('upgraded' as const),
      level: 1 as const,
      metrics: {},
      changes: [],
      pitfalls: [],
      scopeExplanation: '同范围',
    },
  }));
  return {
    id: 'challenge_scope',
    title: '试卷',
    status: 'reviewing',
    sources: [],
    pageUris: [],
    pages: [],
    level: 1,
    calls: [],
    createdAt: '',
    updatedAt: '',
    progress: '',
    error: '',
    reviewProtocolVersion: CHALLENGE_REVIEW_PROTOCOL_VERSION,
    reviewRoundtableSize: size,
    candidateRevision: 1,
    candidate: {
      title: '试卷',
      level: 1,
      subject: 'math',
      sections: [],
      materials: [],
      figures: [],
      questions,
      answers: [],
      totalScore: 10,
      timeLimitMinutes: null,
    },
    reviewRounds: [
      {
        round: 1,
        candidateRevision: 1,
        roundtableSize: size,
        reviews: getChallengeReviewRoles(size).map(role => ({
          role,
          verdict: 'approve',
          checkedQuestionIds: ['changed'],
          summary: '本席独立检查升档题。',
          issues: [],
        })),
      },
    ],
  };
}

test.each([0, 3, 5] as const)(
  '新协议%s角色只需要覆盖升档题，原题不计漏审',
  size => {
    const value = record(size);
    expect(challengeReviewQuestionIds(value)).toEqual(['changed']);
    expect(hasPassedChallengeReview(value)).toBe(true);
    value.reviewRounds[0].reviews[0].checkedQuestionIds.push('original');
    expect(hasPassedChallengeReview(value)).toBe(false);
  },
);

test('全卷原题保留时不伪造角色通过票，空评审轮表示无需模型评审', () => {
  const value = record(5);
  value.candidate!.questions[0].upgrade.mode = 'retained';
  value.reviewRounds[0].reviews = [];
  expect(challengeReviewQuestionIds(value)).toEqual([]);
  expect(hasPassedChallengeReview(value)).toBe(true);
  value.reviewRounds[0].reviews = [
    {
      role: 'answers',
      verdict: 'approve',
      checkedQuestionIds: [],
      summary: '伪造通过',
      issues: [],
    },
  ];
  expect(hasPassedChallengeReview(value)).toBe(false);
});

test('无需模型评审也不能接受空卷或重复题号列表', () => {
  const value = record(5);
  value.reviewRounds[0].reviews = [];
  value.candidate!.questions = [];
  expect(hasPassedChallengeReview(value)).toBe(false);
  const original = record(5).candidate!.questions[1];
  value.candidate!.questions = [original, original];
  expect(hasPassedChallengeReview(value)).toBe(false);
});

test('旧v1协议仍按原来全卷题目验证历史票，不改写或伪造历史记录', () => {
  const value = record(3);
  value.reviewProtocolVersion = LEGACY_CHALLENGE_REVIEW_PROTOCOL_VERSION;
  value.reviewRounds[0].reviews.forEach(review => {
    review.checkedQuestionIds = ['changed', 'original'];
  });
  expect(challengeReviewQuestionIds(value)).toEqual(['changed', 'original']);
  expect(hasPassedChallengeReview(value)).toBe(true);
  value.reviewRounds[0].reviews[0].checkedQuestionIds = ['changed'];
  expect(hasPassedChallengeReview(value)).toBe(false);
});
