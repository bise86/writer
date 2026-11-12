import {AppSettings, ModelCall} from '../types';

export type ChallengeLevel = 1 | 2 | 3;
export type ChallengeSubject =
  | 'math'
  | 'english'
  | 'chinese'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'history'
  | 'geography'
  | 'politics'
  | 'science'
  | 'other';
export type ChallengeStatus =
  | 'imported'
  | 'analyzing'
  | 'analyzed'
  | 'generating'
  | 'reviewing'
  | 'repairing'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type ChallengeStage =
  | 'analysis'
  | 'generation'
  | 'review'
  | 'repair'
  | 'pdf';

export type ChallengeSource = import('../shared/media/types').ImportedSource;
export interface ChallengePage {
  pageIndex: number;
  documentType: 'exam' | 'exam_continuation' | 'not_exam' | 'uncertain';
  text: string;
  hasStudentAnswers: boolean;
  unreadableParts: string[];
  figures: SourceFigure[];
  questionRegions?: {number: string; box: SourceFigure['box']}[];
}
export interface OriginalQuestionRegion {
  pageIndex: number;
  box: SourceFigure['box'];
}
export interface SourceFigure {
  id: string;
  kind: 'source';
  pageIndex: number;
  box: {x: number; y: number; width: number; height: number};
  caption: string;
  containsStudentMarks: boolean;
}
export type DrawingElement =
  | {kind: 'line'; x1: number; y1: number; x2: number; y2: number}
  | {kind: 'circle'; x: number; y: number; radius: number}
  | {kind: 'rect'; x: number; y: number; width: number; height: number}
  | {kind: 'text'; x: number; y: number; text: string};
export interface DrawingFigure {
  id: string;
  kind: 'drawing';
  caption: string;
  width: number;
  height: number;
  elements: DrawingElement[];
}
export type ChallengeFigure = SourceFigure | DrawingFigure;
export interface PaperMaterial {
  id: string;
  title: string;
  text: string;
  isListening: boolean;
  figureIds: string[];
}
export interface PaperSection {
  id: string;
  title: string;
  instructions: string;
}
export interface QuestionOption {
  label: string;
  text: string;
}
export interface PaperQuestion {
  id: string;
  number: string;
  sectionId: string;
  type: string;
  stem: string;
  options: QuestionOption[];
  materialIds: string[];
  figureIds: string[];
  knowledgePoints: string[];
  score: number | null;
  isListening: boolean;
  answerLines: number;
}
export interface SourceQuestion extends PaperQuestion {
  sourceRefs: {pageIndex: number; quote: string}[];
  difficulty: {
    rating: number | null;
    reasoningSteps: number | null;
    explanation: string;
  };
  majorQuestionId?: string;
  dependsOnQuestionIds?: string[];
  analysisIssues?: string[];
  upgradeEligibility?: 'eligible' | 'retain';
  retentionReason?: string;
  originalRegions?: OriginalQuestionRegion[];
}
export interface SubjectEvidence {
  pageIndex: number;
  quote: string;
}
export interface MajorQuestion {
  id: string;
  title: string;
  sourceRefs: SubjectEvidence[];
}
export interface SubjectVerification {
  mode: 'title_sample' | 'expanded' | 'progressive';
  titleEvidence: SubjectEvidence[];
  samples: {
    majorQuestionId: string;
    majorQuestionTitle: string;
    candidateQuestionIds: string[];
    selectedQuestionId: string;
    selectedQuestionNumber: string;
    sourceRefs: SubjectEvidence[];
  }[];
  expansionReason?: string;
  candidateOrder?: string[];
  votes?: SubjectSampleVote[];
  titleGuess?: SubjectTitleGuess;
  titleVerification?: 'unavailable' | 'pending' | 'verified' | 'conflict';
}
export interface SubjectTitleGuess {
  subject: ChallengeSubject;
  courseName: string;
  evidence: SubjectEvidence[];
}
export interface SubjectSampleVote {
  questionId: string;
  subject: ChallengeSubject | 'unknown';
  courseName: string;
  integrated: boolean;
  reason: string;
  evidence: SubjectEvidence[];
}
export interface SubjectIdentification {
  status: 'confirmed';
  subject: ChallengeSubject;
  courseName: string;
  integrated: boolean;
  reason: string;
  evidence: {pageIndex: number; quote: string}[];
  verification?: SubjectVerification;
}
export interface ExamAnalysis {
  isExam: true;
  title: string;
  subject: ChallengeSubject;
  subjectLabel: string;
  educationLevel: 'middle' | 'high' | 'unknown';
  knowledgePoints: string[];
  difficultySummary: string;
  difficultyBasis: 'estimated';
  answerState: 'blank' | 'answered' | 'mixed';
  sections: PaperSection[];
  materials: PaperMaterial[];
  figures: SourceFigure[];
  questions: SourceQuestion[];
  totalScore: number | null;
  timeLimitMinutes: number | null;
  warnings: string[];
  unresolvedIssues: string[];
  // Missing on historical records; a fresh identification is required to upgrade.
  subjectIdentification?: SubjectIdentification;
  titleEvidence?: SubjectEvidence[];
  majorQuestions?: MajorQuestion[];
}
export interface ChallengeDirectionEvidence {
  directionId: string;
  originalDemand: string;
  newDemand: string;
  problemQuote: string;
  solutionQuote: string;
  necessity: string;
}
export type ExamDraft = Omit<
  ExamAnalysis,
  'subject' | 'subjectIdentification'
