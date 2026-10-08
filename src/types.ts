export type EssayStatus =
  | 'queued'
  | 'local_ocr'
  | 'vision_ocr'
  | 'reconcile'
  | 'scoring'
  | 'completed'
  | 'failed';

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
  /** Missing on older scores whose numbering included the title. */
  paragraphIndexing?: 'body-v1';
  paragraphReviews?: (WritingFeedback & {paragraphIndex: number})[];
  roundtable?: RoundtableReport;
}

export interface ReviewOpinion {
  scoreApproved: boolean;
  annotationsApproved: boolean;
  scoreReason: string;
  annotationsReason: string;
  changes: string[];
}

export interface RoleOpinion extends ReviewOpinion {
  roleId: string;
  roleName: string;
}

export interface RoundtableRound {
  round: number;
  draftScore: number;
  reviews: RoleOpinion[];
  votes: RoleOpinion[];
  scoreVotes: number;
  annotationVotes: number;
}

export interface RoundtableReport {
  reviewerCount: 3 | 5;
  majority: number;
  rounds: RoundtableRound[];
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
