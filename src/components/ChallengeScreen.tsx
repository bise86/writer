import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Pdf from 'react-native-pdf';
import {
  Asset,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import {AppSettings} from '../types';
import {
  ChallengeLevel,
  ChallengeRecord,
  ChallengeReviewRound,
  ChallengeSource,
  SubjectVerification,
} from '../challenge/types';
import {
  createChallenge,
  deleteChallenge,
  getChallenge,
  listChallenges,
} from '../challenge/store';
import {
  cancelChallengeTask,
  getChallengeTask,
  startChallengeTask,
  subscribeChallengeTasks,
} from '../challenge/tasks';
import {CHALLENGE_STATUS_LABELS as STATUS_LABELS} from '../challenge/presentation';
import {
  challengeReviewRoleLabel,
  getChallengeReviewRoles,
  hasPassedChallengeReview,
} from '../challenge/review';
import {
  discardChallengePdf,
  pickChallengePdf,
  saveChallengePdf,
} from '../challenge/documents';
import {getChallengePolicy} from '../challenge/rules';
import ImageViewer from './ImageViewer';
import {
  challengeCoverage,
  isRetainedQuestion,
  minimumUpgradePercent,
  sourceRequiresRetention,
} from '../challenge/selection';
type ChallengeTab =
  | 'original'
  | 'analysis'
  | 'plan'
  | 'paper'
  | 'answers'
  | 'usage';
import ChallengeManager from './ChallengeManager';
import ChallengeUsageDetails from './ChallengeUsageDetails';

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

function SubjectVerificationSummary({
  verification,
}: {
  verification: SubjectVerification;
}) {
  const votes = verification.votes || [];
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(
      vote.subject === 'unknown' ? '待确认' : vote.courseName,
      (counts.get(vote.subject === 'unknown' ? '待确认' : vote.courseName) ||
        0) + 1,
    );
  }
  return (
    <View style={styles.review}>
      <Text style={styles.label}>识科核验</Text>
      <Text style={styles.body}>
        {verification.mode === 'progressive'
          ? '先抽3题；不一致时每次追加1题，形成严格多数后停止。'
          : '历史识科记录'}
      </Text>
      <Text style={styles.muted}>
        已抽 {verification.samples.length} 题
        {votes.length
          ? ` · ${[...counts]
              .map(([name, count]) => `${name} ${count}票`)
              .join(' · ')}`
          : ''}
      </Text>
      {!!verification.samples.length && (
        <Text style={styles.muted}>
          抽中题号：
          {verification.samples
            .map(sample => sample.selectedQuestionNumber)
            .join('、')}
        </Text>
      )}
      {verification.mode === 'expanded' && (
        <Text style={styles.muted}>{verification.expansionReason}</Text>
      )}
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}

function Card({
  children,
  fill = false,
}: {
  children: React.ReactNode;
  fill?: boolean;
}) {
  return <View style={[styles.card, fill && styles.fill]}>{children}</View>;
}

function TabContent({
  fixed,
  children,
}: {
  fixed: boolean;
  children: React.ReactNode;
}) {
  return fixed ? (
    <View style={styles.previewContent}>{children}</View>
  ) : (
    <ScrollView contentContainerStyle={styles.container}>{children}</ScrollView>
  );
}

function draftUsesRecord(sources: ChallengeSource[], record: ChallengeRecord) {
  const recordFiles = new Set([
    ...record.pageUris,
    ...record.sources.flatMap(source => [source.uri, ...source.pageUris]),
  ]);
  return sources.some(source =>
    [source.uri, ...source.pageUris].some(uri => recordFiles.has(uri)),
  );
}

type ReviewSize = AppSettings['roundtableSize'];

function reviewModeLabel(size?: ReviewSize) {
  return size === 0
    ? '0 · 基础综合校核（1 个角色）'
    : size === 3 || size === 5
    ? `${size} 角色圆桌评审`
    : '历史评审（人数未记录）';
}

function ReviewRoundSummary({
  round,
  record,
  showDetails,
}: {
  round: ChallengeReviewRound;
  record: ChallengeRecord;
  showDetails: boolean;
}) {
  const size = round.roundtableSize ?? record.reviewRoundtableSize;
  const planned =
    size === undefined ? undefined : getChallengeReviewRoles(size);
  const roles = planned || [...new Set(round.reviews.map(item => item.role))];
  const completed = roles.filter(role =>
    round.reviews.some(item => item.role === role),
  ).length;
  const approved = round.reviews.filter(
    item => item.verdict === 'approve' && !item.issues.length,
  ).length;
  const revisions = round.reviews.length - approved;
  const passed = hasPassedChallengeReview(record, round);
  const historicalCandidate =
    round.candidateRevision !== record.candidateRevision;
  return (
    <View style={styles.question}>
      <Text style={styles.label}>{`第 ${round.round} 轮 · ${reviewModeLabel(
        size,
      )}`}</Text>
      <Text style={styles.body}>
        {planned
          ? `已完成 ${completed} / ${planned.length} 个角色`
          : `已记录 ${round.reviews.length} 份报告`}
      </Text>
      <Text style={passed ? styles.notice : styles.muted}>
        {passed
          ? planned
            ? '本轮全部通过'
            : '已有报告均通过'
          : `通过 ${approved} · 需修订 ${revisions}${
              planned ? ` · 待完成 ${planned.length - completed}` : ''
            }`}
      </Text>
      {historicalCandidate && (
        <Text style={styles.muted}>该轮针对修订前的候选试卷。</Text>
      )}
      {!historicalCandidate &&
        !passed &&
        !revisions &&
        completed === roles.length && (
          <Text style={styles.muted}>
            评审记录尚未完整，完成全部角色校核后再生成 PDF。
          </Text>
        )}
      {revisions > 0 && (
        <Text style={styles.muted}>
          修复后开启下一轮，本轮所有角色都会重新评审。
        </Text>
      )}
      {roles.map(role => {
        const review = round.reviews.find(item => item.role === role);
        const roleLabel = challengeReviewRoleLabel(
          role,
          size ?? (roles.length === 1 ? 0 : 5),
        );
        return (
          <View key={role} style={styles.review}>
            <Text style={styles.body}>
              {`${roleLabel}：${
                !review
                  ? '待完成'
                  : review.verdict === 'approve' && !review.issues.length
                  ? '通过'
                  : '需修订'
              }`}
            </Text>
            {review && showDetails && (
              <Text style={styles.muted}>{review.summary}</Text>
            )}
            {!!review?.issues.length && !showDetails && (
              <Text style={styles.muted}>
                本轮记录 {review.issues.length} 项修订意见。
              </Text>
            )}
            {showDetails &&
              review?.issues.map((issue, index) => (
                <Text key={index} style={styles.muted}>
                  {issue.questionId === '*'
                    ? '全卷'
                    : `题目 ${issue.questionId}`}
                  ：{issue.comment}；修改：{issue.fix}
                </Text>
              ))}
          </View>
        );
      })}
    </View>
  );
}

function hasReadyPdfs(record?: ChallengeRecord) {
  if (
    record?.status !== 'completed' ||
    !record.paperPdfUri ||
    !record.answersPdfUri
  ) {
    return false;
  }
  return hasPassedChallengeReview(record);
}

export default function ChallengeScreen({
  settings,
  onBack,
  onSettings,
  initialChallengeId,
  onSelectionChange,
}: {
  settings: AppSettings;
  onBack: () => void;
  onSettings: () => void;
  initialChallengeId?: string;
  onSelectionChange?: (id?: string) => void;
}) {
  const [records, setRecords] = useState<ChallengeRecord[]>([]);
  const [record, setRecord] = useState<ChallengeRecord>();
  const [sources, setSources] = useState<ChallengeSource[]>([]);
  const [level, setLevel] = useState<ChallengeLevel>(1);
  const [activeTab, setActiveTab] = useState<ChallengeTab>('original');
  const [localBusy, setBusy] = useState<
    'import' | 'analysis' | 'upgrade' | 'save' | 'open'
  >();
  const [panel, setPanel] = useState<'main' | 'manage'>('main');
  const [, setTaskVersion] = useState(0);
  const task = record ? getChallengeTask(record.id) : undefined;
  const busy = localBusy || task?.kind;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [pdfPage, setPdfPage] = useState('');
  const [imagePreview, setImagePreview] = useState<{
    uris: string[];
    index: number;
  }>();
  const mounted = useRef(true);
  const lock = useRef(false);
  const epoch = useRef(0);
  const historyRequest = useRef(0);
  const pendingSources = useRef(sources);
  const copyingSources = useRef(false);
  const resumeId = useRef(initialChallengeId);
  const selectedId = useRef(record?.id);
  pendingSources.current = sources;
  selectedId.current = record?.id;
  const discardImports = async (values: ChallengeSource[]) => {
    await Promise.all(
      values.map(source => discardChallengePdf(source).catch(() => undefined)),
    );
  };

  const refresh = async () => {
    const request = ++historyRequest.current;
    try {
      const values = await listChallenges();
      if (mounted.current && request === historyRequest.current) {
        setRecords(
          values.map(value => getChallengeTask(value.id)?.record || value),
        );
        setListError('');
      }
    } catch (reason) {
      if (mounted.current && request === historyRequest.current) {
        setListError(`挑战记录读取失败：${errorText(reason)}`);
      }
    } finally {
      if (mounted.current && request === historyRequest.current) {
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    refresh();
    if (resumeId.current) {
      const request = epoch.current;
      getChallenge(resumeId.current)
        .then(value => {
          const latest = getChallengeTask(resumeId.current!)?.record || value;
          if (mounted.current && request === epoch.current && latest) {
            selectedId.current = latest.id;
            setRecord(latest);
            setLevel(latest.level);
            setActiveTab(
              hasReadyPdfs(latest)
                ? 'paper'
                : latest.analysis
                ? 'analysis'
                : 'original',
            );
          }
        })
        .catch(reason => {
          if (mounted.current && request === epoch.current) {
            setError(`无法恢复上次挑战：${errorText(reason)}`);
          }
        });
    }
    return () => {
      mounted.current = false;
      epoch.current += 1;
      if (!copyingSources.current) {
        discardImports(pendingSources.current);
      }
    };
    // The initial history load is independent of model settings.
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeChallengeTasks((id, value) => {
      if (!mounted.current) {
        return;
      }
      setTaskVersion(version => version + 1);
      if (value) {
        if (selectedId.current === id) {
          setRecord(value);
        }
        setRecords(values =>
          values
            .map(previous => (previous.id === id ? value : previous))
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt),
            ),
        );
      } else {
        // Load newly created records and final states, including work started
        // before this screen was mounted.
        refresh();
      }
    });
    return unsubscribe;
    // A task subscription follows the screen, not its current settings/selection.
  }, []);

  const leave = () => {
    if (panel !== 'main') {
      setPanel('main');
      return;
    }
    epoch.current += 1;
    onBack();
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (imagePreview) {
          setImagePreview(undefined);
        } else {
          leave();
        }
        return true;
      },
    );
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, imagePreview, panel]);

  const begin = (operation: NonNullable<typeof busy>) => {
    if (lock.current) {
      return undefined;
    }
    lock.current = true;
    const request = ++epoch.current;
    setBusy(operation);
    setError('');
    setNotice('');
    return request;
  };
  const current = (request: number) =>
    mounted.current && request === epoch.current;
  const finish = (request: number) => {
    if (current(request)) {
      lock.current = false;
      setBusy(undefined);
    }
  };
  const appendAssets = (assets: Asset[]) => {
    const selected: ChallengeSource[] = assets.map((asset, index) => {
      if (!asset.uri) {
        throw new Error('有一张图片无法读取，请重新选择');
      }
      return {
        kind: 'image',
        name: asset.fileName || `试卷照片 ${sources.length + index + 1}`,
        uri: asset.uri,
        pageUris: [asset.uri],
      };
    });
    setSources(values => [...values, ...selected]);
  };
  const addImages = async (camera: boolean) => {
    const request = begin('import');
    if (request === undefined) {
      return;
    }
    try {
      if (camera && Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: '相机权限',
            message: '需要使用相机拍摄试卷。',
            buttonPositive: '允许',
            buttonNegative: '拒绝',
          },
        );
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new Error('相机权限未授权，请在系统设置中允许相机权限。');
        }
      }
      if (!current(request)) {
        return;
      }
      const options = {
        mediaType: 'photo' as const,
        includeBase64: false,
        quality: 1 as const,
        maxWidth: 3200,
        maxHeight: 4400,
      };
      const result = camera
        ? await launchCamera({
            ...options,
            cameraType: 'back',
            saveToPhotos: false,
          })
        : await launchImageLibrary({
            ...options,
            selectionLimit: 0,
            assetRepresentationMode: 'compatible',
          });
      if (!current(request) || result.didCancel) {
        return;
      }
      if (result.errorCode) {
        throw new Error(
          result.errorMessage || `图片获取失败：${result.errorCode}`,
        );
      }
      if (result.assets?.length) {
        appendAssets(result.assets);
      }
    } catch (reason) {
      if (current(request)) {
        setError(errorText(reason));
      }
    } finally {
      finish(request);
    }
  };
  const addPdf = async () => {
    const request = begin('import');
    if (request === undefined) {
      return;
    }
    try {
      const source = await pickChallengePdf();
      if (current(request) && source) {
        setSources(values => [...values, source]);
      } else if (source) {
        await discardChallengePdf(source);
      }
    } catch (reason) {
      if (current(request)) {
        setError(errorText(reason));
      }
    } finally {
      finish(request);
    }
  };
  const run = async (upgrade: boolean) => {
    if (record && getChallengeTask(record.id)) {
      return;
    }
    const request = begin(upgrade ? 'upgrade' : 'analysis');
    if (request === undefined) {
      return;
    }
    let signal: AbortSignal | undefined;
    setActiveTab(upgrade ? 'plan' : 'analysis');
    setPreviewError('');
    try {
      let active = record;
      if (!active) {
        copyingSources.current = true;
        try {
          active = await createChallenge(sources);
        } finally {
          copyingSources.current = false;
          if (!mounted.current) {
            await discardImports(sources);
          }
        }
        await discardImports(sources);
        pendingSources.current = [];
        onSelectionChange?.(active.id);
        if (current(request)) {
          selectedId.current = active.id;
          setRecord(active);
          setSources([]);
        }
      }
      const promise = startChallengeTask(
        active.id,
        upgrade ? 'upgrade' : 'analysis',
        settings,
        upgrade ? level : undefined,
      );
      signal = getChallengeTask(active.id)?.signal;
      // File operations lock the view; model work stays with the app task.
      finish(request);
      const result = await promise;
      if (current(request)) {
        setRecord(result);
        setPreviewError('');
        setPreviewError('');
        setPdfPage('');
        if (result.error) {
          setError(result.error);
        }
      }
    } catch (reason) {
      if (current(request)) {
        if (signal?.aborted) {
          setNotice('已停止处理，已保存的试卷与进度会保留。');
        } else {
          setError(errorText(reason));
        }
      }
    } finally {
      finish(request);
      if (mounted.current) {
        await refresh();
      }
    }
  };
  const open = async (id: string) => {
    const request = begin('open');
    if (request === undefined) {
      return;
    }
    try {
      const saved = await getChallenge(id);
      if (current(request)) {
        if (!saved) {
          throw new Error('这份挑战已删除，请刷新记录。');
        }
        await discardImports(sources);
        if (!current(request)) {
          return;
        }
        const value = getChallengeTask(id)?.record || saved;
        setRecord(value);
        selectedId.current = value.id;
        onSelectionChange?.(value.id);
        setLevel(value.level);
        setSources([]);
        setPreviewError('');
        setPreviewError('');
        setPdfPage('');
        setPanel('main');
        setActiveTab(value.analysis ? 'analysis' : 'original');
      }
    } catch (reason) {
      if (current(request)) {
        setError(errorText(reason));
      }
    } finally {
      finish(request);
    }
  };
  const download = async (answers: boolean) => {
    const request = begin('save');
    if (request === undefined) {
      return;
    }
    try {
      const uri = answers ? record?.answersPdfUri : record?.paperPdfUri;
      if (!uri || !hasReadyPdfs(record)) {
        throw new Error('试卷校核完成并生成 PDF 后才能下载。');
      }
      const saved = await saveChallengePdf(
        uri,
        `${record!.title || '挑战'}_升${record!.level}档_${
          answers ? '答案' : '试卷'
        }.pdf`,
      );
      if (current(request) && saved) {
        setNotice(`${answers ? '答案' : '试卷'} PDF 已保存到所选位置。`);
      }
    } catch (reason) {
      if (current(request)) {
        setError(`下载失败：${errorText(reason)}`);
      }
    } finally {
      finish(request);
    }
  };
  const deleteRecords = async (ids: string[]) => {
    if (!mounted.current) {
      return;
    }
    // Recheck the current draft when a confirmation is accepted.
    if (
      records.some(
        value =>
          ids.includes(value.id) &&
          draftUsesRecord(pendingSources.current, value),
      )
    ) {
      throw new Error(
        '这份记录正用于补充页面。请先完成解析，或移除待解析的原卷页面后再删除。',
      );
    }
    const request = begin('open');
    if (request === undefined) {
      throw new Error('正在保存或读取文件，请稍后再删除。');
    }
    try {
      for (const id of ids) {
        cancelChallengeTask(id);
        await deleteChallenge(id);
        if (selectedId.current === id) {
          selectedId.current = undefined;
          onSelectionChange?.(undefined);
          if (mounted.current) {
            setRecord(undefined);
            setActiveTab('original');
          }
        }
      }
    } finally {
      await refresh();
      finish(request);
    }
  };
  const newChallenge = () => {
    if (lock.current) {
      return;
    }
    epoch.current += 1;
    selectedId.current = undefined;
    setRecord(undefined);
    setActiveTab('original');
    onSelectionChange?.(undefined);
    setSources([]);
    setLevel(1);
    setError('');
    setNotice('');
    setPreviewError('');
  };
  const removeSource = async (index: number) => {
    const request = begin('import');
    if (request === undefined) {
      return;
    }
    const source = sources[index];
    setSources(values =>
      values.filter((_, sourceIndex) => sourceIndex !== index),
    );
    try {
      if (source) {
        await discardChallengePdf(source);
      }
    } finally {
      finish(request);
    }
  };
  const showSettings = async () => {
    if (record || !sources.length) {
      onSettings();
      return;
    }
    const request = begin('open');
    if (request === undefined) {
      return;
    }
    copyingSources.current = true;
    try {
      const saved = await createChallenge(sources);
      await discardImports(sources);
      if (current(request)) {
        pendingSources.current = [];
        setSources([]);
        setRecord(saved);
        onSelectionChange?.(saved.id);
        onSettings();
      }
    } catch (reason) {
      if (current(request)) {
        setError(`无法保存待解析试卷：${errorText(reason)}`);
      }
    } finally {
      copyingSources.current = false;
      if (!mounted.current) {
        await discardImports(sources);
      }
      finish(request);
    }
  };

  const analysis = record?.analysis;
  const identification = record?.subjectIdentification;
  const confirmedSubject =
    analysis &&
    identification?.status === 'confirmed' &&
    analysis.subjectIdentification?.status === 'confirmed' &&
    identification.subject === analysis.subject &&
    analysis.subjectIdentification.subject === analysis.subject &&
    identification.courseName === analysis.subjectIdentification.courseName
      ? analysis.subject
      : undefined;
  let policy: ReturnType<typeof getChallengePolicy> | undefined;
  let policyError = '';
  if (confirmedSubject) {
    try {
      policy = getChallengePolicy(confirmedSubject, level);
    } catch (reason) {
      policyError = errorText(reason);
    }
  }
  const coverage = analysis ? challengeCoverage(analysis, level) : undefined;
  const canUpgrade =
    !!analysis &&
    !!confirmedSubject &&
    !!policy &&
    !analysis.unresolvedIssues.length &&
    !!coverage?.total &&
    coverage.eligible >= coverage.required;
  const pageUris =
    record?.pageUris || sources.flatMap(source => source.pageUris);
  const pdfReady = hasReadyPdfs(record);
  const pdfUri =
    activeTab === 'answers' ? record?.answersPdfUri : record?.paperPdfUri;
  const pdfKey = `${record?.id}-${activeTab}-${pdfUri}-${previewAttempt}`;
  const activePdfKey = useRef(pdfKey);
  activePdfKey.current = pdfKey;
  const finalCoverage =
    analysis && record?.candidate
      ? challengeCoverage(analysis, record.candidate.level, record.candidate)
      : undefined;
  const tabs: [ChallengeTab, string][] = [
    ['original', '原卷'],
    ['analysis', '试卷分析'],
    ['plan', '升档方案'],
    ['paper', '试卷预览'],
    ['answers', '答案预览'],
    ...(record?.calls.length
      ? [['usage', '消耗详情'] as [ChallengeTab, string]]
      : []),
  ];
  const visibleTab =
    activeTab === 'usage' && !record?.calls.length ? 'original' : activeTab;
  const questionTypes = analysis
    ? [
        ...analysis.questions.reduce(
          (counts, question) =>
            counts.set(question.type, (counts.get(question.type) || 0) + 1),
          new Map<string, number>(),
        ),
      ]
    : [];
  const difficultyBands = [
    {label: '基础（1～3）', min: 1, max: 3},
    {label: '中等（4～6）', min: 4, max: 6},
    {label: '较难（7～8）', min: 7, max: 8},
    {label: '难题（9～10）', min: 9, max: 10},
  ];

  if (panel === 'manage') {
    return (
      <ChallengeManager
        records={records}
        protectedIds={records
          .filter(value => draftUsesRecord(sources, value))
          .map(value => value.id)}
        loading={loading}
        busy={!!localBusy}
        error={listError || error}
        onBack={() => setPanel('main')}
        onRefresh={refresh}
        onOpen={id => {
          open(id);
        }}
        onDelete={deleteRecords}
      />
    );
  }
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={leave}>
            <Text style={styles.back}>‹ 返回首页</Text>
          </Pressable>
          <View style={styles.actions}>
            <Button
              title="管理"
              secondary
              disabled={!!localBusy}
              onPress={() => {
                setError('');
                setPanel('manage');
              }}
            />
            <Button
              title="模型设置"
              secondary
              disabled={!!localBusy}
              onPress={() => {
                showSettings();
              }}
            />
          </View>
        </View>
        <Text style={styles.title}>{record?.title || '挑战'}</Text>
        <Text style={styles.muted}>
          {record
            ? `${STATUS_LABELS[record.status]} · ${record.pageUris.length} 页`
            : '上传试卷，分析后按所选档次生成挑战卷。'}
        </Text>
        {!!record && (
          <View style={styles.actions}>
            <Button
              title="新建挑战"
              secondary
              disabled={!!localBusy}
              onPress={newChallenge}
            />
            <Button
              title="重新解析"
              secondary
              disabled={!!busy}
              onPress={() => {
                run(false);
              }}
            />
            <Button
              title="补充页面"
              secondary
              disabled={!!busy}
              onPress={() => {
                setSources(record.sources);
                setRecord(undefined);
                selectedId.current = undefined;
                onSelectionChange?.(undefined);
                setActiveTab('original');
                setError('');
                setNotice('原卷已放回待解析列表，可补拍或添加缺少的页面。');
              }}
            />
          </View>
        )}
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{selected: visibleTab === key}}
              onPress={() => {
                setActiveTab(key);
                setPreviewError('');
                setPdfPage('');
              }}
              style={[styles.tab, visibleTab === key && styles.activeTab]}>
              <Text
                style={[
                  styles.tabText,
                  visibleTab === key && styles.activeTabText,
                ]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <TabContent
        key={visibleTab}
        fixed={visibleTab === 'paper' || visibleTab === 'answers'}>
        {!!error && (
          <Text selectable accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!!notice && (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        )}
        {!!record?.error && record.error !== error && (
          <Text selectable style={styles.error}>
            {record.error}
          </Text>
        )}
        {!!busy && (
          <Card>
            <ActivityIndicator color="#A55B17" />
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              {busy === 'import'
                ? '正在读取所选文件…'
                : busy === 'save'
                ? '请选择 PDF 保存位置…'
                : record?.progress || '正在处理试卷…'}
            </Text>
            {!!task && (
              <>
                <Text style={styles.muted}>
                  返回首页或切换页卡后继续处理，再次打开可查看进度。
                </Text>
                <Button
                  title="停止处理"
                  secondary
                  onPress={() => {
                    if (record) {
                      cancelChallengeTask(record.id);
                    }
                  }}
                />
              </>
            )}
          </Card>
        )}
        {visibleTab === 'original' && (
          <>
            {!record && (
              <Card>
                <Text style={styles.heading}>上传一份试卷</Text>
                <Text style={styles.muted}>
                  支持空白或已作答的照片、PDF，按页码添加；学生作答不会作为标准答案。
                </Text>
                <View style={styles.actions}>
                  <Button
                    title="拍照"
                    disabled={!!busy}
                    onPress={() => {
                      addImages(true);
                    }}
                  />
                  <Button
                    title="上传照片"
                    secondary
                    disabled={!!busy}
                    onPress={() => {
                      addImages(false);
                    }}
                  />
                  <Button
                    title="上传 PDF"
                    secondary
                    disabled={!!busy}
                    onPress={() => {
                      addPdf();
                    }}
                  />
                </View>
                {sources.map((source, index) => (
                  <View key={`${index}-${source.uri}`} style={styles.sourceRow}>
                    <View style={styles.grow}>
                      <Text style={styles.body}>
                        {index + 1}. {source.name}
                      </Text>
                      <Text style={styles.muted}>
                        {source.kind === 'pdf' ? 'PDF' : '照片'} ·{' '}
                        {source.pageUris.length} 页
                      </Text>
                    </View>
                    <Button
                      title={`移除第${index + 1}项`}
                      secondary
                      disabled={!!busy}
                      onPress={() => {
                        removeSource(index);
                      }}
                    />
                    {index > 0 && (
                      <Button
                        title={`第${index + 1}项上移`}
                        secondary
                        disabled={!!busy}
                        onPress={() =>
                          setSources(values => {
                            const reordered = [...values];
                            [reordered[index - 1], reordered[index]] = [
                              reordered[index],
                              reordered[index - 1],
                            ];
                            return reordered;
                          })
                        }
                      />
                    )}
                  </View>
                ))}
                <Text style={styles.muted}>
                  已选 {sources.length} 项，共 {pageUris.length} 页
                </Text>
                <Button
                  title="解析试卷"
                  disabled={!sources.length || !!busy}
                  onPress={() => {
                    run(false);
                  }}
                />
              </Card>
            )}
            {!!pageUris.length && (
              <Card>
                <Text style={styles.heading}>原卷页面</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  {pageUris.map((uri, index) => (
                    <Pressable
                      key={`${uri}-${index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`查看原卷第${index + 1}页`}
                      onPress={() => setImagePreview({uris: pageUris, index})}
                      style={styles.pageThumb}>
                      <Image
                        source={{uri}}
                        style={styles.thumb}
                        resizeMode="contain"
                      />
                      <Text style={styles.muted}>第 {index + 1} 页</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </Card>
            )}
            <Text style={styles.sectionTitle}>最近挑战</Text>
            {!!listError && (
              <Card>
                <Text style={styles.error}>{listError}</Text>
                <Button
                  title="重新读取记录"
                  secondary
                  disabled={!!localBusy}
                  onPress={() => {
                    refresh();
                  }}
                />
              </Card>
            )}
            {loading ? (
              <ActivityIndicator color="#A55B17" />
            ) : !records.length ? (
              <Card>
                <Text style={styles.muted}>还没有挑战，先上传一份试卷。</Text>
              </Card>
            ) : (
              records.map(value => (
                <Card key={value.id}>
                  <Text style={styles.label}>
                    {value.title || '未命名试卷'}
                  </Text>
                  <Text style={styles.muted}>
                    {new Date(value.createdAt).toLocaleString()} ·{' '}
                    {value.pageUris.length} 页 · {STATUS_LABELS[value.status]}
                  </Text>
                  <Button
                    title={`打开${value.title || '未命名试卷'}`}
                    secondary
                    disabled={!!localBusy}
                    onPress={() => {
                      open(value.id);
                    }}
                  />
                </Card>
              ))
            )}
          </>
        )}
        {visibleTab === 'analysis' && (
          <>
            <Card>
              <Text style={styles.heading}>科目核验</Text>
              <Text style={styles.body}>
                {identification
                  ? `识别科目：${identification.courseName}`
                  : '解析时先抽最多3题识科，不一致再逐题追加。'}
              </Text>
              {!!record?.subjectVerification && (
                <SubjectVerificationSummary
                  verification={record.subjectVerification}
                />
              )}
            </Card>
            {!analysis ? (
              <Card>
                <Text style={styles.muted}>
                  完成原卷解析后，这里展示逐题分析、难度分布和知识范围。
                </Text>
              </Card>
            ) : (
              <>
                <Card>
                  <Text style={styles.heading}>原卷解析</Text>
                  <Text style={styles.body}>
                    {analysis.subjectLabel} ·{' '}
                    {analysis.educationLevel === 'high'
                      ? '高中'
                      : analysis.educationLevel === 'middle'
                      ? '初中'
                      : '学段待确认'}{' '}
                    · {analysis.questions.length} 道题
                  </Text>
                  <Text style={styles.muted}>
                    原卷
                    {analysis.answerState === 'blank'
                      ? '空白'
                      : analysis.answerState === 'answered'
                      ? '已作答'
                      : '部分已作答'}
                    {analysis.totalScore !== null
                      ? ` · ${analysis.totalScore} 分`
                      : ''}
                    {analysis.timeLimitMinutes !== null
                      ? ` · ${analysis.timeLimitMinutes} 分钟`
                      : ''}
                  </Text>
                  <Text style={styles.label}>难度预估</Text>
                  <Text style={styles.body}>{analysis.difficultySummary}</Text>
                  <Text style={styles.muted}>
                    依据题目要求预估，不等同于实测难度或个人掌握情况。
                  </Text>
                  <Text style={styles.label}>难度分布</Text>
                  {difficultyBands.map(band => {
                    const count = analysis.questions.filter(
                      question =>
                        !question.analysisIssues?.length &&
                        question.difficulty.rating >= band.min &&
                        question.difficulty.rating <= band.max,
                    ).length;
                    return (
                      <View key={band.label} style={styles.review}>
                        <Text style={styles.muted}>
                          {band.label}：{count} 题
                        </Text>
                        <View style={styles.track}>
                          <View
                            style={[
                              styles.bar,
                              {
                                width: `${
                                  (count * 100) / analysis.questions.length
                                }%`,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                  {!!analysis.questions.filter(
                    question => question.analysisIssues?.length,
                  ).length && (
                    <Text style={styles.muted}>
                      分析待核：
                      {
                        analysis.questions.filter(
                          question => question.analysisIssues?.length,
                        ).length
                      }{' '}
                      题（保留原题，不计入已确认难度分布）
                    </Text>
                  )}
                  <Text style={styles.label}>知识范围</Text>
                  <Text selectable style={styles.body}>
                    {analysis.knowledgePoints.join('、')}
                  </Text>
                  <Text style={styles.label}>题型分布</Text>
                  <Text style={styles.body}>
                    {questionTypes
                      .map(([type, count]) => `${type} ${count}题`)
                      .join(' · ')}
                  </Text>
                  {analysis.warnings.map((warning, index) => (
                    <Text key={index} style={styles.muted}>
                      {warning}
                    </Text>
                  ))}
                  {!!analysis.unresolvedIssues.length && (
                    <View>
                      <Text style={styles.error}>
                        以下信息尚未核实，请补充原卷或重新解析后再生成：
                      </Text>
                      {analysis.unresolvedIssues.map((issue, index) => (
                        <Text key={index} style={styles.error}>
                          • {issue}
                        </Text>
                      ))}
                    </View>
                  )}
                </Card>
                <Text style={styles.sectionTitle}>逐题分析</Text>
                {analysis.questions.map(question => (
                  <Card key={question.id}>
                    <Text style={styles.label}>
                      第 {question.number} 题 · {question.type}
                      {question.score !== null ? ` · ${question.score} 分` : ''}
                      {question.isListening ? ' · 听力保持不变' : ''}
                    </Text>
                    <Text selectable style={styles.body}>
                      {question.stem}
                    </Text>
                    <Text style={styles.muted}>
                      知识点：{question.knowledgePoints.join('、')}
                    </Text>
                    <Text style={styles.muted}>
                      {question.analysisIssues?.length
                        ? '难度分析待核'
                        : `难度预估 ${question.difficulty.rating}/10 · 推理步骤约 ${question.difficulty.reasoningSteps}`}
                      ：{question.difficulty.explanation}
                    </Text>
                    {question.analysisIssues?.map((issue, index) => (
                      <Text key={index} style={styles.notice}>
                        待核：{issue}
                      </Text>
                    ))}
                    {sourceRequiresRetention(question) &&
                      !question.isListening && (
                        <Text style={styles.notice}>
                          建议保留原题：
                          {question.retentionReason ||
                            '逐题分析尚不能可靠支持变式命题'}
                        </Text>
                      )}
                  </Card>
                ))}
              </>
            )}
          </>
        )}
        {visibleTab === 'plan' && (
          <>
            <Card>
              <Text style={styles.heading}>选择升档难度</Text>
              <View style={styles.actions}>
                {([1, 2, 3] as ChallengeLevel[]).map(value => (
                  <Button
                    key={value}
                    title={`升 ${value} 档`}
                    secondary={level !== value}
                    disabled={!!busy}
                    onPress={() => setLevel(value)}
                  />
                ))}
              </View>
              <Text style={styles.label}>
                升 {level} 档 · 非听力题至少 {minimumUpgradePercent(level)}%
                升档
              </Text>
              <Text style={styles.muted}>
                按非听力小题总数计算，题数向上取整；听力保持不变。不好升档或分析存疑的题可原样保留并说明原因。
              </Text>
              {!!coverage && (
                <Text style={styles.body}>
                  本卷 {coverage.total} 道非听力小题，至少升档{' '}
                  {coverage.required} 题；当前可可靠选用 {coverage.eligible}{' '}
                  题。
                </Text>
              )}
              {!!coverage && coverage.eligible < coverage.required && (
                <Text style={styles.error}>
                  可升档题数不足当前最低比例，请选较低档或补充核实原题。
                </Text>
              )}
              <Text style={styles.heading}>本档升档思路</Text>
              {policy ? (
                <>
                  <Text style={styles.body}>
                    {policy.subjectLabel} · {policy.summary}
                  </Text>
                  {policy.subjectBlueprint.difficultyProgression
                    .find(tier => tier.level === level)
                    ?.qualityTargets.slice(0, 3)
                    .map((thought, index) => (
                      <Text key={index} style={styles.muted}>
                        • {thought}
                      </Text>
                    ))}
                </>
              ) : (
                <Text style={styles.muted}>
                  {policyError ||
                    '先完成原卷解析与识科，再展示对应科目、当前档次的升档思路。'}
                </Text>
              )}
              <Text style={styles.muted}>
                题型、题量、分值和原知识范围保持。升档题按该档难度、易错与深度要求核验，保留题不凑升档数。
              </Text>
              <Text style={styles.muted}>
                本次生成后
                {settings.roundtableSize
                  ? `由${settings.roundtableSize}个角色按规则独立评审`
                  : '进行基础综合校核'}
                ，发现问题修正后重审。
              </Text>
              <Button
                title="升档"
                disabled={!canUpgrade || !!busy}
                onPress={() => {
                  run(true);
                }}
              />
            </Card>
            {!!pdfReady && record?.candidate && finalCoverage && (
              <Card>
                <Text style={styles.heading}>
                  本次生成结果 · 升 {record.candidate.level} 档
                </Text>
                <Text style={styles.body}>
                  已升档 {finalCoverage.upgraded} / {finalCoverage.total}{' '}
                  道非听力题（{finalCoverage.percent.toFixed(1)}%）；其余{' '}
                  {finalCoverage.retained} 题保留原题。
                </Text>
                {record.candidate.questions.map(question => (
                  <View key={question.id} style={styles.question}>
                    <Text style={styles.label}>
                      第 {question.number} 题 ·{' '}
                      {isRetainedQuestion(question) ? '保留原题' : '已升档'}
                    </Text>
                    {isRetainedQuestion(question) ? (
                      <Text style={styles.muted}>
                        {question.upgrade.retentionReason ||
                          (question.isListening
                            ? '听力沿用原卷与原录音'
                            : '原知识范围内暂不适宜调整')}
                      </Text>
                    ) : (
                      question.upgrade.changes.map((change, index) => (
                        <Text key={index} style={styles.body}>
                          • {change}
                        </Text>
                      ))
                    )}
                  </View>
                ))}
              </Card>
            )}
            {!!record?.reviewRounds.length && (
              <Card>
                <Text style={styles.heading}>生成校核</Text>
                <Text style={styles.muted}>
                  沿用本卷生成时的{reviewModeLabel(record.reviewRoundtableSize)}
                  设置。
                </Text>
                {record.reviewRounds.map(round => (
                  <ReviewRoundSummary
                    key={`${round.round}-${round.candidateRevision}`}
                    round={round}
                    record={record}
                    showDetails={false}
                  />
                ))}
              </Card>
            )}
          </>
        )}
        {(visibleTab === 'paper' || visibleTab === 'answers') && (
          <Card fill>
            <Text style={styles.heading}>
              {visibleTab === 'paper' ? '试卷 PDF 预览' : '答案 PDF 预览'}
            </Text>
            {!pdfReady ? (
              <Text style={styles.muted}>
                新卷通过校核并生成两份 PDF 后，可在这里预览、缩放和下载。
              </Text>
            ) : (
              <>
                {visibleTab === 'answers' &&
                  record?.candidate?.answers.some(
                    answer => answer.status !== 'verified',
                  ) && (
                    <Text style={styles.notice}>
                      部分答案待原录音或原题核验，PDF
                      中已明确标注，不作为确定答案。
                    </Text>
                  )}
                <Button
                  title={visibleTab === 'paper' ? '下载试卷' : '下载答案'}
                  disabled={!!busy}
                  onPress={() => {
                    download(visibleTab === 'answers');
                  }}
                />
                <Text style={styles.muted}>双指缩放 · 滑动翻页 {pdfPage}</Text>
                {previewError ? (
                  <View>
                    <Text style={styles.error}>
                      PDF 预览失败：{previewError}
                    </Text>
                    <Button
                      title="重新打开 PDF"
                      secondary
                      onPress={() => {
                        setPreviewError('');
                        setPreviewAttempt(value => value + 1);
                      }}
                    />
                  </View>
                ) : (
                  <Pdf
                    key={pdfKey}
                    source={{
                      uri:
                        (Platform.OS as string) === 'harmony'
                          ? pdfUri!.replace(/^file:\/\//, '')
                          : pdfUri!,
                      cache: false,
                    }}
                    style={styles.pdf}
                    fitPolicy={0}
                    trustAllCerts={false}
                    onPageChanged={(page, count) => {
                      if (activePdfKey.current === pdfKey) {
                        setPdfPage(`${page}/${count}`);
                      }
                    }}
                    onError={reason => {
                      if (activePdfKey.current === pdfKey) {
                        setPreviewError(String(reason));
                      }
                    }}
                  />
                )}
              </>
            )}
          </Card>
        )}
        {visibleTab === 'usage' && !!record && (
          <ChallengeUsageDetails record={record} />
        )}
      </TabContent>
      {!!imagePreview && (
        <ImageViewer
          uris={imagePreview.uris}
          initialIndex={imagePreview.index}
          onClose={() => setImagePreview(undefined)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
  previewContent: {flex: 1, padding: 20, gap: 16},
  top: {paddingHorizontal: 20, paddingTop: 4, gap: 10},
  tabs: {flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingVertical: 8},
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#EEEFF3',
  },
  activeTab: {backgroundColor: '#FFF0DB'},
  tabText: {color: '#64748b', fontSize: 14},
  activeTabText: {color: '#965414', fontWeight: '700'},
  track: {height: 6, borderRadius: 4, backgroundColor: '#EEF0F4'},
  bar: {height: 6, borderRadius: 4, backgroundColor: '#BE803E'},
  safe: {flex: 1, backgroundColor: '#F8F8FB'},
  container: {padding: 20, paddingBottom: 48, gap: 16},
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    fontSize: 16,
    color: '#A55B17',
    fontWeight: '700',
    paddingVertical: 12,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#946231',
    fontWeight: '700',
  },
  title: {fontSize: 32, fontWeight: '800', color: '#243149'},
  subtitle: {fontSize: 16, lineHeight: 24, color: '#475569'},
  card: {backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12},
  heading: {fontSize: 19, fontWeight: '700', color: '#243149'},
  label: {fontSize: 15, lineHeight: 23, fontWeight: '700', color: '#334155'},
  body: {fontSize: 14, lineHeight: 23, color: '#334155'},
  muted: {fontSize: 12, lineHeight: 20, color: '#64748B'},
  error: {fontSize: 14, lineHeight: 22, color: '#B42318', paddingVertical: 4},
  notice: {fontSize: 14, lineHeight: 22, color: '#087F5B'},
  status: {fontSize: 13, lineHeight: 21, color: '#A55B17', fontWeight: '700'},
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#243149',
    marginTop: 6,
  },
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  button: {
    backgroundColor: '#A55B17',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonText: {fontSize: 14, fontWeight: '700', color: '#FFFFFF'},
  secondaryButton: {
    backgroundColor: '#FFF5E8',
    borderWidth: 1,
    borderColor: '#F1E1C9',
  },
  secondaryText: {color: '#965015'},
  disabled: {opacity: 0.42},
  sourceRow: {
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  grow: {flex: 1},
  pageThumb: {alignItems: 'center', marginRight: 12, gap: 6},
  thumb: {width: 94, height: 128, backgroundColor: '#F1F5F9', borderRadius: 6},
  question: {
    gap: 7,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#EEF2F6',
  },
  review: {gap: 4, paddingVertical: 4},
  depthPanel: {
    padding: 12,
    gap: 7,
    backgroundColor: '#FFF8EE',
    borderRadius: 10,
  },
  pdf: {flex: 1, minHeight: 160, width: '100%', backgroundColor: '#E2E8F0'},
});
