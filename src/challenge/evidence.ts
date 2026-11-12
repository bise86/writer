import type {
  ChallengeFigure,
  ChallengePaper,
  ExamAnalysis,
  PaperMaterial,
  PaperQuestion,
} from './types';

type Data = Record<string, any>;
export type EvidenceOrigin = 'original' | 'problem' | 'solution';
export interface EvidenceSource {
  id: string;
  field: string;
  text: string;
}
export interface EvidenceQuoteIssue {
  questionId: string;
  questionNumber: string;
  path: string;
  origin: EvidenceOrigin;
  value: unknown;
  sources: EvidenceSource[];
  context: Data;
}
interface QuoteBinding extends EvidenceQuoteIssue {
  owner: Data;
  key: string;
}
const object = (value: unknown): value is Data =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim();
const meaningful = (value: unknown): value is string =>
  text(value) && /[\p{L}\p{N}+\-*/=<>≤≥≠^%]/u.test(value);

function problemSources(
  question: Data,
  materials: PaperMaterial[],
  materialIds: string[],
  figures: ChallengeFigure[],
  figureIds: string[],
  origin: 'original' | 'problem',
): EvidenceSource[] {
  const sources: {id: string; field: string; text: unknown}[] = [
    {id: `${origin}:stem`, field: `${origin}.stem`, text: question.stem},
    ...(Array.isArray(question.options)
      ? question.options.filter(object).map((option: Data, index: number) => ({
          id: `${origin}:option:${index}`,
          field: `${origin}.options[${index}].text`,
          text: option.text,
        }))
      : []),
    ...materials
      .filter(material => object(material) && materialIds.includes(material.id))
      .flatMap(material => [
        {
          id: `${origin}:material:${material.id}:title`,
          field: `${origin}.materials[${material.id}].title`,
          text: material.title,
        },
        {
          id: `${origin}:material:${material.id}:text`,
          field: `${origin}.materials[${material.id}].text`,
          text: material.text,
        },
      ]),
    ...figures
      .filter(figure => object(figure) && figureIds.includes(figure.id))
      .map(figure => ({
        id: `${origin}:figure:${figure.id}:caption`,
        field: `${origin}.figures[${figure.id}].caption`,
        text: figure.caption,
      })),
  ];
  return sources.filter((source): source is EvidenceSource =>
    text(source.text),
  );
}

/** The same, question-local source set is used by validation and quote repair.
 * Neither the bare answer nor learningGuide/upgrade metadata is evidence. */
export function questionEvidenceSources(
  source: PaperQuestion,
  generated: Data,
  analysis: ExamAnalysis,
  materials: PaperMaterial[],
  figures: ChallengeFigure[],
  answer?: Data,
): Record<EvidenceOrigin, EvidenceSource[]> {
  const figureIds = [
    ...new Set([
      ...source.figureIds,
      ...analysis.materials
        .filter(material => source.materialIds.includes(material.id))
        .flatMap(material => material.figureIds),
    ]),
  ];
  return {
    original: problemSources(
      source,
      analysis.materials,
      source.materialIds,
      analysis.figures,
      figureIds,
      'original',
    ),
    problem: problemSources(
      generated,
      materials,
      source.materialIds,
      figures,
      figureIds,
      'problem',
    ),
    solution: [
      {
        id: 'solution:explanation',
        field: 'answer.explanation',
        text: answer?.explanation,
      },
      ...(Array.isArray(answer?.scoringPoints)
        ? answer!.scoringPoints.map((point: unknown, index: number) => ({
            id: `solution:scoringPoint:${index}`,
            field: `answer.scoringPoints[${index}]`,
            text: point,
          }))
        : []),
    ].filter((entry): entry is EvidenceSource => text(entry.text)),
  };
}

/** Fold layout whitespace only, with an offset map back to the untouched text.
 * Keep Latin/digit word boundaries, case, every symbol and exponent unchanged. */
