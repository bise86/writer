import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {getSteps} from '../db/database';
import {Essay, PipelineStep, ScoreResult, StepId} from '../types';
import {recognizedTitle} from '../services/essay-text';
import CorrectionPdf from './CorrectionPdf';
import UsageDetails from './UsageDetails';

const STAGES: [StepId, string][] = [
  ['vision_ocr', '逐页图片识别'],
  ['reconcile', '原图复核'],
  ['scoring', '评分与批注'],
];
const DIMENSIONS: [string, string, number][] = [
  ['thesis', '审题与立意', 25],
  ['content', '内容与选材', 25],
  ['structure', '结构与技法', 20],
  ['language', '语言与表达', 20],
  ['format', '书写与规范', 10],
];
type Tab = 'original' | 'stage' | 'result' | 'correction' | 'usage';
function Card({children}: {children: React.ReactNode}) {
  return <View style={styles.card}>{children}</View>;
}
function Lines({
  title,
  values,
  color,
}: {
  title: string;
  values: string[];
  color?: string;
}) {
  return (
    <View style={styles.feedback}>
      <Text style={[styles.subheading, color ? {color} : undefined]}>
        {title}
      </Text>
      {values.length ? (
        values.map((value, i) => (
          <Text key={i} selectable style={styles.body}>
            • {value}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>未指出明显问题或特点</Text>
      )}
    </View>
  );
}
function StageOutput({title, value}: {title: string; value: string}) {
  return (
    <View style={styles.feedback}>
      <Text style={styles.subheading}>{title}</Text>
      <Text selectable style={styles.body}>
        {value || '等待该阶段输出'}
      </Text>
    </View>
  );
}
export default function EssayDetail({
  essay,
  onBack,
  onRetry,
  onRecognize,
}: {
  essay: Essay;
  onBack: () => void;
  onRetry: () => void;
  onRecognize: () => void;
}) {
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [stepError, setStepError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>(
    essay.status === 'completed' ? 'result' : 'stage',
  );
  const previous = useRef({id: essay.id, status: essay.status});
  useEffect(() => {
    let active = true;
    const refresh = () =>
      getSteps(essay.id)
        .then(items => {
          if (active) {
            setSteps(items);
            setStepError('');
          }
        })
        .catch(() => {
          if (active) {
            setStepError('暂时无法读取进度，正在重试');
          }
        });
    refresh();
    const timer = setInterval(refresh, 1200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [essay.id]);
  useEffect(() => {
    if (
      essay.id !== previous.current.id ||
      (essay.status === 'completed' && previous.current.status !== 'completed')
    ) {
      setActiveTab(essay.status === 'completed' ? 'result' : 'stage');
    } else if (!essay.canonicalText || essay.status === 'failed') {
      setActiveTab('stage');
    }
    previous.current = {id: essay.id, status: essay.status};
  }, [essay.id, essay.status, essay.canonicalText]);
  const score = useMemo<ScoreResult | null>(() => {
    try {
      return essay.scoreJson ? JSON.parse(essay.scoreJson) : null;
    } catch {
      return null;
    }
  }, [essay.scoreJson]);
  const title =
    essay.canonicalText || essay.visionOcr
      ? recognizedTitle(essay.canonicalText || essay.visionOcr)
      : essay.title;
  const recognized = !!essay.canonicalText.trim();
  const completed = essay.status === 'completed' && !!score;
  const busy = !['failed', 'completed'].includes(essay.status);
  const tabs: [Tab, string][] = [
    ...(recognized ? [['original', '原文'] as [Tab, string]] : []),
    ['stage', '阶段输出'],
    ...(completed
      ? ([
          ['result', '评分结果'],
          ['correction', '批改'],
        ] as [Tab, string][])
      : []),
    ['usage', '消耗详情'],
  ];
  const photos = essay.imageUris?.length ? essay.imageUris : [essay.imageUri];
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.muted}>
          {completed
            ? '评分完成'
            : essay.status === 'failed'
            ? '处理失败'
            : '正在处理'}
        </Text>
      </View>
      <Text accessibilityLabel="作文标题" style={styles.title}>
        {title || (recognized ? '未命名作文' : '正在识别标题…')}
      </Text>
      <View style={styles.photos} accessibilityLabel="原始照片">
        <Text style={styles.muted}>原始照片 · {photos.length} 张</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {photos.map((uri, i) => (
            <Image
              key={`${uri}-${i}`}
              source={{uri}}
              style={styles.photo}
              accessibilityLabel={`原始照片 ${i + 1}`}
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{selected: activeTab === key}}
            onPress={() => setActiveTab(key)}
            style={[styles.tab, activeTab === key && styles.activeTab]}>
            <Text
              style={[
                styles.tabText,
                activeTab === key && styles.activeTabText,
              ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {activeTab === 'correction' && completed && score ? (
        <CorrectionPdf essay={{...essay, title}} score={score} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {activeTab === 'original' && recognized && (
            <>
              <Card>
                <Text style={styles.heading}>识别后的原作文</Text>
                <Text style={styles.muted}>
                  保留作者原有文字，修改建议见“批改”。无法辨认的字会在原文中标明。
                </Text>
                <Text selectable style={styles.original}>
                  {essay.canonicalText}
                </Text>
              </Card>
            </>
          )}
          {activeTab === 'usage' && <UsageDetails essayId={essay.id} />}
          {activeTab === 'stage' && (
            <>
              <Card>
                <Text style={styles.heading}>处理进度</Text>
                {STAGES.map(([id, label]) => {
                  const item = steps.find(value => value.step === id);
                  return (
                    <View style={styles.stage} key={id}>
                      <View style={styles.stageText}>
                        <Text style={styles.subheading}>{label}</Text>
                        {id === 'reconcile' && (
                          <Text style={styles.muted}>
                            再次对照原照片核对识别结果，不润色或改写作文。
                          </Text>
                        )}
                        <Text
                          style={[
                            styles.muted,
                            item?.status === 'failed' && styles.error,
                          ]}>
                          {item?.detail || '等待处理'}
                        </Text>
                      </View>
                      {item?.status === 'running' ? (
                        <ActivityIndicator color="#2563eb" />
                      ) : (
                        <Text style={styles.muted}>
                          {item?.status === 'success'
                            ? '完成'
                            : item?.status === 'failed'
                            ? '失败'
                            : '等待'}
                        </Text>
                      )}
                    </View>
                  );
                })}
                {!!stepError && <Text style={styles.error}>{stepError}</Text>}
              </Card>
              {essay.status === 'failed' && (
                <Card>
                  <Text selectable style={styles.error}>
                    {essay.error}
                  </Text>
                  <Pressable onPress={onRetry} style={styles.button}>
                    <Text style={styles.buttonText}>重试失败阶段</Text>
                  </Pressable>
                </Card>
              )}
              <Card>
                <StageOutput title="逐页识别结果" value={essay.visionOcr} />
                <StageOutput
                  title="原图复核后的原文"
                  value={essay.canonicalText}
                />
                <StageOutput title="复核说明" value={essay.corrections} />
                <StageOutput
                  title="评分阶段状态"
                  value={
                    steps.find(item => item.step === 'scoring')?.detail || ''
                  }
                />
              </Card>
              {!busy && (
                <>
                  {essay.status === 'completed' && !!essay.canonicalText && (
                    <Pressable onPress={onRetry} style={styles.button}>
                      <Text style={styles.buttonText}>重新评分与批注</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={onRecognize} style={styles.button}>
                    <Text style={styles.buttonText}>重新识别并评分</Text>
                  </Pressable>
                </>
              )}
            </>
          )}
          {activeTab === 'result' && completed && score && (
            <>
              <View style={[styles.card, styles.summary]}>
                <Text style={styles.heading}>总评</Text>
                <Text style={styles.score}>
                  {score.score}
                  <Text style={styles.scoreMax}> / 100</Text>
                </Text>
                <Text style={styles.band}>
                  {score.bandName || score.bandId}
                </Text>
                <Text selectable style={styles.body}>
                  {score.summary}
                </Text>
              </View>
              <Card>
                <Text style={styles.heading}>各项评分</Text>
                {DIMENSIONS.map(([key, label, max]) => (
                  <View key={key} style={styles.metric}>
                    <View style={styles.metricRow}>
                      <Text style={styles.body}>{label}</Text>
                      <Text style={styles.metricValue}>
                        {score.dimensionScores[key] ?? 0} / {max}
                      </Text>
                    </View>
                    <View style={styles.bar}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.min(
                              100,
                              Math.max(
                                0,
                                ((score.dimensionScores[key] || 0) / max) * 100,
                              ),
                            )}%`,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </Card>
              <Card>
                <Text style={styles.heading}>各项优缺点与改进</Text>
                {DIMENSIONS.map(([key, label]) => {
                  const feedback = score.dimensionFeedback?.[key];
                  return feedback ? (
                    <View key={key} style={styles.dimension}>
                      <Text style={styles.heading}>{label}</Text>
                      <Lines
                        title="优点"
                        values={feedback.strengths}
                        color="#166534"
                      />
                      <Lines
                        title="不足"
                        values={feedback.weaknesses}
                        color="#b91c1c"
                      />
                      <Lines
                        title="改进方法"
                        values={feedback.improvements}
                        color="#92400e"
                      />
                    </View>
                  ) : null;
                })}
              </Card>
              <Card>
                <Lines
                  title="总体写得好的地方"
                  values={score.strengths}
                  color="#166534"
                />
              </Card>
              <Card>
                <Lines
                  title="总体需要改进的地方"
                  values={score.weaknesses}
                  color="#b91c1c"
                />
                <Lines
                  title="具体改法"
                  values={score.improvements}
                  color="#92400e"
                />
              </Card>
              <Card>
                <Lines
                  title="下一步建议"
                  values={score.suggestions}
                  color="#1d4ed8"
                />
              </Card>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f7f8fc'},
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  link: {color: '#1d4ed8', fontSize: 16, paddingVertical: 8},
  title: {
    fontSize: 21,
    fontWeight: '800',
    color: '#0f172a',
    padding: 16,
    paddingTop: 8,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    padding: 4,
    marginHorizontal: 12,
    borderRadius: 12,
  },
  tab: {flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 8},
  activeTab: {backgroundColor: '#fff'},
  tabText: {color: '#475569', fontSize: 14, fontWeight: '700'},
  activeTabText: {color: '#1d4ed8'},
  content: {padding: 16, paddingBottom: 40},
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  summary: {backgroundColor: '#eff6ff', borderColor: '#bfdbfe', borderWidth: 1},
  heading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  subheading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 5,
  },
  body: {fontSize: 15, color: '#334155', lineHeight: 25},
  muted: {fontSize: 12, color: '#64748b', lineHeight: 20},
  original: {fontSize: 17, color: '#1e293b', lineHeight: 31, marginTop: 18},
  photos: {paddingHorizontal: 16, paddingBottom: 10, gap: 6},
  photo: {
    width: 84,
    height: 100,
    resizeMode: 'contain',
    marginRight: 10,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
  },
  feedback: {marginBottom: 14},
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  stageText: {flex: 1},
  error: {color: '#b91c1c', lineHeight: 22},
  button: {
    padding: 13,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: {color: '#fff', fontWeight: '700'},
  score: {fontSize: 48, color: '#1e3a8a', fontWeight: '800'},
  scoreMax: {fontSize: 18, color: '#475569'},
  band: {color: '#1d4ed8', fontSize: 15, marginBottom: 12},
  metric: {marginBottom: 14},
  metricRow: {flexDirection: 'row', justifyContent: 'space-between'},
  metricValue: {color: '#1d4ed8', fontWeight: '700'},
  bar: {height: 6, backgroundColor: '#e2e8f0', borderRadius: 4, marginTop: 6},
  fill: {height: 6, backgroundColor: '#2563eb', borderRadius: 4},
  dimension: {paddingTop: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0'},
});
