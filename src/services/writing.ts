import chineseRules from '../assets/scoring-rules.json';
import englishRules from '../assets/english-scoring-rules.json';
import highChineseRules from '../assets/high-scoring-rules.json';
import highEnglishRules from '../assets/high-english-scoring-rules.json';
import {EducationLevel, WritingType} from '../types';

export interface ScoringRules {
  id: string;
  version: number;
  educationLevel?: string;
  total: number;
  passingScore: number;
  dimensions: {id: string; name: string; max: number}[];
  bands: {id: string; name: string; min: number; max: number; floor: Record<string, number>}[];
  highSchoolCapabilities?: {
    id: string;
    name: string;
    dimension: string;
    minimumBand: string;
    evidence: string;
  }[];
  rules: {
    techniquePolicy: string;
    ceiling: {max: number; when: string}[];
    thirdBand?: string;
    admissionPolicy?: string;
    materialPolicy?: string;
    languagePolicy?: string;
    crossLevelPolicy?: string;
    quantitativePolicy?: string;
  };
  outputSchema: Record<string, string>;
}

export interface WritingProfile {
  type: WritingType;
  educationLevel: EducationLevel;
  educationLabel: string;
  label: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  emptyText: string;
  captureHint: string;
  rules: ScoringRules;
}

const rules: Record<WritingType, Record<EducationLevel, ScoringRules>> = {
  chinese: {middle: chineseRules, high: highChineseRules},
  english: {middle: englishRules, high: highEnglishRules},
};

const profiles: Record<WritingType, Omit<WritingProfile, 'educationLevel' | 'educationLabel' | 'rules'> & {rules: Record<EducationLevel, ScoringRules>}> = {
  chinese: {
    type: 'chinese',
    label: '作文',
    title: '作文批改',
    shortTitle: '作文',
    subtitle: '拍下作文，识别、评分，并把修改建议落到原文。',
    emptyText: '还没有作文，拍一张开始吧。',
    captureHint: '可连续拍摄或多选作文页；每页可保留原图或裁剪后再识别。',
    rules: rules.chinese,
  },
  english: {
    type: 'english',
    label: '英文',
    title: '英文批改',
    shortTitle: '英文作文',
    subtitle: '拍下英文作文，识别、评分，并把语句改进落到原文。',
    emptyText: '还没有英文作文，拍一张开始吧。',
    captureHint: '支持连续拍摄或多选英文作文页；保留原图并按原段落识别。',
    rules: rules.english,
  },
};

export function normalizeWritingType(value: unknown): WritingType {
  return value === 'english' ? 'english' : 'chinese';
}

export function getWritingProfile(
  value?: unknown,
  educationLevel?: unknown,
): WritingProfile {
  const type = normalizeWritingType(value);
  const level: EducationLevel = educationLevel === 'high' ? 'high' : 'middle';
  const profile = profiles[type];
  return {
    ...profile,
    educationLevel: level,
    educationLabel: level === 'high' ? '高中' : '初中',
    rules: profile.rules[level],
  };
}

export function getWritingRules(
  value?: unknown,
  educationLevel?: unknown,
): ScoringRules {
  return getWritingProfile(value, educationLevel).rules;
}
