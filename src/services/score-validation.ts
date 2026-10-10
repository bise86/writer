import {ScoreResult} from '../types';
import {essaySections, sectionLabel} from './essay-text';
import {getWritingRules} from './writing';

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(item => typeof item === 'string' && item.trim())
  );
}

export class ScoreValidationError extends Error {
  constructor(public issues: string[]) {
    super(`评分校验未通过：\n${issues.join('\n')}`);
  }
}

function validateFeedback(field: string, value: unknown, issues: string[]) {
  if (!isObject(value)) {
    issues.push(
      `${field} 缺失，必须包含 strengths、weaknesses、improvements 三个字符串数组`,
    );
    return;
  }
  for (const key of ['strengths', 'weaknesses', 'improvements']) {
    if (!stringArray(value[key])) {
      issues.push(`${field}.${key} 必须是字符串数组`);
    }
  }
  if (!Array.isArray(value.improvements) || !value.improvements.length) {
    issues.push(`${field}.improvements 至少提供一条可执行建议`);
  }
}

/** Reject incomplete results and return precise issues for the next model turn. */
export function validateScore(
  value: unknown,
  originalText: string,
  rules = getWritingRules('chinese'),
): ScoreResult {
  const issues: string[] = [];
  if (!isObject(value)) {
    throw new ScoreValidationError(['根节点必须是 JSON 对象']);
  }
  for (const key of ['summary']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) {
      issues.push(`${key} 必须是非空字符串`);
    }
  }
  for (const key of [
    'strengths',
    'weaknesses',
    'improvements',
    'suggestions',
  ]) {
    if (!stringArray(value[key])) {
      issues.push(`${key} 必须是字符串数组`);
    }
  }
  for (const key of ['improvements', 'suggestions']) {
    if (!Array.isArray(value[key]) || !value[key].length) {
      issues.push(`${key} 至少包含一条可执行建议`);
    }
  }

  let total = 0;
  for (const dimension of rules.dimensions) {
    const score = value.dimensionScores?.[dimension.id];
    if (!Number.isInteger(score) || score < 0 || score > dimension.max) {
      issues.push(
        `dimensionScores.${dimension.id} 必须是 0..${
          dimension.max
        } 的整数，收到 ${JSON.stringify(score)}`,
      );
    } else {
      total += score;
    }
    validateFeedback(
      `dimensionFeedback.${dimension.id}`,
      value.dimensionFeedback?.[dimension.id],
      issues,
    );
  }
  const adjusted = 'admissionPolicy' in rules.rules;
  const adjustment = adjusted ? value.admissionAdjustment ?? 0 : 0;
  if (
    adjusted &&
    (!Number.isInteger(adjustment) || adjustment < 0 || adjustment > total)
  ) {
    issues.push('admissionAdjustment 必须是 0..分项合计 的整数');
  }
  if (
    adjusted &&
    ((value.admissionReason !== undefined &&
      (typeof value.admissionReason !== 'string' || !value.admissionReason.trim())) ||
      (adjustment > 0 && value.admissionReason === undefined))
  ) {
    issues.push('admissionReason 必须说明准入封顶的具体门槛和原文证据');
  }
  if (
    !Number.isInteger(value.score) ||
    value.score < 0 ||
    value.score > 100 ||
    value.score !== total - adjustment ||
    total > 100
  ) {
    issues.push(
      `score 必须等于五项分数之和 ${total}${
        adjusted ? ` 减去准入调整 ${adjustment}` : ''
      }，收到 ${JSON.stringify(
        value.score,
      )}`,
    );
  }
  const band = rules.bands.find(item => item.id === value.bandId);
  if (value.bandId === 'unqualified') {
    if (value.score >= rules.passingScore) {
      issues.push('unqualified 只适用于总分低于 60');
    }
  } else if (!band) {
    issues.push(
      'bandId 只能为 pass、good、high、excellent、model 或 unqualified',
    );
  } else {
    if (value.score < band.min || value.score > band.max) {
      issues.push(
        `bandId=${band.id} 要求总分 ${band.min}..${band.max}，当前 ${value.score}`,
      );
    }
    for (const [key, minimum] of Object.entries(band.floor)) {
      if (value.dimensionScores?.[key] < minimum) {
        issues.push(
          `${band.id} 档要求 dimensionScores.${key} 至少 ${minimum}，请按实际表现重新定档`,
        );
      }
    }
  }
  if (
    adjusted &&
    adjustment > 0 &&
    value.score !==
      (value.bandId === 'unqualified' ? rules.passingScore - 1 : band?.max)
  ) {
    issues.push('有准入调整时，score 必须等于可入档上限，不得重复扣分');
  }

  const sections = essaySections(originalText);
  const paragraphs = sections.filter(section => section.kind === 'paragraph');
  if (sections.some(section => section.kind === 'title')) {
    validateFeedback(
      'titleFeedback（标题评价，不计入正文段落）',
      value.titleFeedback,
      issues,
    );
  }
  if (sections.some(section => section.kind === 'salutation')) {
    validateFeedback('salutationFeedback（称呼评价，不计入正文段落）', value.salutationFeedback, issues);
  }
  if (!Array.isArray(value.paragraphReviews)) {
    issues.push(
      'paragraphReviews 必须逐段输出 paragraphIndex、strengths、weaknesses、improvements',
    );
  } else {
    for (const paragraph of paragraphs) {
      const matches = value.paragraphReviews.filter(
        (item: any) => item?.paragraphIndex === paragraph.index,
      );
      if (matches.length !== 1) {
        issues.push(
          `paragraphReviews 必须恰好包含第 ${paragraph.index} 段的一份评价`,
        );
      } else {
        validateFeedback(
          `paragraphReviews[第${paragraph.index}段]`,
          matches[0],
          issues,
        );
      }
    }
    if (
      value.paragraphReviews.some(
        (item: any) =>
          !Number.isInteger(item?.paragraphIndex) ||
          item.paragraphIndex < 1 ||
          item.paragraphIndex > paragraphs.length,
      )
    ) {
      issues.push(`paragraphIndex 必须在 1..${paragraphs.length} 范围内`);
    }
  }

  const annotations: ScoreResult['annotations'] = [];
  if (!Array.isArray(value.annotations) || !value.annotations.length) {
    issues.push('annotations 至少包含一条引用原文的具体批注');
  } else {
    value.annotations.forEach((annotation: any, index: number) => {
      const path = `annotations[${index}]`;
      if (!isObject(annotation)) {
        issues.push(`${path} 必须是对象`);
        return;
      }
      for (const key of ['quote', 'comment', 'suggestion']) {
        if (typeof annotation[key] !== 'string' || !annotation[key].trim()) {
          issues.push(`${path}.${key} 必须是非空字符串`);
        }
      }
      if (
        !['strength', 'improvement', 'grammar', 'structure', 'style'].includes(
          annotation.type,
        )
      ) {
        issues.push(
          `${path}.type 必须为 strength|improvement|grammar|structure|style`,
        );
      }
      const quoteIndex =
        typeof annotation.quote === 'string'
          ? originalText.indexOf(annotation.quote)
          : -1;
      if (quoteIndex < 0) {
        issues.push(`${path}.quote 必须逐字引用原文中的连续文字`);
        return;
      }
      const hasValidStart =
        Number.isInteger(annotation.start) &&
        annotation.start >= 0 &&
        originalText.slice(
          annotation.start,
          annotation.start + annotation.quote.length,
        ) === annotation.quote;
      if (
        !hasValidStart &&
        originalText.indexOf(annotation.quote, quoteIndex + 1) >= 0
      ) {
        issues.push(
          `${path}.quote 在原文中出现多次，请填写准确的 start/end，或扩展引用使其唯一，不能猜测批注位置`,
        );
        return;
      }
      const start = hasValidStart ? annotation.start : quoteIndex;
      annotations.push({
        ...annotation,
        start,
        end: start + annotation.quote.length,
      } as ScoreResult['annotations'][number]);
    });
  }
  for (const paragraph of sections) {
    if (
      !annotations.some(
        item => item.start! < paragraph.end && item.end! > paragraph.start,
      )
    ) {
      issues.push(
        `annotations 缺少${sectionLabel(
          paragraph,
        )}的句子批注，请逐字引用并评价该部分内容`,
      );
    }
  }
  if (issues.length) {
    throw new ScoreValidationError(issues);
  }
  return {
    score: value.score,
    ...(adjusted
      ? {
          admissionAdjustment: adjustment,
          admissionReason: value.admissionReason || '无准入调整',
        }
      : {}),
    bandId: value.bandId,
    dimensionScores: value.dimensionScores,
    dimensionFeedback: value.dimensionFeedback,
    summary: value.summary,
    strengths: value.strengths,
    weaknesses: value.weaknesses,
    improvements: value.improvements,
    suggestions: value.suggestions,
    titleFeedback: value.titleFeedback,
    salutationFeedback: value.salutationFeedback,
    paragraphReviews: value.paragraphReviews,
    paragraphIndexing: sections.some(section => section.kind === 'salutation')
      ? 'body-v2'
      : 'body-v1',
    bandName: band?.name || '未达强化及格',
    annotations,
  };
}
