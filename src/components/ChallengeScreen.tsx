import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import PdfPreview from '../shared/pdf/PdfPreview';
import PageGallery from '../shared/media/PageGallery';
import Select from '../shared/ui/Select';
import {useImageImport} from '../shared/media/useImageImport';
import {discardPreparedImages} from '../shared/media/images';
import {PreparedImage} from '../shared/media/types';
import ChallengeHome from './ChallengeHome';
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
  CHALLENGE_REVIEW_PROTOCOL_VERSION,
  challengeReviewQuestionIds,
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
import {prepareRetainedAnalysis} from '../challenge/retention';
import {selectUpgradeQuestions} from '../challenge/planning';
type ChallengeTab = 'analysis' | 'plan' | 'paper' | 'answers' | 'usage';
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
      {verification.titleGuess ? (
        <Text style={styles.body}>
          标题初判：{verification.titleGuess.courseName} ·{' '}
          {verification.titleVerification === 'verified'
            ? '已通过抽样核验'
            : verification.titleVerification === 'conflict'
            ? '样题不支持原标题，按实际题目确认'
            : '正在抽样核验'}
        </Text>
      ) : (
        verification.mode === 'progressive' && (
          <Text style={styles.muted}>
            原标题缺失或无法明确判科，直接以最多3道样题识别。
          </Text>
        )
      )}
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
  const {height} = useWindowDimensions();
  return fixed ? (
    <View
      style={[styles.previewContent, {height: Math.max(520, height * 0.75)}]}>
      {children}
    </View>
  ) : (
    <View style={styles.container}>{children}</View>
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
  if (
    !!record.candidate?.questions.length &&
    record.reviewProtocolVersion === CHALLENGE_REVIEW_PROTOCOL_VERSION &&
    challengeReviewQuestionIds(record).length === 0 &&
    round.reviews.length === 0
  ) {
    return (
      <View style={styles.question}>
        <Text style={styles.notice}>无升档题，原题保留，无需模型评审。</Text>
      </View>
    );
  }
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
  const [level, setLevel] = useState<ChallengeLevel>(1);
  const [activeTab, setActiveTab] = useState<ChallengeTab>('analysis');
  const [localBusy, setBusy] = useState<
    'import' | 'analysis' | 'upgrade' | 'save' | 'open'
  >();
  const [panel, setPanel] = useState<'main' | 'manage'>('main');
  const [addingPages, setAddingPages] = useState(false);
  const imageImport = useImageImport();
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
  const resumeId = useRef(initialChallengeId);
  const selectedId = useRef(record?.id);
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
                : 'analysis',
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
    if (record) {
      showHome();
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
  }, [onBack, imagePreview, panel, record?.id]);

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
  const commitSources = async (values: ChallengeSource[], request: number) => {
    const saved = await createChallenge(values);
    if (current(request)) {
      selectedId.current = saved.id;
      setRecord(saved);
      onSelectionChange?.(saved.id);
      setLevel(1);
      setActiveTab('analysis');
      setAddingPages(false);
    }
    if (mounted.current) {
      await refresh();
    }
  };
  const addImages = async (camera: boolean, append = false) => {
    if (append && record && getChallengeTask(record.id)) {
      return;
    }
    const base = append && record ? record.sources : [];
    const request = begin('import');
    if (request === undefined) {
      return;
    }
    let prepared: PreparedImage[] | undefined;
    try {
      prepared = await imageImport.pickImages(camera, {
        permissionMessage: '需要使用相机拍摄试卷。',
        maxCount:
          50 - base.reduce((sum, source) => sum + source.pageUris.length, 0),
      });
      if (!prepared?.length || !current(request)) {
        return;
      }
      const images: ChallengeSource[] = prepared.map(image => ({
        kind: 'image',
        name: image.name,
        uri: image.uri,
        pageUris: [image.uri],
      }));
      await commitSources([...base, ...images], request);
    } catch (reason) {
      if (current(request)) {
        setError(errorText(reason));
      }
    } finally {
      if (prepared) {
        await discardPreparedImages(prepared.map(image => image.uri));
      }
      finish(request);
    }
  };
  const addPdf = async (append = false) => {
    if (append && record && getChallengeTask(record.id)) {
      return;
    }
    const base = append && record ? record.sources : [];
    if (base.some(source => source.kind === 'pdf')) {
      setError('每份试卷只允许上传一个 PDF，可以继续补充照片。');
      return;
    }
    const request = begin('import');
    if (request === undefined) {
      return;
    }
    let source: ChallengeSource | null = null;
    try {
      source = await pickChallengePdf();
      if (source && current(request)) {
        await commitSources([...base, source], request);
      }
    } catch (reason) {
      if (current(request)) {
        setError(errorText(reason));
      }
    } finally {
      if (source) {
        await discardImports([source]);
      }
      finish(request);
    }
  };
  const run = async (upgrade: boolean, analysisMode?: 'resume' | 'restart') => {
    if (!record) {
      return;
    }
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
      const active = record;
      const promise = startChallengeTask(
        active.id,
        upgrade ? 'upgrade' : 'analysis',
        settings,
        upgrade ? level : undefined,
        upgrade ? undefined : analysisMode,
      );
      signal = getChallengeTask(active.id)?.signal;
      // File operations lock the view; model work stays with the app task.
      finish(request);
      const result = await promise;
      if (current(request)) {
        setRecord(result);
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
        if (!current(request)) {
          return;
        }
        const value = getChallengeTask(id)?.record || saved;
        setRecord(value);
        selectedId.current = value.id;
        onSelectionChange?.(value.id);
        setLevel(value.level);
        setPreviewError('');
        setPdfPage('');
        setPanel('main');
        setActiveTab('analysis');
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
            setActiveTab('analysis');
          }
        }
      }
    } finally {
      await refresh();
      finish(request);
    }
  };
  const showHome = () => {
    epoch.current += 1;
    lock.current = false;
    setBusy(undefined);
    selectedId.current = undefined;
    setRecord(undefined);
    onSelectionChange?.(undefined);
    setLevel(1);
    setActiveTab('analysis');
    setAddingPages(false);
    setError('');
    setNotice('');
    setPreviewError('');
    refresh();
  };
  const requestAnalysis = () => {
    if (!record || getChallengeTask(record.id)) {
      return;
    }
    const launch = (mode: 'resume' | 'restart') => {
      if (mounted.current && selectedId.current === record.id) {
        run(false, mode);
      }
    };
    if (record.analysis) {
      Alert.alert(
        '是否重新解析试卷？',
        '继续解析会复用已识别页面；重新解析会重新识别全部原卷，并更新解析与后续生成结果。',
        [
          {text: '取消', style: 'cancel'},
          {text: '继续解析', onPress: () => launch('resume')},
          {text: '重新解析', onPress: () => launch('restart')},
        ],
      );
    } else {
      launch('resume');
    }
  };
  const showSettings = () => {
    if (!localBusy) {
      onSettings();
    }
  };

  const analysis = useMemo(
    () =>
      record?.analysis
        ? prepareRetainedAnalysis(record.analysis, record.pages)
        : undefined,
    [record?.analysis, record?.pages],
  );
  const selectedQuestions = useMemo(
    () => (analysis ? selectUpgradeQuestions(analysis, level) : []),
    [analysis, level],
  );
  const identification = record?.subjectIdentification;
  const confirmedSubject =
    analysis &&
    identification?.status === 'confirmed' &&
    identification.subject === analysis.subject
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
    !!analysis && analysis.questions.some(question => !question.isListening);
  const pageUris = record?.pageUris || [];
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
    ['analysis', '试卷分析'],
    ['plan', '升档方案'],
    ['paper', '试卷预览'],
    ['answers', '答案预览'],
    ...(record?.calls.length
      ? [['usage', '消耗详情'] as [ChallengeTab, string]]
      : []),
  ];
  const visibleTab =
    activeTab === 'usage' && !record?.calls.length ? 'analysis' : activeTab;
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
        protectedIds={[]}
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
  if (imageImport.cropper) {
    return imageImport.cropper;
  }
  if (!record) {
    return (
      <ChallengeHome
        records={records}
        busy={!!localBusy || imageImport.busy}
        loading={loading}
        error={error || listError}
        onBack={leave}
        onManage={() => {
          setError('');
          setPanel('manage');
        }}
        onSettings={showSettings}
        onCamera={() => {
          addImages(true);
        }}
        onPhotos={() => {
          addImages(false);
        }}
        onPdf={() => {
          addPdf();
        }}
        onOpen={id => {
          open(id);
        }}
        onRefresh={() => {
          setError('');
          refresh();
        }}
      />
    );
  }
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.detailContainer}
        nestedScrollEnabled>
        <View style={styles.top}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={leave}>
              <Text style={styles.back}>‹ 返回挑战</Text>
            </Pressable>
            <Button
              title="模型设置"
              secondary
              disabled={!!localBusy}
              onPress={showSettings}
            />
          </View>
          <Text accessibilityLabel="试卷标题" style={styles.title}>
            {analysis?.title || '试卷（待解析）'}
          </Text>
          <Text style={styles.muted}>
            {STATUS_LABELS[record.status]} · {record.pageUris.length} 页
          </Text>
          <PageGallery
            uris={pageUris}
            label="原卷"
            height={112}
            onOpen={index => setImagePreview({uris: pageUris, index})}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() => setAddingPages(value => !value)}>
            <Text style={styles.backSmall}>
              {addingPages ? '收起补充入口' : '补充页面'}
            </Text>
          </Pressable>
          {addingPages && (
            <View style={styles.actions}>
              <Button
                title="补拍"
                secondary
                disabled={!!busy}
                onPress={() => {
                  addImages(true, true);
                }}
              />
              <Button
                title="补充照片"
                secondary
                disabled={!!busy}
                onPress={() => {
                  addImages(false, true);
                }}
              />
              <Button
                title="补充 PDF"
                secondary
                disabled={
                  !!busy || record.sources.some(source => source.kind === 'pdf')
                }
                onPress={() => {
                  addPdf(true);
                }}
              />
            </View>
          )}
          <View style={styles.actions} accessibilityLabel="试卷操作">
            <Button
              title="解析试卷"
              disabled={!!busy}
              onPress={requestAnalysis}
            />
            <Select
              label="升档难度"
              value={level}
              disabled={!!busy}
              options={([1, 2, 3] as ChallengeLevel[]).map(value => ({
                value,
                label: `升 ${value} 档`,
              }))}
              onChange={setLevel}
            />
            <Button
              title="升档"
              disabled={!canUpgrade || !!busy}
              onPress={() => {
                run(true);
              }}
            />
          </View>
          {!!analysis?.unresolvedIssues.length && (
            <Text style={styles.notice}>
              局部解析异常的题将按原位置保留，其余题可继续升档；因解析异常未达比例不计为失败。
            </Text>
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
                    <Text style={styles.body}>
                      {analysis.difficultySummary}
                    </Text>
                    <Text style={styles.muted}>
                      依据题目要求预估，不等同于实测难度或个人掌握情况。
                    </Text>
                    <Text style={styles.label}>难度分布</Text>
                    {difficultyBands.map(band => {
                      const count = analysis.questions.filter(
                        question =>
                          !question.analysisIssues?.length &&
                          question.difficulty.rating !== null &&
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
                        <Text style={styles.notice}>
                          以下信息尚未核实，对应题将原样保留，不阻止其余题升档：
                        </Text>
                        {analysis.unresolvedIssues.map((issue, index) => (
                          <Text key={index} style={styles.notice}>
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
                        {question.score !== null
                          ? ` · ${question.score} 分`
                          : ''}
                        {question.isListening ? ' · 听力保持不变' : ''}
                      </Text>
                      <Text selectable style={styles.body}>
                        {question.stem}
                      </Text>
                      <Text style={styles.muted}>
                        知识点：
                        {question.knowledgePoints.join('、') ||
                          '待核，保留原题'}
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
                            按原位置保留原题：
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
                <Text style={styles.heading}>升档方案</Text>
                <Text style={styles.label}>
                  升 {level} 档 · 非听力题目标升档{' '}
                  {minimumUpgradePercent(level)}%
                </Text>
                <Text style={styles.muted}>
                  按非听力小题总数计算目标，题数向上取整；听力保持不变。解析异常或不完整的题原样保留；因此达不到原目标时仍正常完成，并如实展示实际比例。
                </Text>
                {!!coverage && (
                  <>
                    <Text style={styles.body}>
                      本卷 {coverage.total} 道非听力小题，原目标升档{' '}
                      {coverage.targetRequired} 题；当前可可靠选用{' '}
                      {coverage.eligible} 题。
                    </Text>
                    <Text style={styles.muted}>
                      本地初选 {selectedQuestions.length}{' '}
                      题交给模型升档，其余原题直接保留；如选中题无法升档，只按差额补选。
                    </Text>
                  </>
                )}
                {!!coverage?.limitedByAnalysis && (
                  <Text style={styles.notice}>
                    {coverage.analysisRetained}{' '}
                    道题因解析待核或依赖关系保留，本次按可靠题完成升档，低于原目标不计为失败。
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
                  ，仅评审实际升档题，发现问题修正后重审；保留原题不评审，无升档题则跳过模型评审。
                </Text>
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
                  {finalCoverage.upgraded < finalCoverage.targetRequired &&
                    finalCoverage.analysisRetained > 0 && (
                      <Text style={styles.notice}>
                        因解析异常及其依赖保留 {finalCoverage.analysisRetained}{' '}
                        题，未达原目标 {finalCoverage.minimumPercent}
                        %，已正常完成；保留题不计入升档。
                      </Text>
                    )}
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
                    沿用本卷生成时的
                    {reviewModeLabel(record.reviewRoundtableSize)}
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
                  <Text style={styles.muted}>
                    双指缩放 · 滑动翻页 {pdfPage}
                  </Text>
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
                    <PdfPreview
                      key={pdfKey}
                      uri={pdfUri!}
                      style={styles.pdf}
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
      </ScrollView>
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
  previewContent: {padding: 20, gap: 16},
  detailContainer: {paddingBottom: 24},
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
  title: {fontSize: 20, lineHeight: 28, fontWeight: '700', color: '#243149'},
  backSmall: {color: '#A55B17', fontSize: 13},
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