> & {
  subject: ChallengeSubject | 'unknown';
  subjectIdentification?: never;
};
export interface ChallengeDirectionConnection {
  from: string;
  to: string;
  solutionQuote: string;
  explanation: string;
}
export interface ChallengeDepthCheck {
  kind: 'decision' | 'boundary';
  description: string;
  problemQuote: string;
  solutionQuote: string;
  explanation: string;
}
export interface QuestionUpgrade {
  mode?: 'upgraded' | 'retained';
  retentionReason?: string;
  level: ChallengeLevel;
  metrics: Record<string, number>;
  changes: string[];
  pitfalls: string[];
  scopeExplanation: string;
  // Optional for reading saved v1 records; v2 generation validates these fields.
  depthRoute?: 'combined' | 'focused';
  directionEvidence?: ChallengeDirectionEvidence[];
  directionConnections?: ChallengeDirectionConnection[];
  depthChecks?: ChallengeDepthCheck[];
}
export interface GeneratedQuestion extends PaperQuestion {
  upgrade: QuestionUpgrade;
}
export interface ChallengeMisconception {
  challengeId: string;
  wrongApproach: string;
  whyWrong: string;
  correction: string;
  solutionQuote: string;
  scopeReason?: string;
  sourceQuote?: string;
}
export interface ChallengeTransferLink {
  kind: 'source_to_variant' | 'condition_contrast';
  originalCondition: string;
  changedCondition: string;
  invariant: string;
  adaptation: string;
  sourceQuote: string;
  problemQuote: string;
  solutionQuote: string;
}
export interface ChallengeSelfCheck {
  kind: 'conditions' | 'reasoning' | 'result';
  method: string;
  expected: string;
  solutionQuote: string;
}
export interface ChallengeLearningGuide {
  knowledgePoint: string;
  coreInsight: string;
  conditionBoundary: string;
  reasoning: string;
  problemQuote: string;
  solutionQuote: string;
  misconceptions: ChallengeMisconception[];
  transferLinks: ChallengeTransferLink[];
  selfChecks: ChallengeSelfCheck[];
}
export interface QuestionAnswer {
  questionId: string;
  status: 'verified' | 'requires_audio' | 'requires_review';
  answer: string;
  explanation: string;
  scoringPoints: string[];
  // Saved v1/v2 papers remain readable; v3 requires a guide for every core point.
  learningGuide?: ChallengeLearningGuide[];
}
export interface ChallengePaper {
  title: string;
  level: ChallengeLevel;
  subject: ChallengeSubject;
  sections: PaperSection[];
  materials: PaperMaterial[];
  figures: ChallengeFigure[];
  questions: GeneratedQuestion[];
  answers: QuestionAnswer[];
  totalScore: number | null;
  timeLimitMinutes: number | null;
  // Training coverage is not evidence of the learner's demonstrated mastery.
  masteryStatus?: 'training_only';
}
export const CHALLENGE_REVIEW_ROLES = [
  'subject',
  'scope',
  'difficulty',
  'answers',
  'presentation',
] as const;
export type ChallengeReviewRole = (typeof CHALLENGE_REVIEW_ROLES)[number];
export type ChallengeRoundtableSize = 0 | 3 | 5;
export interface ChallengeReview {
  role: ChallengeReviewRole;
  verdict: 'approve' | 'revise';
  checkedQuestionIds: string[];
  summary: string;
  issues: {questionId: string; code: string; comment: string; fix: string}[];
}
export interface ChallengeReviewRound {
  round: number;
  candidateRevision: number;
  reviews: ChallengeReview[];
  roundtableSize?: ChallengeRoundtableSize;
}
export interface ChallengeCall {
  stage: ChallengeStage;
  call: ModelCall;
}
export interface ChallengeGenerationProgress {
  version: 'question-patches-v1';
  sourceSignature: string;
  level: ChallengeLevel;
  policyVersion: string;
  integrityVersion?: number;
  completedQuestionIds: string[];
  // Older drafts omit phase and resume their initial generation pass.
  phase?: 'generation' | 'repair' | 'evidence';
  pendingQuestionIds?: string[];
  feedback?: unknown;
  // Evidence-phase tasks include quote and mastery-catalog bindings; both edit
  // metadata only, sharing the trusted body and pending regeneration queue.
  evidenceQuestionIds?: string[];
  afterEvidencePhase?: 'generation' | 'repair';
  evidenceBasePaper?: ChallengePaper;
  lockedAssetIds?: string[];
  paper: ChallengePaper;
}
export interface ChallengeRecord {
  id: string;
  title: string;
  status: ChallengeStatus;
  sources: ChallengeSource[];
  pageUris: string[];
  level: ChallengeLevel;
  runId?: string;
  policyVersion?: string;
  selectionPolicyVersion?: string;
  reviewProtocolVersion?: string;
  reviewRoundtableSize?: ChallengeRoundtableSize;
  analysis?: ExamAnalysis;
  subjectIdentification?: SubjectIdentification;
  subjectVerification?: SubjectVerification;
  loadedSubjectRules?: {subject: ChallengeSubject; policyVersion: string};
  generationProgress?: ChallengeGenerationProgress;
  pages: ChallengePage[];
  candidate?: ChallengePaper;
  candidateRevision?: number;
  reviewRounds: ChallengeReviewRound[];
  calls: ChallengeCall[];
  paperPdfUri?: string;
  answersPdfUri?: string;
  progress: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}
export interface ChallengeRunOptions {
  settings: AppSettings;
  analysisMode?: 'resume' | 'restart';
  signal?: AbortSignal;
  onUpdate?: (record: ChallengeRecord) => void;
}