function layoutText(value: string) {
  let normalized = '';
  const offsets: {start: number; end: number}[] = [];
  const adjacent =
    /[\u3400-\u9fff\uf900-\ufaff，。；：、（）【】《》,.!?:;()[\]{}=+\-*/^<>≤≥≠%]/u;
  const tokens = [...value.matchAll(/\s+|[^\s]/gu)];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const start = token.index!;
    const end = start + token[0].length;
    let part = token[0];
    if (/^\s+$/u.test(part)) {
      if (
        !index ||
        index === tokens.length - 1 ||
        adjacent.test(tokens[index - 1][0]) ||
        adjacent.test(tokens[index + 1][0])
      ) {
        continue;
      }
      part = ' ';
    }
    normalized += part;
    for (let offset = 0; offset < part.length; offset += 1) {
      offsets.push({start, end});
    }
  }
  return {text: normalized, offsets};
}

function tokenCharacter(value: string): boolean {
  return (
    /[\p{L}\p{N}\p{M}_]/u.test(value) &&
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      value,
    )
  );
}

/** A real substring must not change a number or word by cutting its token.
 * Chinese clauses may meet a formula directly, e.g. 满足x>0且x≤2. */
function boundedSpan(value: string, start: number, end: number): boolean {
  const body = value.slice(start, end);
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  start += body.length - body.trimStart().length;
  end -= body.length - body.trimEnd().length;
  const first = [...trimmed][0];
  const last = [...trimmed].pop()!;
  const before = [...value.slice(Math.max(0, start - 2), start)].pop() || '';
  const after = [...value.slice(end, end + 2)][0] || '';
  if (
    (tokenCharacter(first) && tokenCharacter(before)) ||
    (tokenCharacter(last) && tokenCharacter(after))
  ) {
    return false;
  }
  // Keep apostrophes/hyphens within English words, including can't/non-zero.
  const joiner = /^[\u0027\u2018\u2019-]$/u;
  if (
    (tokenCharacter(first) &&
      joiner.test(before) &&
      tokenCharacter([...value.slice(0, start - before.length)].pop() || '')) ||
    (tokenCharacter(last) &&
      joiner.test(after) &&
      tokenCharacter([...value.slice(end + after.length)][0] || ''))
  ) {
    return false;
  }
  const prefix = value.slice(0, start).trimEnd();
  const suffix = value.slice(end).trimStart();
  if (
    (tokenCharacter(first) && /[+\-−±∓√∛∜]$/u.test(prefix)) ||
    (tokenCharacter(last) &&
      /^(?:\^|[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉])/u.test(suffix))
  ) {
    return false;
  }
  if (/\p{N}/u.test(first) && /[.,]$/u.test(prefix)) {
    return false;
  }
  if (
    /\p{N}/u.test(last) &&
    (/^[.,]\s*\p{N}/u.test(suffix) || /^[%‰°]/u.test(suffix))
  ) {
    return false;
  }
  return true;
}

function literalSpan(value: string, quote: string): number | undefined {
  let start = value.indexOf(quote);
  while (start >= 0) {
    if (boundedSpan(value, start, start + quote.length)) {
      return start;
    }
    start = value.indexOf(quote, start + 1);
  }
  return undefined;
}

export function exactEvidenceQuote(
  value: unknown,
  sources: EvidenceSource[],
): boolean {
  return (
    meaningful(value) &&
    sources.some(source => literalSpan(source.text, value) !== undefined)
  );
}

