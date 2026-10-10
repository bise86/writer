export type EssayStatus =
  | 'queued'
  | 'local_ocr'
  | 'vision_ocr'
  | 'reconcile'
  | 'scoring'
  | 'completed'
  | 'failed';

export type WritingType = 'chinese' | 'english';

export type StepId = 'local_ocr' | 'vision_ocr' | 'reconcile' | 'scoring';
export type StepStatus = 'pending' | 'running' | 'success' | 'failed';

export interface AppSettings {
  modelName: string;
  reasoningEffort: 'none' | 'low' | 'high' | 'max';
  contextWindow: number;
  compactionThreshold: number;
  maxOutputTokens: number;
  retryCount: number;
  roundtableSize: 0 | 3 | 5;
  apiBaseUrl: string;
  apiKey: string;
}

export interface Essay {
  id: string;
  /** Older in-memory/test records omit this and are treated as Chinese. */
  writingType?: WritingType;
  title: string;
  imageUri: string;
  imageUris: string[];
  localOcr: string;
  visionOcr: string;
  canonicalText: string;
  corrections: string;
  scoreJson: string;
  status: EssayStatus;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStep {
  essayId: string;
  step: StepId;
  status: StepStatus;
  detail: string;
  retryCount: number;
  updatedAt: string;
}

export interface Annotation {
  quote: string;
  start?: number;
  end?: number;
  type: 'strength' | 'improvement' | 'grammar' | 'structure' | 'style';
  comment: string;
  suggestion: string;
}

export interface ScoreResult {
  score: number;
  /** English admission ceilings preserve the actual dimension scores. */
  admissionAdjustment?: number;
  admissionReason?: string;
  bandId: string;
  bandName?: string;
  dimensionScores: Record<string, number>;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  suggestions: string[];
  annotations: Annotation[];
  dimensionFeedback?: Record<string, WritingFeedback>;
  titleFeedback?: WritingFeedback;
  salutationFeedback?: WritingFeedback;
  /** Missing on older scores whose numbering included the title. */
  paragraphIndexing?: 'body-v1' | 'body-v2';
  paragraphReviews?: (WritingFeedback & {paragraphIndex: number})[];
}

export interface WritingFeedback {
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}

export interface ScoreAttempt {
  id: number;
  essayId: string;
  sourceText: string;
  output: string;
  feedback: string;
  createdAt: string;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheMissTokens: number | null;
  reasoningTokens: number | null;
}

export type ModelOperation = 'response' | 'summary' | 'compact' | 'count';
export interface ModelCall extends TokenUsage {
  id: string;
  operation: ModelOperation;
  model: string;
  status: 'running' | 'completed' | 'incomplete' | 'failed' | 'interrupted';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  responseId: string | null;
  httpStatus: number | null;
  measuredInputTokens: number | null;
  rawUsageJson: string | null;
}

export interface UsageSummary extends TokenUsage {
  callCount: number;
  failedCount: number;
  runningCount: number;
  countCallCount: number;
  missing: Record<keyof TokenUsage, number>;
}

export interface EssayUsage {
  total: UsageSummary;
  stages: Partial<Record<StepId, UsageSummary>>;
  calls: (ModelCall & {stage: StepId; runId: string})[];
}
