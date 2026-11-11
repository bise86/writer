import {ChallengeRecord} from './types';

export const CHALLENGE_STATUS_LABELS: Record<
  ChallengeRecord['status'],
  string
> = {
  imported: '待解析',
  analyzing: '解析试卷中',
  analyzed: '已解析',
  generating: '生成变种题中',
  reviewing: '按标准校核中',
  repairing: '修复校核问题中',
  exporting: '生成 PDF 中',
  completed: '已完成',
  failed: '处理未完成',
  cancelled: '已停止',
};

export const CHALLENGE_RUNNING_STATUSES = new Set([
  'analyzing',
  'generating',
  'reviewing',
  'repairing',
  'exporting',
]);
