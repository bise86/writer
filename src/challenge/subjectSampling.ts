import {
  ExamAnalysis,
  MajorQuestion,
  PaperMaterial,
  PaperSection,
  SourceFigure,
  SourceQuestion,
  SubjectEvidence,
  SubjectVerification,
  SubjectSampleVote,
} from './types';

type SamplingAnalysis = Pick<
  ExamAnalysis,
  | 'title'
  | 'titleEvidence'
  | 'majorQuestions'
  | 'questions'
  | 'materials'
  | 'figures'
  | 'sections'
>;

type SampleQuestion = Pick<
  SourceQuestion,
  'id' | 'number' | 'type' | 'stem' | 'options' | 'sourceRefs'
>;

export interface SubjectVerificationSampleInput {
  contextIssue?: string;
  majorQuestionId: string;
  majorQuestionTitle: string;
  majorQuestionSourceRefs: SubjectEvidence[];
  section: Pick<PaperSection, 'id' | 'title' | 'instructions'>;
  question: SampleQuestion;
  dependencyQuestions: SampleQuestion[];
  dependencyContexts: {
    majorQuestionId: string;
    majorQuestionTitle: string;
    sourceRefs: SubjectEvidence[];
  }[];
  sourceLinks: {
    questionId: string;
    materialIds: string[];
    figureIds: string[];
  }[];
  materials: PaperMaterial[];
  figures: SourceFigure[];
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}

function validEvidence(value: unknown): value is SubjectEvidence {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const evidence = value as SubjectEvidence;
  return (
    Number.isInteger(evidence.pageIndex) &&
    evidence.pageIndex >= 0 &&
    nonempty(evidence.quote)
  );
}

function completeEvidence(value: unknown): value is SubjectEvidence[] {
  return Array.isArray(value) && value.length > 0 && value.every(validEvidence);
}

function copyEvidence(refs: SubjectEvidence[]): SubjectEvidence[] {
  return refs.map(({pageIndex, quote}) => ({pageIndex, quote}));
}

function questionHierarchy(analysis: SamplingAnalysis) {
  const reasons = new Set<string>();
  const majors = Array.isArray(analysis.majorQuestions)
    ? analysis.majorQuestions
    : [];
  const questions = Array.isArray(analysis.questions) ? analysis.questions : [];
  const majorIds = new Set<string>();
  const questionIds = new Set<string>();
  const groups: {major: MajorQuestion; candidates: SourceQuestion[]}[] = [];
  if (!majors.length) {
    reasons.add('原卷缺少完整大题层级');
  }
  if (!questions.length) {
    reasons.add('原卷缺少可抽样的叶子小题');
  }
  for (const major of majors) {
    if (
      !major ||
      !nonempty(major.id) ||
      !nonempty(major.title) ||
      !completeEvidence(major.sourceRefs) ||
      majorIds.has(major.id)
    ) {
      reasons.add('大题标识、标题或原题证据不完整或重复');
      continue;
    }
    majorIds.add(major.id);
    groups.push({major, candidates: []});
  }
  const byMajor = new Map(groups.map(group => [group.major.id, group]));
  for (const question of questions) {
    if (
      !question ||
      !nonempty(question.id) ||
      !nonempty(question.number) ||
      !completeEvidence(question.sourceRefs) ||
      questionIds.has(question.id)
    ) {
      reasons.add('叶子小题标识、题号或原题证据不完整或重复');
      continue;
    }
    questionIds.add(question.id);
    const group = nonempty(question.majorQuestionId)
      ? byMajor.get(question.majorQuestionId)
      : undefined;
    if (!group) {
      reasons.add('叶子小题缺少可核实的大题归属');
      continue;
    }
    group.candidates.push(question);
  }
  if (groups.some(group => !group.candidates.length)) {
    reasons.add('存在没有叶子小题的大题');
  }
  return {groups, reasons};
}