/** Return a real contiguous source span, never a paraphrase or fuzzy match. */
export function canonicalEvidenceQuote(
  value: unknown,
  sources: EvidenceSource[],
): string | undefined {
  if (!meaningful(value)) {
    return undefined;
  }
  if (exactEvidenceQuote(value, sources)) {
    return value;
  }
  const variants = [value.trim()];
  const pairs: Record<string, string> = {
    '“': '”',
    '「': '」',
    '『': '』',
    '"': '"',
    "'": "'",
  };
  const trimmed = value.trim();
  if (pairs[trimmed[0]] === trimmed[trimmed.length - 1] && trimmed.length > 2) {
    variants.push(trimmed.slice(1, -1).trim());
  }
  for (const variant of variants) {
    if (!meaningful(variant)) {
      continue;
    }
    for (const source of sources) {
      if (literalSpan(source.text, variant) !== undefined) {
        return variant;
      }
      const needle = layoutText(variant).text;
      const haystack = layoutText(source.text);
      if (needle) {
        let offset = haystack.text.indexOf(needle);
        while (offset >= 0) {
          const start = haystack.offsets[offset].start;
          const end = haystack.offsets[offset + needle.length - 1].end;
          if (
            boundedSpan(haystack.text, offset, offset + needle.length) &&
            boundedSpan(source.text, start, end)
          ) {
            return source.text.slice(start, end);
          }
          offset = haystack.text.indexOf(needle, offset + 1);
        }
      }
    }
  }
  return undefined;
}

function bindings(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  ids?: readonly string[],
): QuoteBinding[] {
  if (!Array.isArray(paper.questions) || !Array.isArray(paper.answers)) {
    return [];
  }
  const result: QuoteBinding[] = [];
  for (const question of paper.questions) {
    if (
      !object(question) ||
      question.isListening ||
      question.upgrade?.mode === 'retained' ||
      (ids && !ids.includes(question.id))
    ) {
      continue;
    }
    const source = analysis.questions.find(item => item.id === question.id);
    if (!source) {
      continue;
    }
    const answer = paper.answers.find(
      item => object(item) && item.questionId === question.id,
    );
    const sources = questionEvidenceSources(
      source,
      question,
      analysis,
      Array.isArray(paper.materials) ? paper.materials : [],
      Array.isArray(paper.figures) ? paper.figures : [],
      answer,
    );
    const add = (
      owner: Data,
      key: string,
      path: string,
      origin: EvidenceOrigin,
    ) => {
      const context = Object.fromEntries(
        Object.entries(owner).filter(
          ([name, value]) =>
            !name.endsWith('Quote') && !Array.isArray(value) && !object(value),
        ),
      );
      result.push({
        questionId: source.id,
        questionNumber: source.number,
        path,
        origin,
        value: owner[key],
        sources: sources[origin],
        context,
        owner,
        key,
      });
    };
    const items = (
      value: unknown,
      visit: (item: Data, index: number) => void,
    ) => {
      if (Array.isArray(value)) {
        value.forEach((item: unknown, index: number) => {
          if (object(item)) {
            visit(item, index);
          }
        });
      }
    };
    if (object(question.upgrade)) {
      for (const list of ['directionEvidence', 'depthChecks'] as const) {
        items(question.upgrade[list], (item, index) => {
          add(
            item,
            'problemQuote',
            `upgrade.${list}[${index}].problemQuote`,
            'problem',
          );
          add(
            item,
            'solutionQuote',
            `upgrade.${list}[${index}].solutionQuote`,
            'solution',
          );
        });
      }
      items(question.upgrade.directionConnections, (item, index) =>
        add(
          item,
          'solutionQuote',
          `upgrade.directionConnections[${index}].solutionQuote`,
          'solution',
        ),
      );
    }
    if (!object(answer)) {
      continue;
    }
    items(answer.learningGuide, (guide, index) => {
      const path = `answer.learningGuide[${index}]`;
      add(guide, 'problemQuote', `${path}.problemQuote`, 'problem');
      add(guide, 'solutionQuote', `${path}.solutionQuote`, 'solution');
      items(guide.misconceptions, (item, child) => {
        if (item.challengeId === 'source_specific') {
          add(
            item,
            'sourceQuote',
            `${path}.misconceptions[${child}].sourceQuote`,
            'original',
          );
        }
        add(
          item,
          'solutionQuote',
          `${path}.misconceptions[${child}].solutionQuote`,
          'solution',
        );
      });
      items(guide.transferLinks, (item, child) => {
        add(
          item,
          'sourceQuote',
          `${path}.transferLinks[${child}].sourceQuote`,
          'original',
        );
        add(
          item,
          'problemQuote',
          `${path}.transferLinks[${child}].problemQuote`,
          'problem',
        );
        add(
          item,
          'solutionQuote',
          `${path}.transferLinks[${child}].solutionQuote`,
          'solution',
        );
      });
      items(guide.selfChecks, (item, child) =>
        add(
          item,
          'solutionQuote',
          `${path}.selfChecks[${child}].solutionQuote`,
          'solution',
        ),
      );
    });
  }
  return result;
}

