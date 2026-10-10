import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {getScoreReport} from '../db/database';
import {
  recentMonth,
  reportBounds,
  ReportRange,
  ScoreMetric,
  ScoreReport,
} from '../services/reports';
import ReportDatePicker from './ReportDatePicker';
import ScoreTrendChart from './ScoreTrendChart';
import {WritingType} from '../types';
import {getWritingProfile, normalizeWritingType} from '../services/writing';
import {scoreMetricsFor} from '../services/reports';

export default function Reports({
  onBack,
  onOpenEssay,
  initialRange,
  onRangeChange,
  writingType,
}: {
  onBack: () => void;
  onOpenEssay: (id: string) => void;
  initialRange?: ReportRange;
  onRangeChange?: (range: ReportRange) => void;
  writingType?: WritingType;
}) {
  const type = normalizeWritingType(writingType);
  const profile = getWritingProfile(type);
  const metrics = scoreMetricsFor(profile.rules.dimensions);
  const [range, setRange] = useState(() => initialRange || recentMonth());
  const [draft, setDraft] = useState(range);
  const [picker, setPicker] = useState<keyof ReportRange>();
  const [rangeError, setRangeError] = useState('');
  const [report, setReport] = useState<ScoreReport>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [metric, setMetric] = useState<ScoreMetric>('total');
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setRevision(value => value + 1);
      }
    });
    return () => {
      listener.remove();
      foreground.remove();
    };
  }, [onBack]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setReport(undefined);
    setSelectedId(undefined);
    (type === 'english'
      ? getScoreReport(range, 'english')
      : getScoreReport(range)
    )
      .then(value => {
        if (active) {
          setReport(value);
          setLoading(false);
        }
      })
      .catch(reason => {
        if (active) {
          setError(
            `报表读取失败：${
              reason instanceof Error ? reason.message : String(reason)
            }`,
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [range, revision, type]);
  const apply = (next: ReportRange) => {
    try {
      reportBounds(next);
      setRangeError('');
      setDraft(next);
      setRange({...next});
      onRangeChange?.(next);
    } catch (reason) {
      setRangeError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const selected =
    report?.entries.find(entry => entry.id === selectedId) ||
    report?.entries[0];
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={styles.action}>
          <Text style={styles.link}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title}>评分报表</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setRevision(value => value + 1)}
          style={styles.action}>
          <Text style={styles.link}>刷新</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.heading}>统计时间</Text>
          <View style={styles.row}>
            {(['start', 'end'] as const).map(key => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={
                  key === 'start' ? '选择开始日期' : '选择结束日期'
                }
                onPress={() => setPicker(key)}
                style={styles.dateField}>
                <Text style={styles.muted}>
                  {key === 'start' ? '开始日期' : '结束日期'}
                </Text>
                <Text style={styles.dateValue}>{draft[key]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => apply(recentMonth())}
              style={styles.preset}>
              <Text style={styles.link}>最近一个月</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => apply(draft)}
              style={styles.primary}>
              <Text style={styles.white}>查看报表</Text>
            </Pressable>
          </View>
          {!!rangeError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {rangeError}
            </Text>
          )}
          <Text style={styles.note}>
            按评分时间统计，包含起止日期当天；每篇{profile.shortTitle}
            取时段内最后一次成功评分。
          </Text>
        </View>
        <Text style={styles.period}>
          {range.start} 至 {range.end}
        </Text>
        {loading ? (
          <View style={styles.card}>
            <ActivityIndicator color="#2563eb" />
            <Text style={styles.loading}>正在读取评分记录…</Text>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setRevision(value => value + 1)}
              style={styles.preset}>
              <Text style={styles.link}>重试读取</Text>
            </Pressable>
          </View>
        ) : report && !report.count ? (
          <View style={styles.card}>
            <Text style={styles.heading}>这段时间还没有评分记录</Text>
            <Text style={styles.muted}>
              可以调整日期范围，或先完成一篇{profile.shortTitle}的批改。
            </Text>
          </View>
        ) : (
          report &&
          report.average && (
            <>
              <View style={styles.summary}>
                {[
                  [`${profile.shortTitle}篇数`, String(report.count)],
                  ['平均总分', report.average.total.toFixed(1)],
                  ['最高总分', String(report.highest)],
                ].map(([label, value]) => (
                  <View key={label} style={styles.stat}>
                    <Text style={styles.muted}>{label}</Text>
                    <Text style={styles.statValue}>{value}</Text>
                  </View>
                ))}
              </View>
              {!!report.estimatedCount && (
                <Text style={styles.note}>
                  其中 {report.estimatedCount}{' '}
                  篇为旧版记录，使用当时保存的更新时间统计。
                </Text>
              )}
              <View style={styles.card}>
                <Text style={styles.heading}>评分趋势</Text>
                <Text style={styles.muted}>
                  按评分时间排列 · 左右滑动查看更多 · 点击柱形查看作文
                </Text>
                <View style={styles.metrics}>
                  {metrics.map(item => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{selected: metric === item.key}}
                      onPress={() => setMetric(item.key)}
                      style={[
                        styles.metric,
                        metric === item.key && styles.metricSelected,
                      ]}>
                      <Text
                        style={[
                          styles.metricText,
                          metric === item.key && styles.metricSelectedText,
                        ]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <ScoreTrendChart
                  entries={report.entries}
                  metric={metric}
                  metrics={metrics}
                  selectedId={selected?.id}
                  onSelect={setSelectedId}
                />
                {selected && (
                  <View style={styles.selectedEssay}>
                    <Text style={styles.essayTitle}>{selected.title}</Text>
                    <Text style={styles.muted}>
                      {new Date(selected.scoredAt).toLocaleString()}
                      {selected.estimatedTime ? ' · 旧版保存时间' : ''}
                    </Text>
                    <View style={styles.scoreGrid}>
                      {metrics.map(item => (
                        <Text key={item.key} style={styles.scoreText}>
                          {item.label} {selected.scores[item.key]}/{item.max}
                        </Text>
                      ))}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpenEssay(selected.essayId)}
                      style={styles.openEssay}>
                      <Text style={styles.link}>打开作文 ›</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <View style={styles.card} accessibilityLabel="各项平均评分图表">
                <Text style={styles.heading}>各项平均评分</Text>
                <Text style={styles.muted}>条形长度按该项满分比例显示</Text>
                {metrics.slice(1).map(item => {
                  const average = report.average![item.key];
                  return (
                    <View
                      key={item.key}
                      style={styles.dimension}
                      accessible
                      accessibilityLabel={`${item.label}平均 ${average.toFixed(
                        1,
                      )} 分，满分 ${item.max} 分`}>
                      <View style={styles.dimensionRow}>
                        <Text style={styles.dimensionLabel}>{item.label}</Text>
                        <Text style={styles.dimensionValue}>
                          {average.toFixed(1)} / {item.max}
                        </Text>
                      </View>
                      <View style={styles.track}>
                        <View
                          testID={`dimension-bar-${item.key}`}
                          style={[
                            styles.fill,
                            {width: `${(average / item.max) * 100}%`},
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
                <Text style={styles.note}>
                  本时段总分范围：{report.lowest}–{report.highest} 分（满分
                  100）。
                </Text>
              </View>
            </>
          )
        )}
      </ScrollView>
      {picker && (
        <ReportDatePicker
          label={picker === 'start' ? '开始日期' : '结束日期'}
          value={draft[picker]}
          onClose={() => setPicker(undefined)}
          onSelect={value => {
            setDraft({...draft, [picker]: value});
            setPicker(undefined);
          }}
        />
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f7f8fc'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  action: {padding: 12},
  title: {fontSize: 19, fontWeight: '800', color: '#0f172a'},
  link: {color: '#1d4ed8', fontSize: 14, fontWeight: '700'},
  content: {padding: 16, paddingBottom: 40},
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  heading: {fontSize: 17, color: '#0f172a', fontWeight: '800', marginBottom: 8},
  muted: {fontSize: 12, color: '#64748b', lineHeight: 20},
  note: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 6,
  },
  row: {flexDirection: 'row', gap: 12, marginTop: 10},
  dateField: {
    flex: 1,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
  },
  dateValue: {fontSize: 16, color: '#0f172a', marginTop: 4},
  preset: {paddingVertical: 12, paddingHorizontal: 6},
  primary: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 12,
    flex: 1,
    alignItems: 'center',
  },
  white: {color: '#fff', fontWeight: '700'},
  error: {color: '#b91c1c', lineHeight: 22, marginTop: 8},
  period: {fontSize: 13, color: '#475569', marginBottom: 14},
  loading: {textAlign: 'center', color: '#64748b', marginTop: 10},
  summary: {flexDirection: 'row', gap: 10, marginBottom: 14},
  stat: {
    flex: 1,
    backgroundColor: '#eff6ff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {fontSize: 25, fontWeight: '800', color: '#1e3a8a', marginTop: 6},
  metrics: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14},
  metric: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  metricSelected: {backgroundColor: '#dbeafe'},
  metricText: {fontSize: 12, color: '#475569'},
  metricSelectedText: {color: '#1d4ed8', fontWeight: '700'},
  selectedEssay: {
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    marginTop: 12,
  },
  essayTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  scoreGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10},
  scoreText: {fontSize: 12, color: '#334155'},
  openEssay: {paddingTop: 14, paddingBottom: 4},
  dimension: {marginTop: 18},
  dimensionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dimensionLabel: {fontSize: 14, color: '#334155'},
  dimensionValue: {fontSize: 14, color: '#1d4ed8', fontWeight: '700'},
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  fill: {height: 10, borderRadius: 5, backgroundColor: '#3b82f6'},
});