/** Choose once per run; callers retain this record through retries and expansion. */
export function buildSubjectVerification(
  analysis: SamplingAnalysis,
  random: () => number = Math.random,
): SubjectVerification {
  const {groups, reasons} = questionHierarchy(analysis);
  const titleEvidence = Array.isArray(analysis.titleEvidence)
    ? copyEvidence(analysis.titleEvidence.filter(validEvidence))
    : [];
  if (!nonempty(analysis.title) || !completeEvidence(analysis.titleEvidence)) {
    reasons.add('原卷缺少可核实标题或完整标题证据');
  }
  if (reasons.size) {
    return {
      mode: 'expanded',
      titleEvidence,
      samples: [],
      expansionReason: `${[...reasons].join('；')}，须扩大全卷核验科目`,
    };
  }
  return {
    mode: 'title_sample',
    titleEvidence,
    samples: groups.map(({major, candidates}) => {
      const draw = random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
        throw new RangeError('科目抽样随机值必须是[0,1)内的有限数');
      }
      const selected = candidates[Math.floor(draw * candidates.length)];
      return {
        majorQuestionId: major.id,
        majorQuestionTitle: major.title,
        candidateQuestionIds: candidates.map(question => question.id),
        selectedQuestionId: selected.id,
        selectedQuestionNumber: selected.number,
        sourceRefs: copyEvidence(selected.sourceRefs),
      };
    }),
  };
}

function referencedItems<T extends {id: string}>(
  items: T[],
  ids: string[],
  label: string,
): T[] {
  if (!Array.isArray(items) || !Array.isArray(ids) || !ids.every(nonempty)) {
    throw new Error(`抽中原题的${label}引用不完整`);
  }
  const required = new Set(ids);
  const selected = items.filter(item => item && required.has(item.id));
  if (
    selected.length !== required.size ||
    new Set(selected.map(item => item.id)).size !== required.size
  ) {
    throw new Error(`抽中原题的${label}缺失或标识重复，不能省略原题依赖`);
  }
  return selected;
}

function copyQuestion(question: SourceQuestion): SampleQuestion {
  return {
    id: question.id,
    number: question.number,
    type: question.type,
    stem: question.stem,
    options: question.options.map(({label, text}) => ({label, text})),
    sourceRefs: copyEvidence(question.sourceRefs),
  };
}

function questionDependencies(
  selected: SourceQuestion,
  questions: SourceQuestion[],
): SourceQuestion[] {
  const byId = new Map(questions.map(question => [question.id, question]));
  const active = new Set<string>();
  const visited = new Set<string>();
  const dependencies = new Set<string>();
  const previousResult =
    /(?:由|根据|利用|结合|沿用|依据)\s*(?:第\s*)?(?:[（(]\s*[\d一二三四五六七八九十]+\s*[)）]|[①-⑳]|\d+\s*问)|前(?:一)?(?:小)?问|上一(?:小)?问|上(?:一)?题(?:的)?(?:结果|结论)|上述(?:结果|结论)|以上(?:结果|结论)/u;
  const visit = (question: SourceQuestion) => {
    if (active.has(question.id)) {
      throw new Error('抽中原题存在循环前问依赖，须保留抽样记录扩大全卷核验');
    }
    if (visited.has(question.id)) {
      return;
    }
    const ids =
      question.dependsOnQuestionIds === undefined
        ? []
        : question.dependsOnQuestionIds;
    if (
      !Array.isArray(ids) ||
      !ids.every(nonempty) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error('抽中原题的前问依赖记录不完整，须扩大全卷核验');
    }
    if (
      !ids.length &&
      (previousResult.test(question.stem) ||
        previousResult.test(question.stem.normalize('NFKC')))
    ) {
      throw new Error(
        '题干引用前问或上述结果但缺少可定位的前问依赖，须保留抽样记录扩大全卷核验',
      );
    }
    active.add(question.id);
    for (const id of ids) {
      const dependency = byId.get(id);
      if (!dependency) {
        throw new Error('抽中原题缺少前问原题，须保留抽样记录扩大全卷核验');
      }
      visit(dependency);
      dependencies.add(id);
    }
    active.delete(question.id);
    visited.add(question.id);
  };
  visit(selected);
  return questions.filter(question => dependencies.has(question.id));
}