export function canonicalizePaperEvidence(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  ids?: readonly string[],
): ChallengePaper {
  const copy = JSON.parse(JSON.stringify(paper)) as ChallengePaper;
  for (const binding of bindings(copy, analysis, ids)) {
    const canonical = canonicalEvidenceQuote(binding.value, binding.sources);
    if (canonical !== undefined) {
      binding.owner[binding.key] = canonical;
    }
  }
  return copy;
}

export function invalidEvidenceQuotes(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  ids?: readonly string[],
): EvidenceQuoteIssue[] {
  return bindings(paper, analysis, ids)
    .filter(binding => !exactEvidenceQuote(binding.value, binding.sources))
    .map(({owner: _owner, key: _key, ...issue}) => issue);
}

/** Apply a whitelist of quote-only edits against immutable, question-local sources. */
export function applyEvidenceQuoteRepairs(
  paper: ChallengePaper,
  analysis: ExamAnalysis,
  targets: EvidenceQuoteIssue[],
  value: unknown,
): ChallengePaper {
  const invalid = (message: string): never => {
    throw new Error(`引文修复未通过：${message}`);
  };
  if (
    !object(value) ||
    !Array.isArray(value.fixes) ||
    value.fixes.length > targets.length ||
    Object.keys(value).some(key => !['fixes', 'unresolved'].includes(key))
  ) {
    return invalid(
      '只能返回fixes和unresolved，不得改写题干、答案解析或学习说明正文',
    );
  }
  const copy = JSON.parse(JSON.stringify(paper)) as ChallengePaper;
  const available = bindings(copy, analysis);
  const seen = new Set<string>();
  for (const fix of value.fixes) {
    if (
      !object(fix) ||
      Object.keys(fix).some(
        key => !['questionId', 'path', 'sourceId', 'quote'].includes(key),
      )
    ) {
      return invalid('每项只能修改指定引文字段');
    }
    const key = JSON.stringify([fix.questionId, fix.path]);
    const target = targets.find(
      item => item.questionId === fix.questionId && item.path === fix.path,
    );
    const binding = available.find(
      item => item.questionId === fix.questionId && item.path === fix.path,
    );
    const source = target?.sources.find(item => item.id === fix.sourceId);
    if (!target || !binding || !source || seen.has(key)) {
      return invalid('不得更换题号、引文类别、字段或使用别题的证据');
    }
    const quote = canonicalEvidenceQuote(fix.quote, [source]);
    if (quote === undefined) {
      return invalid(
        `第${target.questionNumber}题 ${target.path}必须来自${source.field}的真实连续原句，不能捏造或引用学习说明`,
      );
    }
    binding.owner[binding.key] = quote;
    seen.add(key);
  }
  if (
    value.unresolved !== undefined &&
    (!Array.isArray(value.unresolved) ||
      value.unresolved.length > targets.length ||
      value.unresolved.some(
        (item: unknown) =>
          !object(item) ||
          !text(item.reason) ||
          !targets.some(
            target =>
              target.questionId === item.questionId &&
              target.path === item.path,
          ),
      ))
  ) {
    return invalid('无法修复时只列出指定题号、字段与真实原因');
  }
  return copy;
}
