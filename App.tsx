import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  Asset,
} from 'react-native-image-picker';
import {
  createEssay,
  clearLogsAndCache,
  clearEssaysBefore,
  deleteEssay,
  getEssay,
  getSteps,
  listEssays,
  saveSettings,
} from './src/db/database';
import {
  AppSettings,
  Essay,
  PipelineStep,
  ScoreResult,
  StepId,
} from './src/types';
import {retryEssay, runEssayPipeline} from './src/services/pipeline';
import {
  OUTPUT_TOKEN_OPTIONS,
  REASONING_LEVELS,
  validateSettings,
} from './src/settings';
import {cropImage, CropPreset, persistImage} from './src/services/images';
import Startup, {StartupData} from './src/components/Startup';

const STEP_LABELS: Record<StepId, string> = {
  local_ocr: '本地 OCR 识别',
  vision_ocr: '云端图片识别',
  reconcile: '双路文字对照',
  scoring: '评分与批注',
};

const emptyScore: ScoreResult = {
  score: 0,
  bandId: 'unqualified',
  dimensionScores: {},
  summary: '',
  strengths: [],
  weaknesses: [],
  improvements: [],
  suggestions: [],
  annotations: [],
};

function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
      ]}>
      <Text
        style={[styles.buttonText, secondary && styles.secondaryButtonText]}>
        {title}
      </Text>
    </Pressable>
  );
}

