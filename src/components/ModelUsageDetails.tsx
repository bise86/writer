import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {ModelCall, TokenUsage, UsageSummary} from '../types';

export interface ModelUsage {
  total: UsageSummary;
  stages: Partial<Record<string, UsageSummary>>;
  calls: (ModelCall & {stage: string})[];
}

const FIELDS: [keyof TokenUsage, string][] = [
  ['inputTokens', '输入'],
  ['outputTokens', '输出'],
  ['totalTokens', '合计'],
  ['cacheReadTokens', '缓存读取'],
  ['cacheWriteTokens', '缓存写入'],
  ['cacheMissTokens', '缓存未命中'],
  ['reasoningTokens', '思考'],
];
const OPERATIONS = {
  response: '模型生成',
  summary: '历史摘要',
  compact: '历史压缩',
  count: '输入计数',
};
const STATUSES = {
  running: '请求中',
  completed: '已返回',
  incomplete: '输出未完成',
  failed: '请求失败',
  interrupted: '请求中断',
};

function amount(value: number | null, missing = 0) {
  return value === null
    ? '未返回'
    : `${value.toLocaleString()}${missing ? `（另 ${missing} 次未返回）` : ''}`;
}
function Metrics({
  usage,
}: {
  usage: TokenUsage & {missing?: UsageSummary['missing']};
}) {
  return (
    <View style={styles.metrics}>
      {FIELDS.map(([key, label]) => (
        <Text key={key} style={styles.body}>
          {label}：{amount(usage[key], usage.missing?.[key])}
        </Text>
      ))}
    </View>
  );
}
function Summary({title, value}: {title: string; value?: UsageSummary}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{title}</Text>
      {value?.callCount ? (
        <>
          <Text style={styles.body}>
            实际调用 {value.callCount} 次 · 失败/未完成 {value.failedCount} 次 ·
            进行中 {value.runningCount} 次
          </Text>
          <Metrics usage={value} />
          {!!value.countCallCount && (
            <Text style={styles.muted}>
              含 {value.countCallCount} 次输入计数请求，其测量值不计入生成消耗。
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.muted}>暂无调用记录</Text>
      )}
    </View>
  );
}

export default function ModelUsageDetails({
  usage,
  stages,
  note,
  error,
}: {
  usage?: ModelUsage;
  stages: [string, string][];
  note: string;
  error?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <Text style={styles.muted}>{note}</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!usage ? (
        <Text style={styles.body}>正在读取消耗记录…</Text>
      ) : (
        <>
          <Summary title="总体消耗" value={usage.total} />
          {stages.map(([stage, label]) => (
            <Summary key={stage} title={label} value={usage.stages[stage]} />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{expanded}}
            onPress={() => setExpanded(!expanded)}>
            <Text style={styles.link}>
              {expanded ? '收起逐次调用' : '展开逐次调用'}
            </Text>
          </Pressable>
          {expanded &&
            usage.calls.map((call, index) => (
              <View key={call.id} style={styles.card}>
                <Text style={styles.heading}>
                  第 {index + 1} 次 ·{' '}
                  {stages.find(([stage]) => stage === call.stage)?.[1] ||
                    call.stage}{' '}
                  · {OPERATIONS[call.operation]}
                </Text>
                <Text style={styles.body}>
                  {call.model} · {STATUSES[call.status]}
                </Text>
                <Text style={styles.muted}>
                  开始：{new Date(call.startedAt).toLocaleString()}
                </Text>
                <Text style={styles.muted}>
                  结束：
                  {call.finishedAt
                    ? new Date(call.finishedAt).toLocaleString()
                    : '未记录'}
                  {call.durationMs !== null
                    ? ` · ${(call.durationMs / 1000).toFixed(1)} 秒`
                    : ''}
                </Text>
                {call.operation === 'count' ? (
                  <Text style={styles.body}>
                    输入测量：{amount(call.measuredInputTokens)}
                    （不计入生成消耗）
                  </Text>
                ) : (
                  <Metrics usage={call} />
                )}
              </View>
            ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    gap: 8,
  },
  heading: {fontSize: 16, fontWeight: '700', color: '#0f172a'},
  body: {fontSize: 14, color: '#334155', lineHeight: 23},
  muted: {fontSize: 12, color: '#64748b', lineHeight: 20},
  metrics: {gap: 4},
  error: {color: '#b91c1c', marginTop: 12},
  link: {color: '#1d4ed8', paddingVertical: 16, fontWeight: '700'},
});
