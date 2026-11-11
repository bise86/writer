import {ModelCall, TokenUsage, UsageSummary} from '../types';
import {TOKEN_FIELDS} from '../services/usage';
import {ChallengeCall, ChallengeStage} from './types';

function summarize(calls: ModelCall[]): UsageSummary {
  const fields = Object.keys(TOKEN_FIELDS) as (keyof TokenUsage)[];
  const result: UsageSummary = {
    inputTokens: calls.length ? null : 0,
    outputTokens: calls.length ? null : 0,
    totalTokens: calls.length ? null : 0,
    cacheReadTokens: calls.length ? null : 0,
    cacheWriteTokens: calls.length ? null : 0,
    cacheMissTokens: calls.length ? null : 0,
    reasoningTokens: calls.length ? null : 0,
    callCount: calls.length,
    failedCount: 0,
    runningCount: 0,
    countCallCount: 0,
    missing: Object.fromEntries(fields.map(key => [key, 0])) as Record<
      keyof TokenUsage,
      number
    >,
  };
  for (const call of calls) {
    if (['failed', 'incomplete', 'interrupted'].includes(call.status)) {
      result.failedCount += 1;
    }
    if (call.status === 'running') {
      result.runningCount += 1;
    }
    if (call.operation === 'count') {
      result.countCallCount += 1;
      continue;
    }
    for (const key of fields) {
      const value = call[key];
      if (value === null || value === undefined) {
        result.missing[key] += 1;
      } else {
        result[key] = (result[key] ?? 0) + value;
      }
    }
  }
  return result;
}

export function getChallengeUsage(records: ChallengeCall[]) {
  // A running snapshot and its final snapshot represent one actual request.
  const unique = new Map(records.map(record => [record.call.id, record]));
  const calls = [...unique.values()]
    .map(({stage, call}) => ({...call, stage}))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const stages: Partial<Record<ChallengeStage, UsageSummary>> = {};
  for (const stage of new Set(calls.map(call => call.stage))) {
    stages[stage] = summarize(calls.filter(call => call.stage === stage));
  }
  return {total: summarize(calls), stages, calls};
}
