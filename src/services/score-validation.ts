import rules from '../assets/scoring-rules.json';
import {ScoreResult} from '../types';

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Reject incomplete/invalid model results; never manufacture a fallback grade. */
export function validateScore(
  result: ScoreResult,
  originalText: string,
): ScoreResult {
  const invalid = () =>
    new Error('模型评分结构或分数不符合评分细则，结果未保存，请重试');
  if (
    !result ||
    typeof result !== 'object' ||
    !Number.isFinite(result.score) ||
    !result.dimensionScores ||
    typeof result.dimensionScores !== 'object' ||
    typeof result.summary !== 'string' ||
    !result.summary.trim() ||
    ![
      result.strengths,
      result.weaknesses,
      result.improvements,
      result.suggestions,
    ].every(stringArray) ||
    !Array.isArray(result.annotations)
  ) {
    throw invalid();
  }
  let total = 0;
  for (const dimension of rules.dimensions) {
    const score = result.dimensionScores[dimension.id];
    if (!Number.isFinite(score) || score < 0 || score > dimension.max) {
      throw invalid();
    }
    total += score;
  }
  if (
    Math.abs(total - result.score) > 0.001 ||
    total < 0 ||
    total > rules.total
  ) {
    throw invalid();
  }
  const band = rules.bands.find(item => item.id === result.bandId);
  if (result.bandId === 'unqualified') {
    if (total >= rules.passingScore) {
      throw invalid();
    }
  } else if (
    !band ||
    total < band.min ||
    total > band.max ||
    Object.entries(band.floor).some(
      ([key, minimum]) => result.dimensionScores[key] < minimum,
    )
  ) {
    throw invalid();
  }
  const annotations = result.annotations.map(annotation => {
    if (
      !annotation ||
      typeof annotation.quote !== 'string' ||
      !annotation.quote.trim() ||
      typeof annotation.comment !== 'string' ||
      typeof annotation.suggestion !== 'string' ||
      !['strength', 'improvement', 'grammar', 'structure', 'style'].includes(
        annotation.type,
      )
    ) {
      throw invalid();
    }
    const index = originalText.indexOf(annotation.quote);
    if (index < 0) {
      throw new Error('模型批注引用了原文不存在的句子，结果未保存，请重试');
    }
    const supplied = annotation.start;
    const start =
      typeof supplied === 'number' &&
      Number.isInteger(supplied) &&
      supplied >= 0 &&
      originalText.slice(supplied, supplied + annotation.quote.length) ===
        annotation.quote
        ? supplied
        : index;
    return {...annotation, start, end: start + annotation.quote.length};
  });
  return {...result, annotations};
}