/** Only selected original questions and their dependencies enter identification. */
export function subjectVerificationSamples(
  analysis: SamplingAnalysis,
  verification: SubjectVerification,
): SubjectVerificationSampleInput[] {
  if (verification.mode === 'progressive') {
    return progressiveSampleInputs(analysis, verification);
  }
  if (
    verification.mode !== 'title_sample' &&
    verification.mode !== 'expanded'
  ) {
    throw new Error('科目核验模式不明确');
  }
  if (!Array.isArray(verification.samples)) {
    throw new Error('科目抽样记录不完整');
  }
  if (verification.mode === 'expanded' && !verification.samples.length) {
    return [];
  }
  const {groups, reasons} = questionHierarchy(analysis);
  if (reasons.size || verification.samples.length !== groups.length) {
    throw new Error('科目抽样记录与原卷大题层级不一致，须扩大全卷核验');
  }
  return groups.map(({major, candidates}, index) => {
    const sample = verification.samples[index];
    const selected = candidates.find(
      question => question.id === sample?.selectedQuestionId,
    );
    if (
      !selected ||
      sample.majorQuestionId !== major.id ||
      sample.majorQuestionTitle !== major.title ||
      sample.selectedQuestionNumber !== selected.number ||
      !Array.isArray(sample.candidateQuestionIds) ||
      sample.candidateQuestionIds.length !== candidates.length ||
      sample.candidateQuestionIds.some((id, i) => id !== candidates[i].id) ||
      !completeEvidence(sample.sourceRefs) ||
      JSON.stringify(copyEvidence(sample.sourceRefs)) !==
        JSON.stringify(copyEvidence(selected.sourceRefs))
    ) {
      throw new Error('科目抽样记录已改变或不属于原大题，不能换题作为随机佐证');
    }
    const dependencies = questionDependencies(selected, analysis.questions);
    const section = referencedItems(
      analysis.sections,
      [selected.sectionId],
      '作答说明所属题组',
    )[0];
    const sourceQuestions = [selected, ...dependencies];
    const materials = referencedItems(
      analysis.materials,
      sourceQuestions.flatMap(question => question.materialIds),
      '共用材料',
    );
    const figures = referencedItems(
      analysis.figures,
      [
        ...sourceQuestions.flatMap(question => question.figureIds),
        ...materials.flatMap(material => material.figureIds),
      ],
      '图表',
    );
    return {
      majorQuestionId: major.id,
      majorQuestionTitle: major.title,
      majorQuestionSourceRefs: copyEvidence(major.sourceRefs),
      section: {
        id: section.id,
        title: section.title,
        instructions: section.instructions,
      },
      question: copyQuestion(selected),
      dependencyQuestions: dependencies.map(copyQuestion),
      sourceLinks: sourceQuestions.map(question => ({
        questionId: question.id,
        materialIds: [...question.materialIds],
        figureIds: [...question.figureIds],
      })),
      dependencyContexts: groups
        .filter(
          group =>
            group.major.id !== major.id &&
            dependencies.some(
              question => question.majorQuestionId === group.major.id,
            ),
        )
        .map(group => ({
          majorQuestionId: group.major.id,
          majorQuestionTitle: group.major.title,
          sourceRefs: copyEvidence(group.major.sourceRefs),
        })),
      materials: materials.map(material => ({
        id: material.id,
        title: material.title,
        text: material.text,
        isListening: material.isListening,
        figureIds: [...material.figureIds],
      })),
      figures: figures.map(figure => ({
        id: figure.id,
        kind: figure.kind,
        pageIndex: figure.pageIndex,
        box: {
          x: figure.box.x,
          y: figure.box.y,
          width: figure.box.width,
          height: figure.box.height,
        },
        caption: figure.caption,
        containsStudentMarks: figure.containsStudentMarks,
      })),
    };
  });
}

function progressiveSample(analysis: SamplingAnalysis, id: string) {
  const question = analysis.questions.find(item => item.id === id);
  if (!question || !completeEvidence(question.sourceRefs)) {
    throw new Error('递进抽样题号或原题证据不完整');
  }
  const major = analysis.majorQuestions?.find(
    item => item.id === question.majorQuestionId,
  );
  const section = analysis.sections.find(
    item => item.id === question.sectionId,
  );
  const candidates = analysis.questions.filter(item =>
    major
      ? item.majorQuestionId === major.id
      : item.sectionId === question.sectionId,
  );
  return {
    majorQuestionId: major?.id || question.sectionId,
    majorQuestionTitle: major?.title || section?.title || '原卷题组',
    candidateQuestionIds: candidates.map(item => item.id),
    selectedQuestionId: question.id,
    selectedQuestionNumber: question.number,
    sourceRefs: copyEvidence(question.sourceRefs),
  };
}

