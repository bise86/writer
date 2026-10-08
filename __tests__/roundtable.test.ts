import {getRoundtableState, saveRoundtableState} from '../src/db/database';
import {DEFAULT_SETTINGS} from '../src/settings';
import {runResponse} from '../src/services/openai';
import {scoreEssay} from '../src/services/scoring';
import {validateOpinion} from '../src/services/roundtable';
import {AppSettings, ReviewOpinion, ScoreResult} from '../src/types';

jest.mock('react-native-fs', () => ({}));
jest.mock('../src/db/database', () => ({
  getRoundtableState: jest.fn(),
  saveRoundtableState: jest.fn(),
  getScoreAttempts: jest.fn(async () => []),
  saveScoreAttempt: jest.fn(),
}));
jest.mock('../src/services/openai', () => ({
  ...jest.requireActual('../src/services/openai'),
  runResponse: jest.fn(),
}));

const source = '初春，我在雨中学会了等待。';
const feedback = {
  strengths: ['场景清楚'],
  weaknesses: ['细节不足'],
  improvements: ['补充等候时的动作'],
};
const draft: ScoreResult = {
  score: 61,
  bandId: 'pass',
  summary: '通过等待表现成长，需要充实细节。',
  dimensionScores: {
    thesis: 16,
    content: 14,
    structure: 11,
    language: 14,
    format: 6,
  },
  dimensionFeedback: Object.fromEntries(
    ['thesis', 'content', 'structure', 'language', 'format'].map(key => [
      key,
      feedback,
    ]),
  ),
  ...feedback,
  suggestions: ['练习场景描写'],
  paragraphReviews: [{paragraphIndex: 1, ...feedback}],
  annotations: [
    {
      quote: '雨中',
      type: 'improvement',
      comment: '场景可以更具体',
      suggestion: '加入雨声与动作',
    },
  ],
};
const approve: ReviewOpinion = {
  scoreApproved: true,
  annotationsApproved: true,
  scoreReason: '分项和总分对应原文表现',
  annotationsReason: '批注准确引用雨中，建议可以落实',
  changes: [],
};
const rejectAnnotations: ReviewOpinion = {
  ...approve,
  annotationsApproved: false,
  annotationsReason: '批注建议需要区分环境和动作的作用',
  changes: ['解释雨声如何烘托等候心情'],
};
const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  apiKey: 'unit-test-key',
  roundtableSize: 3,
};
const response = (value: unknown) => ({text: JSON.stringify(value)});
const request = runResponse as jest.Mock;
let checkpoint: unknown;

beforeEach(() => {
  jest.clearAllMocks();
  checkpoint = undefined;
  (getRoundtableState as jest.Mock).mockImplementation(async () => checkpoint);
  (saveRoundtableState as jest.Mock).mockImplementation(async (_id, state) => {
    checkpoint = JSON.parse(JSON.stringify(state));
  });
  request
    .mockReset()
    .mockImplementation(
      async (_input, _instructions, _settings, _model, options) =>
        response(
          options.textFormat?.name === 'essay_roundtable_opinion'
            ? approve
            : draft,
        ),
    );
});

test('默认 0 只执行单次评分，不生成圆桌票数', async () => {
  const result = await scoreEssay(source, {...settings, roundtableSize: 0});
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.roundtable).toBeUndefined();
  expect(saveRoundtableState).not.toHaveBeenCalled();
});

test.each([3, 5] as const)(
  '%s 角色独立审阅，再读取全体意见投票，由 App 汇总',
  async count => {
    const progress = jest.fn();
    const result = await scoreEssay(
      source,
      {...settings, roundtableSize: count},
      {essayId: '1', onProgress: progress},
    );
    expect(request).toHaveBeenCalledTimes(1 + count * 2);
    const independent = request.mock.calls.slice(1, 1 + count);
    const voting = request.mock.calls.slice(1 + count);
    expect(new Set(independent.map(call => call[1])).size).toBe(count);
    independent.forEach(([input, instructions]) => {
      expect(input).toContain(source);
      expect(input).not.toContain('本轮各角色的独立意见');
      expect(input).not.toContain('roleId');
      expect(instructions).toContain('先独立审阅');
    });
    const round = result.roundtable!.rounds[0];
    voting.forEach(([input]) => {
      expect(input).toContain('本轮各角色的独立意见');
      round.reviews.forEach(review => expect(input).toContain(review.roleId));
      expect(input).toContain('草案在本轮讨论中没有修改');
    });
    expect(round.votes).toHaveLength(count);
    expect(new Set(round.votes.map(vote => vote.roleId)).size).toBe(count);
    expect(round).toMatchObject({scoreVotes: count, annotationVotes: count});
    expect(result.roundtable!.majority).toBe(Math.floor(count / 2) + 1);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('各需'));
    expect(JSON.stringify(checkpoint)).not.toContain(settings.apiKey);
  },
);

test('只要评分或批注有一项未过半就修改草案，再让所有角色重投', async () => {
  let votes = 0;
  request.mockImplementation(
    async (input, instructions, _settings, _model, options) => {
      if (options.textFormat?.name !== 'essay_roundtable_opinion') {
        return response(
          input.includes('上一轮草案')
            ? {...draft, summary: '已按雨声的作用修订'}
            : draft,
        );
      }
      if (instructions.includes('给出本轮最终投票理由')) {
        votes++;
        return response(votes <= 2 ? rejectAnnotations : approve);
      }
      return response(approve);
    },
  );
  const result = await scoreEssay(source, settings, {essayId: '1'});
  expect(request).toHaveBeenCalledTimes(14);
  expect(result.summary).toBe('已按雨声的作用修订');
  expect(
    result.roundtable!.rounds.map(round => [
      round.scoreVotes,
      round.annotationVotes,
    ]),
  ).toEqual([
    [3, 1],
    [3, 3],
  ]);
  expect(request.mock.calls[7][0]).toContain(rejectAnnotations.changes[0]);
  expect(request.mock.calls[8][0]).toContain('已按雨声的作用修订');
});

