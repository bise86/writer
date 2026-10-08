import {getScoreAttempts, saveScoreAttempt} from '../src/db/database';
import {DEFAULT_SETTINGS} from '../src/settings';
import {runResponse} from '../src/services/openai';
import {scoreEssay, scoreInstructions} from '../src/services/scoring';
import {ScoreResult} from '../src/types';

jest.mock('react-native-fs', () => ({}));
jest.mock('../src/db/database', () => ({
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

const request = runResponse as jest.Mock;
const settings = {...DEFAULT_SETTINGS, apiKey: 'unit-test-key'};
beforeEach(() => {
  jest.clearAllMocks();
  request.mockReset().mockResolvedValue({text: JSON.stringify(draft)});
  (getScoreAttempts as jest.Mock).mockResolvedValue([]);
});

test.each([0, 3, 5] as const)(
  '设置为 %s 时通过一次模型请求获得最终评分',
  async roundtableSize => {
    const result = await scoreEssay(
      source,
      {...settings, roundtableSize},
      {essayId: '1'},
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.score).toBe(61);
    expect(result.annotations[0].quote).toBe('雨中');
    expect(saveScoreAttempt).toHaveBeenCalledWith(
      '1',
      source,
      JSON.stringify(draft),
      '',
    );
    const [input, instructions] = request.mock.calls[0];
    expect(input).toContain(source);
    if (roundtableSize) {
      expect(instructions).toContain(`组织 ${roundtableSize} 个不同角色`);
      expect(instructions).toContain('会议目的：');
      expect(instructions).toContain('会议内容：');
      expect(instructions).toContain('分别对评分和批注投票');
      expect(instructions).toContain(
        '所需结果：只返回会议确认后的最终评分 JSON',
      );
    } else {
      expect(instructions).not.toContain('圆桌会议');
      expect(instructions).not.toContain('投票');
    }
  },
);

test('3 和 5 只改变提示中的角色数量，最终评分格式保持一致', () => {
  const three = scoreInstructions(3);
  const five = scoreInstructions(5);
  expect(three.replace('组织 3 个', '组织 5 个')).toBe(five);
  for (const prompt of [three, five]) {
    expect(prompt).toContain('不要输出会议过程、角色发言、投票记录或中间草案');
    expect(prompt).toContain('标题不是正文段落');
    expect(prompt).toContain('paragraphReviews');
    expect(prompt).toContain('annotations');
    expect(prompt).toContain('叙述、描写、修辞、抒情');
  }
});

test('仅在最终 JSON 校验失败时追加纠正，不调度角色或投票请求', async () => {
  request.mockResolvedValueOnce({text: '{"score":61}'});
  await scoreEssay(source, {...settings, roundtableSize: 5}, {essayId: '1'});
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1]).toBe(request.mock.calls[0][1]);
  expect(request.mock.calls[1][4].history).toEqual(
    expect.arrayContaining([
      {role: 'assistant', content: '{"score":61}'},
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('评分校验未通过'),
      }),
    ]),
  );
  expect(saveScoreAttempt).toHaveBeenCalledTimes(2);
});

test('重试恢复最终输出及校验反馈，以当前角色数量请求模型', async () => {
  (getScoreAttempts as jest.Mock).mockResolvedValue([
    {sourceText: source, output: '{"score":61}', feedback: '缺少 annotations'},
  ]);
  await scoreEssay(source, {...settings, roundtableSize: 3}, {essayId: '1'});
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][4].history).toContainEqual({
    role: 'user',
    content: '缺少 annotations',
  });
  expect(request.mock.calls[0][1]).toContain('组织 3 个不同角色');
});