/** Shuffle once, then reveal a fixed prefix: three first, one per later round. */
export function buildProgressiveSubjectVerification(
  analysis: SamplingAnalysis,
  random: () => number = Math.random,
): SubjectVerification {
  const order = analysis.questions.map(question => question.id);
  if (!order.length || new Set(order).size !== order.length) {
    throw new Error('原卷没有完整且不重复的抽样题池');
  }
  for (let index = order.length - 1; index > 0; index -= 1) {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new RangeError('科目抽样随机值必须是[0,1)内的有限数');
    }
    const swap = Math.floor(draw * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return {
    mode: 'progressive',
    candidateOrder: order,
    titleEvidence: (analysis.titleEvidence || [])
      .filter(validEvidence)
      .map(ref => ({...ref})),
    samples: order.slice(0, 3).map(id => progressiveSample(analysis, id)),
    votes: [],
  };
}

export function appendSubjectSample(
  analysis: SamplingAnalysis,
  verification: SubjectVerification,
): SubjectVerification {
  progressiveSampleInputs(analysis, verification);
  const next = verification.candidateOrder?.[verification.samples.length];
  if (!next) {
    throw new Error('抽样题池已耗尽，仍未形成明确多数');
  }
  return {
    ...verification,
    samples: [...verification.samples, progressiveSample(analysis, next)],
  };
}

function progressiveSampleInputs(
  analysis: SamplingAnalysis,
  verification: SubjectVerification,
): SubjectVerificationSampleInput[] {
  const order = verification.candidateOrder;
  if (
    !order ||
    order.length !== analysis.questions.length ||
    new Set(order).size !== order.length ||
    order.some(
      id => !analysis.questions.some(question => question.id === id),
    ) ||
    verification.samples.length > order.length ||
    verification.samples.length < Math.min(3, order.length)
  ) {
    throw new Error('递进抽样的完整题池或已抽题数不一致，不能换题或缩小题池');
  }
  return verification.samples.map((sample, index) => {
    const expected = progressiveSample(analysis, order[index]);
    if (JSON.stringify(sample) !== JSON.stringify(expected)) {
      throw new Error('递进抽样题号、原锚或顺序被更换');
    }
    const question = analysis.questions.find(
      item => item.id === sample.selectedQuestionId,
    )!;
    const section = analysis.sections.find(
      item => item.id === question.sectionId,
    );
    const major = analysis.majorQuestions?.find(
      item => item.id === question.majorQuestionId,
    );
    const base = {
      majorQuestionId: sample.majorQuestionId,
      majorQuestionTitle: sample.majorQuestionTitle,
      majorQuestionSourceRefs: major?.sourceRefs || sample.sourceRefs,
      section: section || {
        id: question.sectionId,
        title: sample.majorQuestionTitle,
        instructions: '',
      },
      question: copyQuestion(question),
    };
    try {
      if (!section) {
        throw new Error('缺少题组作答说明');
      }
      const dependencies = questionDependencies(question, analysis.questions);
      const questions = [question, ...dependencies];
      const materials = referencedItems(
        analysis.materials,
        questions.flatMap(item => item.materialIds),
        '共用材料',
      );
      const figures = referencedItems(
        analysis.figures,
        [
          ...questions.flatMap(item => item.figureIds),
          ...materials.flatMap(item => item.figureIds),
        ],
        '图表',
      );
      return {
        ...base,
        dependencyQuestions: dependencies.map(copyQuestion),
        dependencyContexts: [],
        sourceLinks: questions.map(item => ({
          questionId: item.id,
          materialIds: [...item.materialIds],
          figureIds: [...item.figureIds],
        })),
        materials,
        figures,
      };
    } catch (error) {
      return {
        ...base,
        contextIssue: error instanceof Error ? error.message : String(error),
        dependencyQuestions: [],
        dependencyContexts: [],
        sourceLinks: [],
        materials: [],
        figures: [],
      };
    }
  });
}

export function subjectConsensus(verification: SubjectVerification) {
  const votes = verification.votes || [];
  if (
    verification.mode !== 'progressive' ||
    votes.length !== verification.samples.length ||
    !votes.length
  ) {
    return undefined;
  }
  const groups = new Map<string, SubjectSampleVote[]>();
  for (const vote of votes) {
    if (vote.subject === 'unknown') {
      continue;
    }
    const key = `${vote.subject}:${vote.integrated}:${
      vote.subject === 'other'
        ? vote.courseName.normalize('NFKC').replace(/\s+/gu, '')
        : ''
    }`;
    groups.set(key, [...(groups.get(key) || []), vote]);
  }
  const initial = Math.min(3, verification.candidateOrder?.length || 3);
  const winner = [...groups.values()].find(group =>
    votes.length === initial
      ? group.length === votes.length
      : group.length > votes.length / 2,
  );
  return winner
    ? {...winner[0], supportCount: winner.length, total: votes.length}
    : undefined;
}
