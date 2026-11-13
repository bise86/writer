import {Image} from 'react-native';
import RNFS from 'react-native-fs';
import ImageEditor from '@react-native-community/image-editor';
import {PDFDocument, PDFName, PDFPage, PDFRawStream} from 'pdf-lib';
import {writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {buildChallengePdfs} from '../src/challenge/pdf';
import {prepareRetainedAnalysis} from '../src/challenge/retention';
import {preserveRequiredOriginals} from '../src/challenge/selection';
import {
  ChallengeLearningGuide,
  ChallengePaper,
  ExamAnalysis,
  SourceFigure,
} from '../src/challenge/types';

jest.mock('react-native-fs', () => ({
  readFile: jest.fn(),
  unlink: jest.fn(async () => undefined),
}));
jest.mock('@react-native-community/image-editor', () => ({
  __esModule: true,
  default: {cropImage: jest.fn()},
}));

const png =
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJUlEQVR4nO3NMQEAAAgDILV/5xljDxRgk0zDVVaxWCwWi8XiigcB4QMlssy/eAAAAABJRU5ErkJggg==';
const jpeg =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAUACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigAooooAKKKKACiiigAooooAKKKKAP//Z';

function fixture() {
  const paper: ChallengePaper = {
    title: '数学挑战试卷',
    level: 2,
    subject: 'math',
    sections: [
      {id: 's1', title: '一、选择与计算', instructions: '请按题意作答。'},
    ],
    materials: [
      {
        id: 'm1',
        title: '统计材料',
        text: '某班分组完成活动，数据列于题目中。',
        isListening: false,
        figureIds: [],
      },
    ],
    figures: [],
    questions: [
      {
        id: 'q1',
        number: '1',
        sectionId: 's1',
        type: '单项选择',
        stem: '一个数的两倍比这个数多6，这个数是多少？',
        options: [
          {label: 'A', text: '3'},
          {label: 'B', text: '6'},
          {label: 'C', text: '12'},
        ],
        materialIds: ['m1'],
        figureIds: [],
        knowledgePoints: ['一元一次方程'],
        score: 3,
        isListening: false,
        answerLines: 1,
        upgrade: {
          level: 2,
          metrics: {},
          changes: ['增加条件辨析'],
          pitfalls: ['关系理解'],
          scopeExplanation: '仍在一元一次方程范围内',
        },
      },
      {
        id: 'q2',
        number: '2(1)',
        sectionId: 's1',
        type: '计算',
        stem: '计算并说明过程：3x + 4 = 19。',
        options: [],
        materialIds: ['m1'],
        figureIds: [],
        knowledgePoints: ['一元一次方程'],
        score: 5,
        isListening: false,
        answerLines: 4,
        upgrade: {
          level: 2,
          metrics: {},
          changes: ['说明推理'],
          pitfalls: ['移项符号'],
          scopeExplanation: '仍在一元一次方程范围内',
        },
      },
    ],
    answers: [
      {
        questionId: 'q1',
        status: 'verified',
        answer: 'B · ANSWER_ONLY_SECRET',
        explanation: '设这个数为x，则2x-x=6，因此x=6。',
        scoringPoints: ['正确理解倍数关系'],
      },
      {
        questionId: 'q2',
        status: 'verified',
        answer: 'x=5',
        explanation: '先减去4，再两边同时除以3。',
        scoringPoints: ['两边同时减4', '两边同时除以3'],
      },
    ],
    totalScore: 8,
    timeLimitMinutes: 20,
  };
  const analysis: ExamAnalysis = {
    isExam: true,
    title: '原始试卷',
    subject: 'math',
    subjectLabel: '数学',
    educationLevel: 'middle',
    knowledgePoints: ['一元一次方程'],
    difficultySummary: '条件直接',
    difficultyBasis: 'estimated',
    answerState: 'answered',
    sections: paper.sections,
    materials: paper.materials,
    figures: [],
    questions: paper.questions.map(question => ({
      ...question,
      sourceRefs: [{pageIndex: 0, quote: 'STUDENT_OLD_ANSWER_SECRET'}],
      difficulty: {rating: 2, reasoningSteps: 1, explanation: '直接列方程'},
    })),
    totalScore: 8,
    timeLimitMinutes: 20,
    warnings: [],
    unresolvedIssues: [],
  };
  return {analysis, paper};
}

function textFor(spy: jest.SpyInstance, suffix: string, size?: number) {
  return spy.mock.calls
    .filter(
      ([, options], index) =>
        (spy.mock.contexts[index] as PDFPage).doc
          .getTitle()
          ?.endsWith(suffix) &&
        (size === undefined || options?.size === size),
    )
    .map(([value]) => value)
    .join('');
}

const cleanFigure: SourceFigure = {
  id: 'f1',
  kind: 'source',
  pageIndex: 0,
  box: {x: 0.2, y: 0.2, width: 0.4, height: 0.4},
  caption: '三角形ABC示意图',
  containsStudentMarks: false,
};

function withFigure() {
  const {analysis, paper} = fixture();
  analysis.figures = [{...cleanFigure, box: {...cleanFigure.box}}];
  paper.figures = [{...cleanFigure, box: {...cleanFigure.box}}];
  paper.questions[0].figureIds = ['f1'];
  paper.questions[1].figureIds = ['f1'];
  return {analysis, paper};
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(Image, 'getSize')
    .mockImplementation(((
      uri: string,
      success: (width: number, height: number) => void,
    ) => success(2000, 1000)) as typeof Image.getSize);
  (ImageEditor.cropImage as jest.Mock).mockResolvedValue({
    uri: 'file:///cache/challenge-cropped.png',
  });
  (RNFS.readFile as jest.Mock).mockResolvedValue(png);
  (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('真实试卷PDF完成后答案文档失败，回调保留前份文件，恢复时只绘制答案', async () => {
  const {analysis, paper} = fixture();
  const createDocument = PDFDocument.create.bind(PDFDocument);
  let documents = 0;
  const create = jest
    .spyOn(PDFDocument, 'create')
    .mockImplementation(async () => {
      if (++documents === 2) {throw new Error('答案文档初始化失败');}
      return createDocument();
    });
  let paperBase64 = '';
  const saved = jest.fn(async (kind: 'paper' | 'answers', base64: string) => {
    if (kind === 'paper') {paperBase64 = base64;}
  });
  await expect(
    buildChallengePdfs(analysis, paper, [], undefined, {onDocument: saved}),
  ).rejects.toThrow('答案文档初始化失败');
  expect(saved).toHaveBeenCalledTimes(1);
  expect((await PDFDocument.load(paperBase64)).getPageCount()).toBeGreaterThan(
    0,
  );
  create.mockRestore();
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  saved.mockClear();
  const result = await buildChallengePdfs(analysis, paper, [], undefined, {
    paperBase64,
    onDocument: saved,
  });
  expect(result.paperBase64).toBe(paperBase64);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(saved.mock.calls[0][0]).toBe('answers');
  const rendered = draw.mock.calls.map(call => call[0]).join('\n');
  expect(rendered).toContain('答案与解析');
  expect(rendered).not.toContain('姓名：');
  expect(
    (await PDFDocument.load(result.answersBase64)).getPageCount(),
  ).toBeGreaterThan(0);
});

test('双PDF缓存可跳过绘制，仍拒绝缺题、错序和无效缓存', async () => {
  const {analysis, paper} = fixture();
  const pdfs = await buildChallengePdfs(analysis, paper, []);
  const create = jest.spyOn(PDFDocument, 'create');
  expect(
    await buildChallengePdfs(analysis, paper, [], undefined, pdfs),
  ).toEqual(pdfs);
  expect(create).not.toHaveBeenCalled();
  await expect(
    buildChallengePdfs(
      analysis,
      {...paper, questions: [...paper.questions].reverse()},
      [],
      undefined,
      pdfs,
    ),
  ).rejects.toThrow('顺序或答案对应不完整');
  await expect(
    buildChallengePdfs(analysis, paper, [], undefined, {
      ...pdfs,
      paperBase64: 'broken',
    }),
  ).rejects.toThrow('保存的PDF内容无效');
});

test('生成两个独立真实PDF，试卷保留题型编号选项和留白，不含答案或原作答', async () => {
  const {analysis, paper} = fixture();
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const {paperBase64, answersBase64} = await buildChallengePdfs(
    analysis,
    paper,
    [],
  );
  const questionText = textFor(draw, '· 试卷');
  const answerText = textFor(draw, '· 答案与解析');
  expect(questionText).toContain('第 2(1) 题');
  expect(questionText).toContain('A. 3');
  expect(questionText).toContain('姓名：');
  expect(questionText).not.toContain('ANSWER_ONLY_SECRET');
  expect(questionText).not.toContain('STUDENT_OLD_ANSWER_SECRET');
  expect(questionText).not.toContain('评分点');
  expect(answerText).toContain('ANSWER_ONLY_SECRET');
  expect(answerText).toContain('两边同时除以3');
  expect(answerText).toContain('知识点：一元一次方程');
  for (const [base64, title] of [
    [paperBase64, '数学挑战试卷 · 试卷'],
    [answersBase64, '数学挑战试卷 · 答案与解析'],
  ]) {
    const bytes = Buffer.from(base64, 'base64');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const document = await PDFDocument.load(bytes);
    expect(document.getTitle()).toBe(title);
    expect(
      document
        .getPages()
        .every(
          page =>
            page.getWidth() === PAGE_WIDTH && page.getHeight() === PAGE_HEIGHT,
        ),
    ).toBe(true);
  }
  expect(RNFS.readFile).not.toHaveBeenCalled();
});

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

function learningGuide(): ChallengeLearningGuide {
  return {
    knowledgePoint: '一元一次方程',
    coreInsight: '把两个量之间的差写成等式，等式两边必须表示同一数量。',
    conditionBoundary: '先确定比较对象；两边除以同一个数时，该数不能为0。',
    reasoning: '设原数为x，比较对象是2x与x，因此由差为6得到2x-x=6。',
    problemQuote: 'PROBLEM_EVIDENCE_METADATA_ONLY',
    solutionQuote: 'SOLUTION_EVIDENCE_METADATA_ONLY',
    misconceptions: [
      {
        challengeId: 'CHALLENGE_ID_METADATA_ONLY',
        wrongApproach: '看到两倍就直接用6除以2。',
        whyWrong: '6是两个量的差，不是两倍后的量，不能直接用倍数关系求原数。',
        correction: '先写出两倍量与原数的差，再依据等式求解。',
        solutionQuote: 'MISTAKE_EVIDENCE_METADATA_ONLY',
        scopeReason: 'SCOPE_REASON_METADATA_ONLY',
        sourceQuote: 'SOURCE_EVIDENCE_METADATA_ONLY',
      },
    ],
    transferLinks: [
      {
        kind: 'source_to_variant',
        originalCondition: '原题给出一个数的两倍为12。',
        changedCondition: '新题给出两倍量与原数的差为6。',
        invariant: '按照同一数量关系列出等式。',
        adaptation: '等式左边由2x改为2x-x，先处理比较关系。',
        sourceQuote: 'TRANSFER_SOURCE_METADATA_ONLY',
        problemQuote: 'TRANSFER_PROBLEM_METADATA_ONLY',
        solutionQuote: 'TRANSFER_SOLUTION_METADATA_ONLY',
      },
      {
        kind: 'condition_contrast',
        originalCondition: '比较量是两倍量。',
        changedCondition: '比较量是两倍量与原数的差。',
        invariant: '先明确已知数量的含义再列式。',
        adaptation: '逐项核对式子中的每一项所指的量。',
        sourceQuote: 'CONTRAST_SOURCE_METADATA_ONLY',
        problemQuote: 'CONTRAST_PROBLEM_METADATA_ONLY',
        solutionQuote: 'CONTRAST_SOLUTION_METADATA_ONLY',
      },
    ],
    selfChecks: [
      {
        kind: 'conditions',
        method: '不看列式，用自己的话说明6表示哪两个量的差。',
        expected: '应明确是两倍量减去原数，而非两倍量本身。',
        solutionQuote: 'CONDITIONS_CHECK_METADATA_ONLY',
      },
      {
        kind: 'reasoning',
        method: '逐项解释方程2x-x=6中的两个含x项。',
        expected: '2x代表两倍量，x代表原数，作差对应题意。',
        solutionQuote: 'REASONING_CHECK_METADATA_ONLY',
      },
      {
        kind: 'result',
        method: '把x=6代回数量关系，检查两倍量与原数的差。',
        expected: '12-6=6，同时满足原数量关系。',
        solutionQuote: 'RESULT_CHECK_METADATA_ONLY',
      },
    ],
  };
}

test('掌握解析只进入答案PDF，呈现各知识点的纠错迁移自检，不泄漏校核元数据', async () => {
  const {analysis, paper} = fixture();
  paper.answers[0].learningGuide = [
    learningGuide(),
    {...learningGuide(), knowledgePoint: '等式的基本性质'},
  ];
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const result = await buildChallengePdfs(analysis, paper, []);
  const questionText = textFor(draw, '· 试卷');
  const answerText = textFor(draw, '· 答案与解析');
  expect(questionText).not.toContain('知识点掌握解析');
  expect(questionText).not.toContain('看到两倍就直接用6除以2');
  expect(questionText).not.toContain('12-6=6');
  expect(answerText).toContain('知识点掌握解析（学习说明，不另计分）');
  expect(answerText).toContain('知识点 2：等式的基本性质');
  expect(answerText).toContain(`核心理解：${learningGuide().coreInsight}`);
  expect(answerText).toContain(
    `适用条件与边界：${learningGuide().conditionBoundary}`,
  );
  expect(answerText).toContain(`推理依据：${learningGuide().reasoning}`);
  expect(answerText).toContain('可能误区 1：看到两倍就直接用6除以2。');
  expect(answerText).toContain('错因：6是两个量的差');
  expect(answerText).toContain('纠正方法：先写出两倍量与原数的差');
  expect(answerText).toContain('原题条件：原题给出一个数的两倍为12。');
  expect(answerText).toContain('新题条件：新题给出两倍量与原数的差为6。');
  expect(answerText).toContain('对比条件一：比较量是两倍量。');
  expect(answerText).toContain('对比条件二：比较量是两倍量与原数的差。');
  expect(answerText).toContain('不变原理：按照同一数量关系列出等式。');
  expect(answerText).toContain('推理调整：等式左边由2x改为2x-x');
  expect(answerText).toContain('条件自检 1：不看列式');
  expect(answerText).toContain('推理自检 2：逐项解释方程');
  expect(answerText).toContain('结果自检 3：把x=6代回数量关系');
  expect(answerText).toContain('预期：12-6=6，同时满足原数量关系。');
  expect(answerText).not.toContain('METADATA_ONLY');
  expect(questionText).not.toContain('METADATA_ONLY');
  expect(answerText).not.toContain('已完全掌握');
  expect(
    (
      await PDFDocument.load(Buffer.from(result.answersBase64, 'base64'))
    ).getPageCount(),
  ).toBeGreaterThan(0);
});

test('长知识点掌握说明完整分页、保留末尾自检且不缩小正文', async () => {
  const {analysis, paper} = fixture();
  const guide = learningGuide();
  guide.reasoning = Array.from(
    {length: 180},
    (_, index) => `掌握推理第${index}项，要明确每个量与等式的对应关系。`,
  ).join('');
  paper.answers[0].learningGuide = [guide];
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const result = await buildChallengePdfs(analysis, paper, []);
  const answerBody = textFor(draw, '· 答案与解析', 11);
  expect(answerBody).toContain(guide.reasoning);
  expect(answerBody).toContain('预期：12-6=6，同时满足原数量关系。');
  expect(textFor(draw, '· 答案与解析', 9)).toContain(
    '第 1 题 · 掌握解析 1（续）',
  );
  expect(
    (
      await PDFDocument.load(Buffer.from(result.answersBase64, 'base64'))
    ).getPageCount(),
  ).toBeGreaterThan(2);
  draw.mock.calls.forEach(([, options]) => {
    expect(options?.y).toBeGreaterThanOrEqual(26);
    expect(options?.y).toBeLessThan(PAGE_HEIGHT);
  });
  writeFileSync(
    join(tmpdir(), 'writer-challenge-learning-answers-test.pdf'),
    Buffer.from(result.answersBase64, 'base64'),
  );
}, 30000);

test.each(['verified', 'requires_audio'] as const)(
  '听力答案%s意外带学习说明时也不打印，保持听力任务和原录音核验边界',
  async status => {
    const {analysis, paper} = fixture();
    analysis.subject = paper.subject = 'english';
    analysis.subjectLabel = '英语';
    paper.questions[0].isListening = true;
    paper.answers[0].status = status;
    paper.answers[0].learningGuide = [
      {...learningGuide(), coreInsight: 'AUDIO_LEARNING_MUST_NOT_APPEAR'},
    ];
    const draw = jest.spyOn(PDFPage.prototype, 'drawText');
    await buildChallengePdfs(analysis, paper, []);
    expect(textFor(draw, '· 答案与解析')).not.toContain('知识点掌握解析');
    expect(textFor(draw, '· 答案与解析')).not.toContain('AUDIO_LEARNING');
    expect(textFor(draw, '· 试卷')).toContain('请配合原卷录音作答');
  },
);

test('长材料、长题和长解析完整分页，共用材料仅打印一次且正文不缩小截断', async () => {
  const {analysis, paper} = fixture();
  const material = Array.from(
    {length: 160},
    (_, index) => `材料第${index}项，按条件比较各组数据。`,
  ).join('');
  const stem = Array.from(
    {length: 100},
    (_, index) => `题干第${index}项，说明这个条件的作用。`,
  ).join('');
  const solution = Array.from(
    {length: 180},
    (_, index) => `解析第${index}步，保持等式两边相同变换。`,
  ).join('');
  paper.materials[0].text = material;
  paper.questions[0].stem = stem;
  paper.questions[1].answerLines = 45;
  paper.answers[0].explanation = solution;
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const result = await buildChallengePdfs(analysis, paper, []);
  const questionBody = textFor(draw, '· 试卷', 12);
  expect(questionBody).toContain(material);
  expect(questionBody.split(material)).toHaveLength(2);
  expect(questionBody).toContain(stem);
  expect(textFor(draw, '· 答案与解析', 11)).toContain(solution);
  const document = await PDFDocument.load(
    Buffer.from(result.paperBase64, 'base64'),
  );
  expect(document.getPageCount()).toBeGreaterThan(2);
  const answers = await PDFDocument.load(
    Buffer.from(result.answersBase64, 'base64'),
  );
  expect(answers.getPageCount()).toBeGreaterThan(2);
  draw.mock.calls.forEach(([, options], index) => {
    expect(options?.y).toBeGreaterThanOrEqual(26);
    expect(options?.y).toBeLessThan(
      (draw.mock.contexts[index] as PDFPage).getHeight(),
    );
  });
  writeFileSync(
    join(tmpdir(), 'writer-challenge-paper-test.pdf'),
    Buffer.from(result.paperBase64, 'base64'),
  );
  writeFileSync(
    join(tmpdir(), 'writer-challenge-answers-test.pdf'),
    Buffer.from(result.answersBase64, 'base64'),
  );
}, 30000);

test('源图在原生层实际裁切，只嵌入裁图像素，不把源页隐藏在PDF资源中', async () => {
  const {analysis, paper} = withFigure();
  const {paperBase64} = await buildChallengePdfs(analysis, paper, [
    'file:///documents/completed-paper.jpg',
  ]);
  expect(ImageEditor.cropImage).toHaveBeenCalledTimes(1);
  expect(ImageEditor.cropImage).toHaveBeenCalledWith(
    'file:///documents/completed-paper.jpg',
    expect.objectContaining({
      offset: {x: 400, y: 200},
      size: {width: 800, height: 400},
      format: 'png',
    }),
  );
  expect(RNFS.readFile).toHaveBeenCalledWith(
    '/cache/challenge-cropped.png',
    'base64',
  );
  expect((RNFS.readFile as jest.Mock).mock.calls).toHaveLength(1);
  expect(RNFS.unlink).toHaveBeenCalledWith('/cache/challenge-cropped.png');
  const pdf = await PDFDocument.load(Buffer.from(paperBase64, 'base64'));
  const images = pdf.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      object =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype'))?.toString() === '/Image',
    ) as PDFRawStream[];
  expect(images.length).toBeGreaterThan(0);
  expect(
    images.every(
      image => image.dict.get(PDFName.of('Width'))?.toString() === '40',
    ),
  ).toBe(true);
});

test('兼容原生裁切返回JPEG数据与鸿蒙URI字符串，生成后删除临时裁图', async () => {
  const {analysis, paper} = withFigure();
  (ImageEditor.cropImage as jest.Mock).mockResolvedValue(
    'file:///cache/crop.jpg',
  );
  (RNFS.readFile as jest.Mock).mockResolvedValue(jpeg);
  const result = await buildChallengePdfs(analysis, paper, [
    'file:///documents/page.png',
  ]);
  expect(
    (
      await PDFDocument.load(Buffer.from(result.paperBase64, 'base64'))
    ).getPageCount(),
  ).toBeGreaterThan(0);
  expect(RNFS.unlink).toHaveBeenCalledWith('/cache/crop.jpg');
});

test('源图含学生标记时，即使候选把标记改成false也不直接复用', async () => {
  const {analysis, paper} = withFigure();
  analysis.figures[0].containsStudentMarks = true;
  await expect(
    buildChallengePdfs(analysis, paper, ['file:///documents/page.jpg']),
  ).rejects.toThrow('包含学生作答');
  expect(ImageEditor.cropImage).not.toHaveBeenCalled();
});

test.each([
  {x: -0.1, y: 0, width: 0.4, height: 0.4},
  {x: 0.8, y: 0, width: 0.4, height: 0.4},
  {x: 0, y: 0, width: 0, height: 0.4},
  {x: 0, y: Number.NaN, width: 0.4, height: 0.4},
])('非法或不在原图范围的框%j不触发裁图和嵌入', async box => {
  const {analysis, paper} = withFigure();
  analysis.figures[0].box = box;
  paper.figures = [{...cleanFigure, box}];
  await expect(
    buildChallengePdfs(analysis, paper, ['file:///documents/page.jpg']),
  ).rejects.toThrow('图框未确认');
  expect(ImageEditor.cropImage).not.toHaveBeenCalled();
});

test('裁图读取失败仍清理临时文件，远程源图被拒绝而非读取', async () => {
  const {analysis, paper} = withFigure();
  (RNFS.readFile as jest.Mock).mockRejectedValueOnce(new Error('读取失败'));
  await expect(
    buildChallengePdfs(analysis, paper, ['file:///documents/page.jpg']),
  ).rejects.toThrow('读取失败');
  expect(RNFS.unlink).toHaveBeenCalledWith('/cache/challenge-cropped.png');
  jest.clearAllMocks();
  await expect(
    buildChallengePdfs(analysis, paper, ['https://example.com/page.jpg']),
  ).rejects.toThrow('本机');
  expect(ImageEditor.cropImage).not.toHaveBeenCalled();
  expect(RNFS.readFile).not.toHaveBeenCalled();
});

test('裁图模块若返回原文件则拒绝嵌入，且不删除原文件', async () => {
  const {analysis, paper} = withFigure();
  (ImageEditor.cropImage as jest.Mock).mockResolvedValue({
    uri: 'file:///documents/page.jpg',
  });
  await expect(
    buildChallengePdfs(analysis, paper, ['file:///documents/page.jpg']),
  ).rejects.toThrow('独立图片');
  expect(RNFS.unlink).not.toHaveBeenCalled();
  expect(RNFS.readFile).not.toHaveBeenCalled();
});

test('矢量重建可替代带作答标记的图，保留四种几何元素及无法支持字符的可见编号', async () => {
  const {analysis, paper} = fixture();
  paper.figures = [
    {
      id: 'f1',
      kind: 'drawing',
      caption: '重建图',
      width: 200,
      height: 100,
      elements: [
        {kind: 'line', x1: 10, y1: 10, x2: 100, y2: 80},
        {kind: 'circle', x: 130, y: 40, radius: 15},
        {kind: 'rect', x: 20, y: 30, width: 40, height: 20},
        {kind: 'text', x: 5, y: 80, text: 'A点🙂'},
      ],
    },
  ];
  paper.questions[0].figureIds = ['f1'];
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const circle = jest.spyOn(PDFPage.prototype, 'drawCircle');
  const result = await buildChallengePdfs(analysis, paper, []);
  expect(circle).toHaveBeenCalledTimes(1);
  expect(textFor(draw, '· 试卷')).toContain('A点[U+1F642]');
  expect(
    (
      await PDFDocument.load(Buffer.from(result.paperBase64, 'base64'))
    ).getPageCount(),
  ).toBeGreaterThan(0);
  expect(ImageEditor.cropImage).not.toHaveBeenCalled();
});

test.each(['DO_NOT_PUBLISH_GUESSED_KEY', ''])(
  '缺少音频时答案卷明确待核且不显示候选中的猜测答案：%s',
  async pendingAnswer => {
    const {analysis, paper} = fixture();
    analysis.subject = paper.subject = 'english';
    analysis.subjectLabel = '英语';
    paper.questions[0].isListening = true;
    paper.answers[0] = {
      questionId: 'q1',
      status: 'requires_audio',
      answer: pendingAnswer,
      explanation: '本次未提供原录音，需要另行核验。',
      scoringPoints: [],
    };
    const draw = jest.spyOn(PDFPage.prototype, 'drawText');
    await buildChallengePdfs(analysis, paper, []);
    expect(textFor(draw, '· 试卷')).toContain('请配合原卷录音作答');
    expect(textFor(draw, '· 答案与解析')).toContain('听力答案待核');
    expect(textFor(draw, '· 答案与解析')).not.toContain(
      'DO_NOT_PUBLISH_GUESSED_KEY',
    );
  },
);

test('异常题不得伪称升档，题号顺序失配、答案重复或缺图时不输出伪完整试卷', async () => {
  const unresolved = fixture();
  unresolved.analysis.unresolvedIssues = ['图中文字不清'];
  await expect(
    buildChallengePdfs(unresolved.analysis, unresolved.paper, []),
  ).rejects.toThrow('解析异常题必须原样保留');
  const swapped = fixture();
  swapped.paper.questions.reverse();
  await expect(
    buildChallengePdfs(swapped.analysis, swapped.paper, []),
  ).rejects.toThrow('题号、顺序');
  const missing = fixture();
  missing.paper.answers[1] = missing.paper.answers[0];
  await expect(
    buildChallengePdfs(missing.analysis, missing.paper, []),
  ).rejects.toThrow('答案对应');
  const absentFigure = fixture();
  absentFigure.paper.questions[0].figureIds = ['absent'];
  await expect(
    buildChallengePdfs(absentFigure.analysis, absentFigure.paper, []),
  ).rejects.toThrow('缺少题目引用的图示');
});

test('题干与选项不完整时按原题顺序嵌入原图片段，答案明确待核，仍导出两份PDF', async () => {
  const {analysis, paper} = fixture();
  analysis.questions[0].stem = '';
  analysis.questions[0].options = [];
  analysis.questions[0].analysisIssues = ['题干与选项识别不完整'];
  analysis.questions[0].originalRegions = [
    {pageIndex: 0, box: {x: 0.1, y: 0.2, width: 0.8, height: 0.3}},
  ];
  analysis.unresolvedIssues = ['第1题部分公式辨认不清'];
  const prepared = prepareRetainedAnalysis(analysis);
  const candidate = preserveRequiredOriginals(
    paper,
    prepared,
    2,
  ) as ChallengePaper;
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const image = jest.spyOn(PDFPage.prototype, 'drawImage');
  const result = await buildChallengePdfs(prepared, candidate, [
    'file:///original.png',
  ]);
  const body = textFor(draw, '· 试卷');
  expect(body.indexOf(analysis.materials[0].text)).toBeLessThan(
    body.indexOf('第 1 题 · 原题保留（原图）'),
  );
  expect(body.indexOf('第 1 题 · 原题保留（原图）')).toBeGreaterThanOrEqual(0);
  expect(body.indexOf('第 1 题 · 原题保留（原图）')).toBeLessThan(
    body.indexOf('第 2(1) 题'),
  );
  expect(ImageEditor.cropImage).toHaveBeenCalledWith(
    'file:///original.png',
    expect.objectContaining({
      offset: {x: 200, y: 200},
      size: {width: 1600, height: 300},
    }),
  );
  expect(image).toHaveBeenCalledTimes(1);
  expect(textFor(draw, '· 答案与解析')).toContain('原题保留，参考答案待核');
  expect(textFor(draw, '· 答案与解析')).not.toContain('ANSWER_ONLY_SECRET');
  for (const base64 of [result.paperBase64, result.answersBase64]) {
    expect(
      (await PDFDocument.load(Buffer.from(base64, 'base64'))).getPageCount(),
    ).toBeGreaterThan(0);
  }
});

test('原图保留题的共用材料先于题目，题框外带笔迹的材料图也按原图保留', async () => {
  const {analysis, paper} = fixture();
  analysis.questions[0].analysisIssues = ['题干辨认不完整'];
  analysis.questions[0].originalRegions = [
    {pageIndex: 0, box: {x: 0.1, y: 0.7, width: 0.8, height: 0.2}},
  ];
  const originalFigure = {...cleanFigure, containsStudentMarks: true};
  analysis.figures = [originalFigure];
  paper.figures = [originalFigure];
  analysis.materials[0].figureIds = ['f1'];
  paper.questions[1].materialIds = [];
  analysis.questions[1].materialIds = [];
  const prepared = prepareRetainedAnalysis(analysis);
  const candidate = preserveRequiredOriginals(
    paper,
    prepared,
    2,
  ) as ChallengePaper;
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  await buildChallengePdfs(prepared, candidate, ['file:///original.png']);
  const body = textFor(draw, '· 试卷');
  expect(body.indexOf(analysis.materials[0].text)).toBeLessThan(
    body.indexOf('第 1 题 · 原题保留（原图）'),
  );
  expect(ImageEditor.cropImage).toHaveBeenCalledTimes(2);
  expect(ImageEditor.cropImage).toHaveBeenLastCalledWith(
    'file:///original.png',
    expect.objectContaining({
      offset: {x: 400, y: 200},
      size: {width: 800, height: 400},
    }),
  );
});

test('原样保留的题面进入试卷PDF，存疑答案在答案PDF明确待核，不猜答案', async () => {
  const {analysis, paper} = fixture();
  paper.questions[0] = {
    ...paper.questions[0],
    stem: analysis.questions[0].stem,
    upgrade: {
      mode: 'retained',
      retentionReason: '原题条件可复现，参考解法尚需核验。',
      level: 1,
      metrics: {},
      changes: [],
      pitfalls: [],
      scopeExplanation: '原题保留。',
    },
  };
  paper.answers[0] = {
    ...paper.answers[0],
    status: 'requires_review',
    answer: '',
    explanation: '参考答案待核：请核实本题实际条件与推理边界。',
    scoringPoints: [],
  };
  const draw = jest.spyOn(PDFPage.prototype, 'drawText');
  const result = await buildChallengePdfs(analysis, paper, []);
  expect(textFor(draw, '· 答案与解析', 12)).toContain(
    '原题保留，参考答案待核。',
  );
  expect(textFor(draw, '· 答案与解析', 11)).toContain(
    '请核实本题实际条件与推理边界',
  );
  expect(
    (
      await PDFDocument.load(Buffer.from(result.paperBase64, 'base64'))
    ).getPageCount(),
  ).toBeGreaterThan(0);
  expect(
    (
      await PDFDocument.load(Buffer.from(result.answersBase64, 'base64'))
    ).getPageCount(),
  ).toBeGreaterThan(0);
});