function Card({children, style}: {children: React.ReactNode; style?: any}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Progress({steps}: {steps: PipelineStep[]}) {
  return (
    <Card>
      <Text style={styles.cardTitle}>处理进度</Text>
      {(['local_ocr', 'vision_ocr', 'reconcile', 'scoring'] as StepId[]).map(
        step => {
          const item = steps.find(value => value.step === step);
          const status = item?.status || 'pending';
          return (
            <View key={step} style={styles.stepRow}>
              <View
                style={[
                  styles.stepDot,
                  status === 'success' && styles.successDot,
                  status === 'failed' && styles.errorDot,
                  status === 'running' && styles.runningDot,
                ]}
              />
              <View style={styles.stepText}>
                <Text style={styles.stepName}>{STEP_LABELS[step]}</Text>
                <Text style={styles.stepDetail}>
                  {item?.detail || '等待处理'}
                </Text>
              </View>
              {status === 'running' && (
                <ActivityIndicator size="small" color="#2563eb" />
              )}
              {status === 'failed' && (
                <Text style={styles.errorText}>失败</Text>
              )}
            </View>
          );
        },
      )}
    </Card>
  );
}

function Home({
  essays,
  onCapture,
  onOpen,
  onSettings,
  onManage,
}: {
  essays: Essay[];
  onCapture: (camera: boolean) => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onManage: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ESSAY LENS</Text>
            <Text style={styles.title}>作文改进</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={onManage} style={styles.headerAction}>
              <Text style={styles.headerActionText}>管理</Text>
            </Pressable>
            <Pressable onPress={onSettings}>
              <Text style={styles.settingsIcon}>⚙</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.subtitle}>
          拍下作文，识别、评分，并把修改建议落到原文。
        </Text>
        <Card style={styles.captureCard}>
          <Text style={styles.captureTitle}>开始一次批改</Text>
          <Text style={styles.muted}>
            可连续拍摄或多选作文页；每页可保留原图或裁剪后再识别。
          </Text>
          <View style={styles.actionRow}>
            <Button title="拍照" onPress={() => onCapture(true)} />
            <Button
              title="选择图片（可多选）"
              secondary
              onPress={() => onCapture(false)}
            />
          </View>
        </Card>
        <Text style={styles.sectionTitle}>最近作文</Text>
        {essays.length === 0 ? (
          <Card>
            <Text style={styles.muted}>还没有作文，拍一张开始吧。</Text>
          </Card>
        ) : (
          essays.map(essay => (
            <Pressable key={essay.id} onPress={() => onOpen(essay.id)}>
              <Card style={styles.essayRow}>
                <Image source={{uri: essay.imageUri}} style={styles.thumb} />
                <View style={styles.essayMeta}>
                  <Text style={styles.essayTitle}>
                    {essay.title || '未命名作文'}
                  </Text>
                  <Text style={styles.muted}>
                    {new Date(essay.createdAt).toLocaleString()}
                  </Text>
                  <Text
                    style={
                      essay.status === 'failed'
                        ? styles.errorText
                        : styles.status
                    }>
                    {essay.status === 'completed'
                      ? '已完成'
                      : essay.status === 'failed'
                      ? '处理失败，点击重试'
                      : '处理中'}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ManageEssays({
  essays,
  onBack,
  onRefresh,
  onDelete,
  onClearBefore,
}: {
  essays: Essay[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearBefore: (before: Date) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelectedIds(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id],
    );
  const deleteSelected = () => {
    if (!selectedIds.length) {
      return;
    }
    Alert.alert(
      '删除作文',
      `确定删除选中的 ${selectedIds.length} 条作文及其图片吗？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            for (const id of selectedIds) {
              await onDelete(id);
            }
            setSelectedIds([]);
            await onRefresh();
          },
        },
      ],
    );
  };
  const clearBefore = (days: number) =>
    Alert.alert(
      '按时间清理',
      `确定删除 ${days} 天前创建的作文、图片和批改记录吗？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '确认清理',
          style: 'destructive',
          onPress: async () => {
            await onClearBefore(new Date(Date.now() - days * 86400000));
            setSelectedIds([]);
            await onRefresh();
          },
        },
      ],
    );
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onBack}>
            <Text style={styles.back}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.headerTitle}>作文管理</Text>
        </View>
        <Card>
          <Text style={styles.cardTitle}>批量操作</Text>
          <Text style={styles.muted}>
            点选作文后可批量删除；按时间清理只影响作文记录，不会修改系统设置。
          </Text>
          <View style={styles.actionRow}>
            <Button
              title={`删除已选（${selectedIds.length}）`}
              secondary
              disabled={!selectedIds.length}
              onPress={deleteSelected}
            />
            <Button
              title="全选"
              secondary
              onPress={() => setSelectedIds(essays.map(item => item.id))}
            />
          </View>
          <View style={styles.actionRow}>
            {[7, 30, 90].map(days => (
              <Button
                key={days}
                title={`清理 ${days} 天前`}
                secondary
                onPress={() => clearBefore(days)}
              />
            ))}
          </View>
        </Card>
        {essays.length === 0 ? (
          <Card>
            <Text style={styles.muted}>暂无作文记录。</Text>
          </Card>
        ) : (
          essays.map(essay => {
            const selected = selectedIds.includes(essay.id);
            return (
              <Pressable key={essay.id} onPress={() => toggle(essay.id)}>
                <Card
                  style={[
                    styles.manageRow,
                    selected && styles.manageRowSelected,
                  ]}>
                  <View
                    style={[
                      styles.checkbox,
                      selected && styles.checkboxSelected,
                    ]}>
                    {selected && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                  <Image source={{uri: essay.imageUri}} style={styles.thumb} />
                  <View style={styles.essayMeta}>
                    <Text style={styles.essayTitle}>
                      {essay.title || '未命名作文'}
                    </Text>
                    <Text style={styles.muted}>
                      {new Date(essay.createdAt).toLocaleString()}
                    </Text>
                    <Text style={styles.status}>
                      {essay.status === 'completed'
                        ? '已完成'
                        : essay.status === 'failed'
                        ? '处理失败'
                        : '处理中'}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StageOutput({title, value}: {title: string; value: string}) {
  return (
    <View style={styles.stageOutput}>
      <Text style={styles.stageOutputTitle}>{title}</Text>
      <Text style={styles.stageOutputText}>{value || '等待该阶段输出'}</Text>
    </View>
  );
}

function Detail({
  essay,
  onBack,
  onRetry,
}: {
  essay: Essay;
  onBack: () => void;
  onRetry: () => void;
}) {
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [title, setTitle] = useState(essay.title || '');
  const [activeTab, setActiveTab] = useState<'stage' | 'result'>(
    essay.status === 'completed' ? 'result' : 'stage',
  );
  useEffect(() => {
    getSteps(essay.id).then(setSteps);
    const timer = setInterval(() => getSteps(essay.id).then(setSteps), 1200);
    return () => clearInterval(timer);
  }, [essay.id, essay.status]);
  useEffect(() => {
    if (essay.title) {
      setTitle(essay.title);
    }
  }, [essay.title]);
  useEffect(() => {
    setActiveTab(essay.status === 'completed' ? 'result' : 'stage');
  }, [essay.status]);
  const score = useMemo(() => {
    try {
      return essay.scoreJson
        ? (JSON.parse(essay.scoreJson) as ScoreResult)
        : emptyScore;
    } catch (_) {
      return emptyScore;
    }
  }, [essay.scoreJson]);
  const statusText =
    essay.status === 'completed'
      ? '评分完成'
      : essay.status === 'failed'
      ? '处理失败'
      : '正在处理';
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onBack}>
            <Text style={styles.back}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.headerStatus}>{statusText}</Text>
        </View>
        <Card>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(essay.imageUris?.length ? essay.imageUris : [essay.imageUri]).map(
              (uri, index) => (
                <Image
                  key={`${uri}-${index}`}
                  source={{uri}}
                  style={styles.preview}
                />
              ),
            )}
          </ScrollView>
          <TextInput
            style={styles.titleInput}
            value={
              title ||
              (essay.status === 'completed' ? '未命名作文' : '正在识别标题…')
            }
            editable={false}
            accessibilityLabel="作文标题（由 OCR 识别）"
          />
        </Card>
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab('stage')}
            style={[styles.tab, activeTab === 'stage' && styles.activeTab]}>
            <Text
              style={[
                styles.tabText,
                activeTab === 'stage' && styles.activeTabText,
              ]}>
              阶段输出
            </Text>
          </Pressable>
          {essay.status === 'completed' && (
            <Pressable
              onPress={() => setActiveTab('result')}
              style={[styles.tab, activeTab === 'result' && styles.activeTab]}>
              <Text
                style={[
                  styles.tabText,
                  activeTab === 'result' && styles.activeTabText,
                ]}>
                最终结果
              </Text>
            </Pressable>
          )}
        </View>
        {activeTab === 'stage' && (
          <>
            <Progress steps={steps} />
            {essay.status === 'failed' && (
              <Card style={styles.errorCard}>
                <Text style={styles.errorText}>
                  {essay.error || '处理失败'}
                </Text>
                <Button title="重试全部流程" onPress={onRetry} />
              </Card>
            )}
            <Card>
              <Text style={styles.sectionHeading}>阶段输出</Text>
              <StageOutput title="本地 OCR 结果" value={essay.localOcr} />
              <StageOutput title="云端图片识别结果" value={essay.visionOcr} />
              <StageOutput
                title="双路对照后的正文"
                value={essay.canonicalText}
              />
              <StageOutput title="对照说明" value={essay.corrections} />
              <StageOutput
                title="评分阶段状态"
                value={
                  steps.find(item => item.step === 'scoring')?.detail ||
                  '等待处理'
                }
              />
            </Card>
          </>
        )}
        {activeTab === 'result' && essay.status === 'completed' && (
          <>
            <Text style={styles.sectionHeading}>最终结果</Text>
            <Card style={styles.scoreCard}>
              <Text style={styles.scoreLabel}>总评</Text>
              <Text style={styles.score}>
                {score.score}
                <Text style={styles.scoreMax}> / 100</Text>
              </Text>
              <Text style={styles.band}>{score.bandName || score.bandId}</Text>
              <Text style={styles.body}>{score.summary}</Text>
            </Card>
            {score.dimensionFeedback && (
              <Card>
                <Text style={styles.cardTitle}>各部分优缺点与改进</Text>
                {[
                  ['thesis', '审题与立意'],
                  ['content', '内容与选材'],
                  ['structure', '结构与技法'],
                  ['language', '语言与表达'],
                  ['format', '书写与规范'],
                ].map(([key, label]) => {
                  const feedback = score.dimensionFeedback?.[key];
                  return feedback ? (
                    <View key={key} style={styles.feedbackBlock}>
                      <Text style={styles.feedbackTitle}>{label}</Text>
                      <Text style={styles.feedbackLine}>
                        优点：{feedback.strengths.join('；') || '暂无'}
                      </Text>
                      <Text style={styles.feedbackLine}>
                        问题：{feedback.weaknesses.join('；') || '暂无'}
                      </Text>
                      <Text style={styles.feedbackImprove}>
                        改进：{feedback.improvements.join('；')}
                      </Text>
                    </View>
                  ) : null;
                })}
              </Card>
            )}
            {!!score.paragraphReviews?.length && (
              <Card>
                <Text style={styles.cardTitle}>分段批注</Text>
                {score.paragraphReviews.map(review => (
                  <View
                    key={review.paragraphIndex}
                    style={styles.feedbackBlock}>
                    <Text style={styles.feedbackTitle}>
                      第 {review.paragraphIndex} 段
                    </Text>
                    <Text style={styles.feedbackLine}>
                      优点：{review.strengths.join('；') || '暂无'}
                    </Text>
                    <Text style={styles.feedbackLine}>
                      问题：{review.weaknesses.join('；') || '暂无'}
                    </Text>
                    <Text style={styles.feedbackImprove}>
                      改进：{review.improvements.join('；')}
                    </Text>
                  </View>
                ))}
              </Card>
            )}
            <Card>
              <Text style={styles.cardTitle}>分项评分</Text>
              {[
                ['thesis', '审题与立意', 25],
                ['content', '内容与选材', 25],
                ['structure', '结构与技法', 20],
                ['language', '语言与表达', 20],
                ['format', '书写与规范', 10],
              ].map(([key, label, max]) => (
                <View key={String(key)} style={styles.metric}>
                  <View style={styles.metricLabel}>
                    <Text style={styles.body}>{label}</Text>
                    <Text style={styles.metricValue}>
                      {score.dimensionScores?.[String(key)] || 0}/{String(max)}
                    </Text>
                  </View>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(
                            100,
                            ((score.dimensionScores?.[String(key)] || 0) /
                              Number(max)) *
                              100,
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </Card>
            <BulletCard
              title="写得好的地方"
              values={score.strengths}
              color="#15803d"
            />
            <BulletCard
              title="需要改进"
              values={score.weaknesses.concat(score.improvements)}
              color="#b45309"
            />
            <BulletCard
              title="下一步建议"
              values={score.suggestions}
              color="#2563eb"
            />
            <Card>
              <Text style={styles.cardTitle}>原文批注</Text>
              {score.annotations.length ? (
                score.annotations.map((annotation, index) => (
                  <View
                    key={`${annotation.quote}-${index}`}
                    style={styles.annotation}>
                    <Text style={styles.quote}>“{annotation.quote}”</Text>
                    <Text style={styles.annotationComment}>
                      {annotation.comment}
                    </Text>
                    <Text style={styles.annotationSuggestion}>
                      修改：{annotation.suggestion}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.muted}>模型没有返回可定位批注。</Text>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BulletCard({
  title,
  values,
  color,
}: {
  title: string;
  values: string[];
  color: string;
}) {
  return (
    <Card>
      <Text style={[styles.cardTitle, {color}]}>{title}</Text>
      {values.length ? (
        values.map((value, index) => (
          <Text style={styles.bullet} key={`${value}-${index}`}>
            • {value}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>暂无</Text>
      )}
    </Card>
  );
}

function Settings({
  value,
  onSave,
  onBack,
  onClear,
}: {
  value: AppSettings;
  onSave: (value: AppSettings) => Promise<void>;
  onBack: () => void;
  onClear: () => Promise<void>;
}) {
  const [settings, setSettings] = useState(value);
  const [clearing, setClearing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thresholdPercent, setThresholdPercent] = useState(
    String(value.compactionThreshold * 100),
  );
  const field = (
    key: keyof AppSettings,
    label: string,
    keyboardType: any = 'default',
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        value={String(settings[key])}
        onChangeText={text => setSettings({...settings, [key]: text})}
        style={styles.input}
        placeholder={label}
      />
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onBack}>
            <Text style={styles.back}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.headerTitle}>系统设置</Text>
        </View>
        {field('apiBaseUrl', 'API 地址')}
        {field('apiKey', 'Token（API Key）')}
        {field('modelName', '模型名称')}
        <Text style={styles.muted}>
          图片识别、文字校对和评分共用此云端模型，请选择支持图片输入的模型。本地
          OCR 无需配置。
        </Text>
        {field(
          'contextWindow',
          '上下文大小（token，1M = 1,000,000）',
          'numeric',
        )}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>输出长度（token）</Text>
          <Text style={styles.muted}>
            包含模型思考和最终结果；当前默认 32K。
          </Text>
          <View style={styles.actionRow}>
            {OUTPUT_TOKEN_OPTIONS.map(item => (
              <Button
                key={item}
                title={`${item / 1000}K`}
                secondary={Number(settings.maxOutputTokens) !== item}
                onPress={() =>
                  setSettings({...settings, maxOutputTokens: item})
                }
              />
            ))}
          </View>
        </View>
        {field('retryCount', '失败重试次数（0 表示不重试）', 'numeric')}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            思考级别：
            {settings.reasoningEffort === 'none'
              ? '关闭'
              : settings.reasoningEffort}
          </Text>
          <View style={styles.actionRow}>
            {REASONING_LEVELS.map(item => (
              <Button
                key={item}
                title={item === 'none' ? '关闭' : item}
                secondary={settings.reasoningEffort !== item}
                onPress={() =>
                  setSettings({...settings, reasoningEffort: item})
                }
              />
            ))}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            上下文压缩阈值（%，只压缩历史参考内容，保留作文原文）
          </Text>
          <TextInput
            value={thresholdPercent}
            onChangeText={setThresholdPercent}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <View style={styles.actionRow}>
            {[0.7, 0.8, 0.9].map(item => (
              <Button
                key={item}
                title={`${item * 100}%`}
                secondary={Number(thresholdPercent) !== item * 100}
                onPress={() => setThresholdPercent(String(item * 100))}
              />
            ))}
          </View>
        </View>
        <View style={styles.privacy}>
          <Text style={styles.muted}>
            作文数据保存在本机；识别和评分时会将作文内容发送至你配置的 API。
          </Text>
        </View>
        <Button
          title={saving ? '保存中…' : '保存设置'}
          disabled={saving}
          onPress={async () => {
            setSaving(true);
            try {
              const validated = validateSettings({
                ...settings,
                compactionThreshold: Number(thresholdPercent) / 100,
              });
              await onSave(validated);
              onBack();
            } catch (error) {
              Alert.alert(
                '无法保存设置',
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              setSaving(false);
            }
          }}
        />
        <Card style={styles.dangerCard}>
          <Text style={styles.cardTitle}>清理应用日志与临时缓存</Text>
          <Text style={styles.muted}>
            清理流程日志和临时缓存，不会删除作文记录、作文图片、API
            配置、模型配置或评分规则。
          </Text>
          <Button
            title={clearing ? '清理中…' : '清理日志与缓存'}
            secondary
            disabled={clearing}
            onPress={() =>
              Alert.alert('确认清理', '此操作会删除应用日志和临时缓存。', [
                {text: '取消', style: 'cancel'},
                {
                  text: '确认清理',
                  style: 'destructive',
                  onPress: async () => {
                    setClearing(true);
                    try {
                      await onClear();
                      Alert.alert('已完成', '应用日志和临时缓存已清理。');
                    } finally {
                      setClearing(false);
                    }
                  },
                },
              ])
            }
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return <Startup>{data => <ReadyApp initialData={data} />}</Startup>;
}

function ReadyApp({initialData}: {initialData: StartupData}) {
  const [essays, setEssays] = useState(initialData.essays);
  const [selected, setSelected] = useState<Essay>();
  const selectedId = selected?.id;
  const [settings, setSettings] = useState(initialData.settings);
  const [screen, setScreen] = useState<
    'home' | 'detail' | 'settings' | 'manage'
  >('home');

  const refresh = async () => setEssays(await listEssays());
  useEffect(() => {
    if (screen !== 'detail' || !selectedId) {
      return;
    }
    const timer = setInterval(() => {
      getEssay(selectedId).then(value => value && setSelected(value));
    }, 1200);
    return () => clearInterval(timer);
  }, [screen, selectedId]);
  const chooseCrop = (): Promise<CropPreset | undefined> =>
    new Promise(resolve => {
      Alert.alert('处理图片', '可以保留原图，也可以进行居中裁剪。', [
        {text: '保留原图', onPress: () => resolve(undefined)},
        {text: '裁剪为方形', onPress: () => resolve('square')},
        {text: '裁剪为 4:3', onPress: () => resolve('landscape')},
      ]);
    });
  const prepareAsset = async (asset: Asset | undefined) => {
    if (!asset?.uri) {
      return undefined;
    }
    const uri = asset.uri;
    const preset = await chooseCrop();
    try {
      return preset
        ? await cropImage(uri, asset, preset)
        : await persistImage(uri, asset);
    } catch (error) {
      Alert.alert(
        '裁剪失败',
        `${
          error instanceof Error ? error.message : String(error)
        }\n将使用原图继续。`,
      );
      return persistImage(uri, asset);
    }
  };
  const askContinueCamera = () =>
    new Promise<boolean>(resolve => {
      Alert.alert('照片已加入', '还要继续拍摄下一页吗？', [
        {text: '完成', onPress: () => resolve(false)},
        {text: '继续拍摄', onPress: () => resolve(true)},
      ]);
    });
  const cameraPermission = async () => {
    if (Platform.OS !== 'android') {
      return true;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: '相机权限',
        message: '需要使用相机拍摄作文图片。',
        buttonPositive: '允许',
        buttonNegative: '拒绝',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };
  const capture = async (camera: boolean) => {
    try {
      if (camera && !(await cameraPermission())) {
        Alert.alert(
          '无法打开相机',
          '相机权限未授权，请在系统设置中允许相机权限。',
        );
        return;
      }
      const imageUris: string[] = [];
      if (camera) {
        let continueCapturing = true;
        while (continueCapturing) {
          const result = await launchCamera({
            mediaType: 'photo',
            cameraType: 'back',
            includeBase64: false,
            maxWidth: 2200,
            maxHeight: 2200,
            quality: 0.9,
            saveToPhotos: false,
          });
          if (result.errorCode) {
            throw new Error(
              result.errorMessage || `相机错误：${result.errorCode}`,
            );
          }
          const uri = await prepareAsset(result.assets?.[0]);
          if (uri) {
            imageUris.push(uri);
          }
          if (!uri || result.didCancel) {
            break;
          }
          continueCapturing = await askContinueCamera();
        }
      } else {
        const result = await launchImageLibrary({
          mediaType: 'photo',
          includeBase64: false,
          maxWidth: 2200,
          maxHeight: 2200,
          quality: 0.9,
          selectionLimit: 0,
          assetRepresentationMode: 'compatible',
        });
        if (result.errorCode) {
          throw new Error(
            result.errorMessage || `图片选择错误：${result.errorCode}`,
          );
        }
        for (const asset of result.assets || []) {
          const uri = await prepareAsset(asset);
          if (uri) {
            imageUris.push(uri);
          }
        }
      }
      if (!imageUris.length) {
        return;
      }
      const essay = await createEssay(imageUris);
      setSelected(essay);
      setScreen('detail');
      await refresh();
      runEssayPipeline(essay).then(refresh).catch(refresh);
    } catch (error) {
      Alert.alert(
        '无法获取图片',
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  if (screen === 'settings') {
    return (
      <Settings
        value={settings}
        onSave={async value => {
          await saveSettings(value);
          setSettings(value);
        }}
        onClear={clearLogsAndCache}
        onBack={() => setScreen('home')}
      />
    );
  }
  if (screen === 'manage') {
    return (
      <ManageEssays
        essays={essays}
        onBack={() => setScreen('home')}
        onRefresh={refresh}
        onDelete={deleteEssay}
        onClearBefore={clearEssaysBefore}
      />
    );
  }
  if (screen === 'detail' && selected) {
    return (
      <Detail
        essay={selected}
        onBack={() => {
          setScreen('home');
          refresh();
        }}
        onRetry={() =>
          retryEssay(selected.id)
            .then(async () => {
              setSelected(await getEssay(selected.id));
              refresh();
            })
            .catch(async () => setSelected(await getEssay(selected.id)))
        }
      />
    );
  }
  return (
    <Home
      essays={essays}
      onCapture={capture}
      onOpen={async id => {
        setSelected(await getEssay(id));
        setScreen('detail');
      }}
      onSettings={() => setScreen('settings')}
      onManage={() => setScreen('manage')}
    />
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f7f8fc'},
  container: {padding: 20, paddingBottom: 48},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: 14},
  headerAction: {paddingVertical: 6},
  headerActionText: {fontSize: 15, color: '#2563eb', fontWeight: '700'},
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#64748b',
    fontWeight: '700',
  },
  title: {fontSize: 30, fontWeight: '800', color: '#0f172a'},
  subtitle: {fontSize: 15, lineHeight: 23, color: '#64748b', marginBottom: 18},
  settingsIcon: {fontSize: 25, color: '#475569'},
  back: {fontSize: 16, color: '#2563eb', fontWeight: '700'},
  headerTitle: {fontSize: 18, fontWeight: '800', color: '#0f172a'},
  headerStatus: {fontSize: 13, color: '#64748b'},
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 2,
  },
  captureCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
  },
  captureTitle: {
    fontSize: 18,
    color: '#1e3a8a',
    fontWeight: '800',
    marginBottom: 5,
  },
  actionRow: {flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap'},
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 11,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
  },
  disabled: {opacity: 0.45},
  buttonText: {color: '#fff', fontWeight: '800'},
  secondaryButtonText: {color: '#2563eb'},
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
    marginTop: 8,
  },
  muted: {fontSize: 13, color: '#64748b', lineHeight: 20},
  essayRow: {flexDirection: 'row', alignItems: 'center', padding: 12},
  manageRow: {flexDirection: 'row', alignItems: 'center', padding: 12},
  manageRowSelected: {
    borderWidth: 1,
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxSelected: {borderColor: '#2563eb', backgroundColor: '#2563eb'},
  checkboxMark: {color: '#fff', fontWeight: '900'},
  thumb: {width: 62, height: 78, borderRadius: 9, backgroundColor: '#e2e8f0'},
  essayMeta: {flex: 1, marginLeft: 12},
  essayTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  status: {fontSize: 12, color: '#2563eb', marginTop: 5},
  chevron: {fontSize: 30, color: '#94a3b8'},
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  stepRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8},
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#cbd5e1',
    marginRight: 12,
  },
  successDot: {backgroundColor: '#16a34a'},
  runningDot: {backgroundColor: '#2563eb'},
  errorDot: {backgroundColor: '#dc2626'},
  stepText: {flex: 1},
  stepName: {fontSize: 14, fontWeight: '700', color: '#334155'},
  stepDetail: {fontSize: 12, color: '#94a3b8', marginTop: 2},
  errorText: {color: '#dc2626', fontSize: 13},
  errorCard: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff7f7',
  },
  preview: {
    width: 280,
    height: 320,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    resizeMode: 'contain',
  },
  titleInput: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 10,
    marginTop: 8,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 9,
  },
  activeTab: {backgroundColor: '#fff', elevation: 1},
  tabText: {fontSize: 14, color: '#64748b', fontWeight: '700'},
  activeTabText: {color: '#1d4ed8'},
  sectionHeading: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  stageOutput: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
    marginTop: 10,
  },
  stageOutputTitle: {fontSize: 14, fontWeight: '800', color: '#334155'},
  stageOutputText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#475569',
    marginTop: 5,
  },
  feedbackBlock: {
    borderLeftWidth: 3,
    borderLeftColor: '#93c5fd',
    paddingLeft: 12,
    marginBottom: 15,
  },
  feedbackTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e3a8a',
    marginBottom: 5,
  },
  feedbackLine: {fontSize: 13, lineHeight: 20, color: '#475569'},
  feedbackImprove: {
    fontSize: 13,
    lineHeight: 20,
    color: '#b45309',
    marginTop: 3,
  },
  body: {fontSize: 14, lineHeight: 22, color: '#334155'},
  essayText: {fontSize: 15, lineHeight: 26, color: '#1e293b'},
  scoreCard: {backgroundColor: '#172554'},
  scoreLabel: {color: '#bfdbfe', fontSize: 13, fontWeight: '700'},
  score: {fontSize: 52, color: '#fff', fontWeight: '900', marginTop: 2},
  scoreMax: {fontSize: 18, color: '#bfdbfe', fontWeight: '500'},
  band: {color: '#93c5fd', fontSize: 15, fontWeight: '800', marginBottom: 12},
  metric: {marginBottom: 12},
  metricLabel: {flexDirection: 'row', justifyContent: 'space-between'},
  metricValue: {fontSize: 13, color: '#2563eb', fontWeight: '800'},
  bar: {
    height: 7,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: {height: 7, backgroundColor: '#2563eb', borderRadius: 4},
  bullet: {fontSize: 14, lineHeight: 23, color: '#334155', marginBottom: 4},
  annotation: {
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    paddingLeft: 12,
    marginBottom: 14,
  },
  quote: {fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 5},
  annotationComment: {fontSize: 14, lineHeight: 21, color: '#475569'},
  annotationSuggestion: {
    fontSize: 13,
    lineHeight: 20,
    color: '#b45309',
    marginTop: 4,
  },
  field: {marginBottom: 15},
  fieldLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#0f172a',
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  dangerCard: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff7f7',
  },
});
