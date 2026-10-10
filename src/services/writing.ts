import chineseRules from '../assets/scoring-rules.json';
import englishRules from '../assets/english-scoring-rules.json';
import {WritingType} from '../types';

export interface ScoringRules {
  id: string;
  version: number;
  total: number;
  passingScore: number;
  dimensions: {id: string; name: string; max: number}[];
  bands: {id: string; name: string; min: number; max: number; floor: Record<string, number>}[];
  rules: {
    techniquePolicy: string;
    ceiling: {max: number; when: string}[];
    thirdBand?: string;
    admissionPolicy?: string;
    materialPolicy?: string;
  };
  outputSchema: Record<string, string>;
}

export interface WritingProfile {
  type: WritingType;
  label: string;
  title: string;
  shortTitle: string;
  subtitle: string;
  emptyText: string;
  captureHint: string;
  rules: ScoringRules;
}

const profiles: Record<WritingType, WritingProfile> = {
  chinese: {
    type: 'chinese',
    label: '作文',
    title: '作文批改',
    shortTitle: '作文',
    subtitle: '拍下作文，识别、评分，并把修改建议落到原文。',
    emptyText: '还没有作文，拍一张开始吧。',
    captureHint: '可连续拍摄或多选作文页；每页可保留原图或裁剪后再识别。',
    rules: chineseRules,
  },
  english: {
    type: 'english',
    label: '英文',
    title: '英文批改',
    shortTitle: '英文作文',
    subtitle: '拍下英文作文，识别、评分，并把语句改进落到原文。',
    emptyText: '还没有英文作文，拍一张开始吧。',
    captureHint: '支持连续拍摄或多选英文作文页；保留原图并按原段落识别。',
    rules: englishRules,
  },
};

export function normalizeWritingType(value: unknown): WritingType {
  return value === 'english' ? 'english' : 'chinese';
}

export function getWritingProfile(value?: unknown): WritingProfile {
  return profiles[normalizeWritingType(value)];
}

export function getWritingRules(value?: unknown): ScoringRules {
  return getWritingProfile(value).rules;
}