test.each([3, 5] as const)(
  '%s 人采用严格过半同意，保留少数反对票',
  async count => {
    let votes = 0;
    request.mockImplementation(
      async (_input, instructions, _settings, _model, options) => {
        if (options.textFormat?.name !== 'essay_roundtable_opinion') {
          return response(draft);
        }
        return response(
          instructions.includes('给出本轮最终投票理由') && ++votes === 1
            ? rejectAnnotations
            : approve,
        );
      },
    );
    const result = await scoreEssay(source, {
      ...settings,
      roundtableSize: count,
    });
    expect(result.roundtable!.rounds).toHaveLength(1);
    expect(result.roundtable!.rounds[0].annotationVotes).toBe(count - 1);
    expect(result.roundtable!.rounds[0].votes[0].changes).toEqual(
      rejectAnnotations.changes,
    );
  },
);

test('某个角色网络失败不能冒充通过，重试只继续未完成的角色', async () => {
  const normal = request.getMockImplementation()!;
  request.mockImplementation(async (...args) => {
    if (request.mock.calls.length === 6) {
      throw new Error('network offline');
    }
    return normal(...args);
  });
  await expect(scoreEssay(source, settings, {essayId: '1'})).rejects.toThrow(
    'network offline',
  );
  request.mockImplementation(normal);
  const result = await scoreEssay(source, settings, {essayId: '1'});
  expect(request).toHaveBeenCalledTimes(8);
  expect(result.roundtable!.rounds[0].scoreVotes).toBe(3);
  expect(request.mock.calls[6][1]).toContain('结构与语言审阅人');
});

test('格式错误在当前角色上下文追加纠正，不污染其他角色', async () => {
  const normal = request.getMockImplementation()!;
  request.mockImplementation(async (...args) =>
    request.mock.calls.length === 2
      ? response({...approve, annotationsApproved: 'yes'})
      : normal(...args),
  );
  await scoreEssay(source, settings, {essayId: '1'});
  expect(request).toHaveBeenCalledTimes(8);
  const fixed = request.mock.calls[2];
  expect(fixed[4].history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('"yes"'),
      }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('布尔值'),
      }),
    ]),
  );
  expect(fixed[0]).toContain('上次校验反馈');
  expect(request.mock.calls[3][4].history).toEqual([]);
});

test('连续三轮不同意时不发布，手动重试保留历史并进入第四轮', async () => {
  const normal = request.getMockImplementation()!;
  request.mockImplementation(async (...args) =>
    args[4].textFormat?.name === 'essay_roundtable_opinion'
      ? response({
          ...approve,
          scoreApproved: false,
          changes: ['分数必须更贴合实际材料'],
        })
      : normal(...args),
  );
  await expect(scoreEssay(source, settings, {essayId: '1'})).rejects.toThrow(
    '尚未获过半同意',
  );
  expect(request).toHaveBeenCalledTimes(21);
  expect(checkpoint).toMatchObject({nextRound: 3});
  request.mockImplementation(normal);
  const result = await scoreEssay(source, settings, {essayId: '1'});
  expect(request).toHaveBeenCalledTimes(28);
  expect(result.roundtable!.rounds).toHaveLength(4);
  expect(result.roundtable!.rounds[3]).toMatchObject({
    round: 4,
    scoreVotes: 3,
    annotationVotes: 3,
  });
});

test.each(['source', 'model', 'size'] as const)(
  '修改 %s 后旧票失效，完整重新评审',
  async change => {
    await scoreEssay(source, settings, {essayId: '1'});
    request.mockClear();
    const count = change === 'size' ? 5 : 3;
    await scoreEssay(
      change === 'source' ? source + '我继续等候。' : source,
      {
        ...settings,
        roundtableSize: count,
        modelName: change === 'model' ? 'another-model' : settings.modelName,
      },
      {essayId: '1'},
    );
    expect(request).toHaveBeenCalledTimes(1 + count * 2);
  },
);

test('草案自己伪造的圆桌结果会被丢弃', async () => {
  request.mockResolvedValueOnce(
    response({
      ...draft,
      roundtable: {reviewerCount: 100, rounds: [{scoreVotes: 100}]},
    }),
  );
  const result = await scoreEssay(source, settings);
  expect(result.roundtable!.reviewerCount).toBe(3);
  expect(result.roundtable!.rounds[0].scoreVotes).toBe(3);
  expect(request.mock.calls[1][0]).not.toContain('"reviewerCount":100');
});

test('取消后不再发起评审请求或返回成功', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    scoreEssay(source, settings, {signal: controller.signal}),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

test.each([
  {...approve, scoreApproved: 3},
  {...approve, annotationsReason: ''},
  {...approve, annotationsApproved: false},
  {...approve, changes: ['仍需要修改']},
])('拒绝不完整或自相矛盾的票据 %#', invalid => {
  expect(() => validateOpinion(invalid)).toThrow();
});
