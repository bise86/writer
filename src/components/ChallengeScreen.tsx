import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
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
  ChallengeSubject,
  ExamAnalysis,
  SubjectVerification,
} from '../challenge/types';
import {
  createChallenge,
  deleteChallenge,
  getChallenge,
  listChallenges,
} from '../challenge/store';
import {analyzeChallenge, upgradeChallenge} from '../challenge/pipeline';
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
import {
  CHALLENGE_RULES,
  CHALLENGE_POLICY_VERSION,
  ChallengeMetric,
  ChallengeSubjectBlueprint,
  applicableMasteryChallenges,
  getChallengePolicy,
  loadChallengeSubjectRules,
} from '../challenge/rules';
import ImageViewer from './ImageViewer';

const STATUS_LABELS: Record<ChallengeRecord['status'], string> = {
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
const RUNNING_STATUSES = new Set([
  'analyzing',
  'generating',
  'reviewing',
  'repairing',
  'exporting',
]);

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

function metricScope(
  metric: Pick<ChallengeMetric, 'appliesTo' | 'taskCondition'>,
) {
  const task =
    metric.appliesTo === 'writing'
      ? '写作题'
      : metric.appliesTo === 'reasoning'
      ? '推理题'
      : '非听力题';
  const conditions: Record<string, string> = {
    quantitative: '原题含数量或表征任务',
    experimental: '原题涉及实验',
    scientific_conditions: '原题有规律或实验条件',
    evidence: '原题有材料或数据证据',
    spatial: '原题含空间关系',
    comparison: '原题涉及比较或因果',
    geometric: '原题含几何关系',
    discrete: '原题含计数或整数结构',
    relations: '原题含函数、方程或关系',
    invariant: '原题存在操作变换或量的保持',
    argument: '原题含论证、解释或比较判断',
    finite_objects: '原题涉及有限对象或分组分配',
  };
  return `（${task}${
    metric.taskCondition
      ? `，${conditions[metric.taskCondition] || '原题具备相应条件'}时`
      : ''
  }）`;
}

function DepthSummary({
  requirements,
}: {
  requirements?: {
    minDirections: number;
    minConnections: number;
    requireNecessityExplanation: boolean;
    focusedRoute?: {
      minDirections: number;
      minDecisions: number;
      minBoundaryChecks: number;
    };
  };
}) {
  if (!requirements) {
    return null;
  }
  return (
    <View style={styles.depthPanel}>
      <Text style={styles.label}>思维深度要求</Text>
      {!!requirements.focusedRoute && (
        <Text style={styles.label}>可选路线一：组合深化</Text>
      )}
      <Text style={styles.body}>
        至少采用 {requirements.minDirections} 个适用思路
      </Text>
      <Text style={styles.body}>
        {requirements.minConnections > 0
          ? `思路之间至少形成 ${requirements.minConnections} 处有效联系；多选思路时，也要连成完整解法。`
          : '一个思路也要真正改变判断或解法；不是多算一步、换个名称。'}
      </Text>
      {!!requirements.focusedRoute && (
        <View style={styles.review}>
          <Text style={styles.label}>可选路线二：单策略深挖</Text>
          <Text
            style={
              styles.body
            }>{`围绕 ${requirements.focusedRoute.minDirections} 个核心策略，至少完成 ${requirements.focusedRoute.minDecisions} 个关键决策和 ${requirements.focusedRoute.minBoundaryChecks} 项实际边界检查。`}</Text>
          <Text style={styles.muted}>
            两条路线任选其一。关键决策要影响解法，边界检查要避免误判或漏解；例行计算、重复验算不算深挖。
          </Text>
        </View>
      )}
      {requirements.requireNecessityExplanation && (
        <Text style={styles.muted}>
          说明原题怎样做、这些思路在新题解法中起什么关键作用，以及少了哪一步会产生什么错误或漏解。
        </Text>
      )}
    </View>
  );
}

function savedPolicyLabel(version?: string) {
  if (version === CHALLENGE_POLICY_VERSION) {
    return `当前深度与掌握训练标准 v${CHALLENGE_RULES.version}`;
  }
  const number = version?.match(/:(\d+)$/)?.[1];
  return number ? `历史标准 v${number}` : '历史标准（版本未记录）';
}

function SubjectVerificationSummary({
  verification,
}: {
  verification: SubjectVerification;
}) {
  return (
    <View style={styles.review}>
      <Text style={styles.label}>识科核验方式</Text>
      <Text style={styles.body}>
        {verification.mode === 'title_sample'
          ? '标题识科，每大题随机1题佐证'
          : `扩大核验：${
              verification.expansionReason || '结合整卷进一步确认科目。'
            }`}
      </Text>
      {verification.samples.length > 0 && (
        <>
          <Text style={styles.label}>本轮抽中的题目</Text>
          {verification.samples.map(sample => (
            <Text key={sample.majorQuestionId} style={styles.muted}>
              {sample.majorQuestionTitle} · 题号 {sample.selectedQuestionNumber}
            </Text>
          ))}
          <Text style={styles.muted}>抽样题号与原页依据已随识科记录保存。</Text>
        </>
      )}
    </View>
  );
}

function MasterySummary({
  requirements,
  level,
}: {
  requirements?: ReturnType<typeof getChallengePolicy>['masteryRequirements'];
  level: ChallengeLevel;
}) {
  const framework = CHALLENGE_RULES.masteryFramework;
  const tierIntent = framework.tierIntent[level];
  return (
    <View style={styles.depthPanel}>
      <Text style={styles.label}>原知识点的掌握训练目标</Text>
      <Text style={styles.body}>{framework.goal}</Text>
      {(!requirements || requirements.requireEveryCore) && (
        <Text style={styles.body}>每个原题核心知识点都安排以下五维训练：</Text>
      )}
      {framework.dimensions
        .filter(
          dimension =>
            !requirements ||
            requirements.requiredDimensions.some(id => id === dimension.id),
        )
        .map(dimension => (
          <View key={dimension.id} style={styles.review}>
            <Text style={styles.label}>{dimension.name}</Text>
            <Text style={styles.muted}>
              {Object.entries(tierIntent).find(
                ([id]) => id === dimension.id,
              )?.[1] || dimension.description}
            </Text>
          </View>
        ))}
      {requirements && (
        <Text style={styles.body}>
          {`每题合计至少辨析 ${requirements.minMisconceptions} 类不同易错点、建立 ${requirements.minTransferLinks} 处同核迁移联系，并安排 ${requirements.minSelfChecks} 种有效自检。`}
        </Text>
      )}
      <Text style={styles.muted}>{framework.claimBoundary}</Text>
      <Text style={styles.muted}>
        题型与作答方式保持；选择、判断、填空题不另加说明小问，依据、纠错与自检过程在答案侧核对。
      </Text>
    </View>
  );
}

function SubjectBlueprint({
  blueprint,
  level,
  expanded,
}: {
  blueprint?: ChallengeSubjectBlueprint;
  level: ChallengeLevel;
  expanded: boolean;
}) {
  if (!blueprint) {
    return null;
  }
  return (
    <View style={styles.depthPanel}>
      <Text style={styles.label}>本学科的学习与提升重点</Text>
      {blueprint.difficultyProgression
        .find(tier => tier.level === level)
        ?.qualityTargets.map((target, index) => (
          <Text key={index} style={styles.body}>
            • {target}
          </Text>
        ))}
      {expanded && (
        <>
          <Text style={styles.label}>科内范围索引</Text>
          <Text style={styles.muted}>{blueprint.coreDomains.join('、')}</Text>
          <Text style={styles.muted}>
            这些是这门学科的参考范围；本次只选原卷实际考查的核心子点。
          </Text>
          <Text style={styles.label}>可关注的易错机制</Text>
          {blueprint.misconceptionMechanisms.map((item, index) => (
            <Text key={index} style={styles.body}>
              • {item}
            </Text>
          ))}
          <Text style={styles.label}>训练题与答案讲解的验收要求</Text>
          {blueprint.masteryAcceptance.map((item, index) => (
            <Text key={index} style={styles.body}>
              • {item}
            </Text>
          ))}
          <Text style={styles.label}>按原题型安排训练</Text>
          {blueprint.questionTypeGuidance.map((item, index) => (
            <View key={index} style={styles.review}>
              <Text style={styles.label}>{item.questionType}</Text>
              <Text style={styles.body}>{item.design}</Text>
            </View>
          ))}
          <Text style={styles.label}>知识范围边界</Text>
          {blueprint.scopeExclusions.map((item, index) => (
            <Text key={index} style={styles.muted}>
              • {item}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}

function MatchedMasteryCatalog({
  analysis,
  level,
}: {
  analysis: ExamAnalysis;
  level: ChallengeLevel;
}) {
  const byKnowledge = new Map<string, Map<string, string>>();
  for (const question of analysis.questions) {
    if (question.isListening) {
      continue;
    }
    for (const knowledgePoint of question.knowledgePoints) {
      const matched =
        byKnowledge.get(knowledgePoint) || new Map<string, string>();
      for (const challenge of applicableMasteryChallenges(
        analysis.subject,
        level,
        question,
        analysis.materials,
        knowledgePoint,
        analysis.educationLevel,
      )) {
        matched.set(challenge.id, challenge.name);
      }
      byKnowledge.set(knowledgePoint, matched);
    }
  }
  return (
    <View style={styles.question}>
      <Text style={styles.label}>按原知识点匹配的易错与难点目录</Text>
      <Text style={styles.muted}>
        以下是可选择的训练方向，实际采用情况以本卷题目与答案讲解为准；不表示你已经出现这些错误或已经掌握。
      </Text>
      {Array.from(byKnowledge, ([knowledgePoint, matched]) => (
        <View key={knowledgePoint} style={styles.review}>
          <Text style={styles.label}>{knowledgePoint}</Text>
          <Text style={styles.body}>
            {matched.size
              ? `候选方向：${Array.from(matched.values()).join('、')}`
              : '尚无匹配目录；需要在本知识点范围内安排训练，不套用其它考点。'}
          </Text>
        </View>
      ))}
      {!byKnowledge.size && (
        <Text style={styles.muted}>听力保持原卷，不参与升档训练。</Text>
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

function Card({children}: {children: React.ReactNode}) {
  return <View style={styles.card}>{children}</View>;
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
  const [policySubject, setPolicySubject] = useState<ChallengeSubject>();
  const [showPolicies, setShowPolicies] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [busy, setBusy] = useState<
    'import' | 'analysis' | 'upgrade' | 'save' | 'open'
  >();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<'paper' | 'answers'>('paper');
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
  const controller = useRef<AbortController>();
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
        setRecords(values);
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
          if (mounted.current && request === epoch.current && value) {
            setRecord(value);
            setLevel(value.level);
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
      controller.current?.abort();
      if (!copyingSources.current) {
        discardImports(pendingSources.current);
      }
    };
    // The initial history load is independent of model settings.
  }, []);

  const leave = () => {
    epoch.current += 1;
    controller.current?.abort();
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
  }, [onBack, imagePreview]);

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
    const request = begin(upgrade ? 'upgrade' : 'analysis');
    if (request === undefined) {
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    setPreview('paper');
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
        if (!current(request)) {
          return;
        }
        setRecord(active);
        setSources([]);
        pendingSources.current = [];
        onSelectionChange?.(active.id);
      }
      const options = {
        settings,
        signal: activeController.signal,
        onUpdate: (value: ChallengeRecord) => {
          if (current(request)) {
            setRecord(value);
          }
        },
      };
      const result = upgrade
        ? await upgradeChallenge(active.id, level, options)
        : await analyzeChallenge(active.id, options);
      if (current(request)) {
        setRecord(result);
        setPreview('paper');
        setPreviewError('');
        setPdfPage('');
        if (result.error) {
          setError(result.error);
        }
      }
    } catch (reason) {
      if (current(request)) {
        if (activeController.signal.aborted) {
          setNotice('已停止处理，已保存的试卷与进度会保留。');
        } else {
          setError(errorText(reason));
        }
      }
    } finally {
      if (controller.current === activeController) {
        controller.current = undefined;
      }
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
      const value = await getChallenge(id);
      if (current(request)) {
        if (!value) {
          throw new Error('这份挑战已删除，请刷新记录。');
        }
        await discardImports(sources);
        if (!current(request)) {
          return;
        }
        setRecord(value);
        onSelectionChange?.(value.id);
        setLevel(value.level);
        setSources([]);
        setPreview('paper');
        setPreviewError('');
        setPdfPage('');
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
  const protectDraftSource = (value: ChallengeRecord) => {
    if (!draftUsesRecord(pendingSources.current, value)) {
      return false;
    }
    setError(
      '这份记录正用于补充页面。请先完成解析，或移除待解析的原卷页面后再删除。',
    );
    return true;
  };
  const removeRecord = (value: ChallengeRecord) => {
    if (!mounted.current || lock.current || protectDraftSource(value)) {
      return;
    }
    Alert.alert('删除挑战', '删除这份挑战及其保存的试卷、答案和导入副本？', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          // A confirmation can outlive the view that opened it. Recheck the
          // current draft before deleting files referenced by pending inputs.
          if (!mounted.current || protectDraftSource(value)) {
            return;
          }
          const request = begin('open');
          if (request === undefined) {
            return;
          }
          try {
            await deleteChallenge(value.id);
            if (current(request)) {
              setRecord(selected =>
                selected?.id === value.id ? undefined : selected,
              );
              if (selectedId.current === value.id) {
                onSelectionChange?.(undefined);
              }
            }
            await refresh();
          } catch (reason) {
            if (current(request)) {
              setError(`删除失败：${errorText(reason)}`);
            }
          } finally {
            finish(request);
          }
        },
      },
    ]);
  };
  const newChallenge = () => {
    if (lock.current) {
      return;
    }
    epoch.current += 1;
    setRecord(undefined);
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
  const subjectIdentification = record?.subjectIdentification;
  const subjectVerification =
    record?.subjectVerification ||
    subjectIdentification?.verification ||
    analysis?.subjectIdentification?.verification;
  const identifiedRulesLoaded =
    subjectIdentification?.status === 'confirmed' &&
    record?.loadedSubjectRules?.subject === subjectIdentification.subject &&
    record.loadedSubjectRules.policyVersion === CHALLENGE_POLICY_VERSION;
  const confirmedSubject =
    analysis &&
    subjectIdentification?.status === 'confirmed' &&
    analysis.subjectIdentification?.status === 'confirmed' &&
    subjectIdentification.subject === analysis.subject &&
    analysis.subjectIdentification.subject === analysis.subject &&
    subjectIdentification.courseName ===
      analysis.subjectIdentification.courseName
      ? analysis.subject
      : undefined;
  const selectedPolicySubject =
    confirmedSubject || (!analysis && showPolicies ? policySubject : undefined);
  let subjectRules: ReturnType<typeof loadChallengeSubjectRules> | undefined;
  let policy: ReturnType<typeof getChallengePolicy> | undefined;
  let policyError = '';
  if (selectedPolicySubject) {
    try {
      subjectRules = loadChallengeSubjectRules(selectedPolicySubject);
      policy = getChallengePolicy(selectedPolicySubject, level);
    } catch (reason) {
      policyError = `对应科目标准读取失败：${errorText(reason)}`;
    }
  }
  const pageUris =
    record?.pageUris || sources.flatMap(source => source.pageUris);
  const canUpgrade =
    !!analysis &&
    !!confirmedSubject &&
    !!policy &&
    analysis.questions.length > 0 &&
    analysis.unresolvedIssues.length === 0;
  const pdfReady = hasReadyPdfs(record);
  const showAnswerDetails = pdfReady && preview === 'answers' && !busy;
  const pdfUri =
    preview === 'paper' ? record?.paperPdfUri : record?.answersPdfUri;
  const pdfKey = `${pdfUri}-${previewAttempt}`;
  const activePdfKey = useRef(pdfKey);
  activePdfKey.current = pdfKey;
  const questionTypes = analysis
    ? Object.entries(
        analysis.questions.reduce<Record<string, number>>(
          (counts, question) => {
            counts[question.type] = (counts[question.type] || 0) + 1;
            return counts;
          },
          {},
        ),
      )
    : [];
  const pendingAudio = record?.candidate?.answers.some(
    answer => answer.status === 'requires_audio',
  );
  const historicalPolicy =
    !!record?.candidate && record.policyVersion !== CHALLENGE_POLICY_VERSION;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={leave}>
            <Text style={styles.back}>‹ 返回首页</Text>
          </Pressable>
          <Button
            title="模型设置"
            secondary
            disabled={!!busy}
            onPress={() => {
              showSettings();
            }}
          />
        </View>
        <Text style={styles.eyebrow}>CHALLENGE</Text>
        <Text style={styles.title}>挑战</Text>
        <Text style={styles.subtitle}>
          保留题型与知识范围，让每道题更有挑战。
        </Text>
        <Text style={styles.muted}>
          支持空白或已作答的试卷照片、PDF。先解析原卷，再选择升档；学生原来的作答不会作为标准答案。
        </Text>
        <Text style={styles.muted}>
          目标是练透原卷知识点；这里展示训练目标与题目覆盖，个人掌握情况需结合后续作答与订正判断。
        </Text>

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
        {!!listError && (
          <Card>
            <Text style={styles.error}>{listError}</Text>
            <Button
              title="重新读取记录"
              secondary
              disabled={!!busy}
              onPress={() => {
                refresh();
              }}
            />
          </Card>
        )}

        {!record ? (
          <Card>
            <Text style={styles.heading}>上传一份试卷</Text>
            <Text style={styles.muted}>
              按页码顺序添加，可多次拍照，也可混合添加图片和 PDF。
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
        ) : (
          <Card>
            <Text style={styles.heading}>{record.title || '未命名试卷'}</Text>
            <Text style={styles.status}>
              {STATUS_LABELS[record.status]} · {record.pageUris.length} 页
            </Text>
            <View style={styles.actions}>
              <Button
                title="新建挑战"
                secondary
                disabled={!!busy}
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
                  onSelectionChange?.(undefined);
                  setError('');
                  setNotice('原卷已放回待解析列表，可补拍或添加缺少的页面。');
                }}
              />
            </View>
            {RUNNING_STATUSES.has(record.status) && !busy && (
              <Text style={styles.muted}>
                上次处理未完成，可以重新解析或继续升档。
              </Text>
            )}
            {!!record.error && record.error !== error && (
              <Text selectable style={styles.error}>
                {record.error}
              </Text>
            )}
          </Card>
        )}

        {pageUris.length > 0 && (
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
            {(busy === 'analysis' || busy === 'upgrade') && (
              <Button
                title="停止处理"
                secondary
                onPress={() => controller.current?.abort()}
              />
            )}
          </Card>
        )}

        <Card>
          <Text style={styles.heading}>科目与标准</Text>
          {confirmedSubject ? (
            <>
              <Text style={styles.body}>
                识别科目：{subjectIdentification!.courseName}
              </Text>
              {policy ? (
                <Text style={styles.status}>
                  已加载对应科目标准 · {policy.subjectLabel} · v
                  {CHALLENGE_RULES.version}
                </Text>
              ) : (
                <Text style={styles.error}>{policyError}</Text>
              )}
            </>
          ) : analysis ? (
            <Text style={styles.notice}>
              请重新解析以确认本卷科目，再按当前标准升档；已有 PDF 可继续浏览。
            </Text>
          ) : subjectIdentification ? (
            <>
              <Text style={styles.body}>
                已识别科目：{subjectIdentification.courseName}
              </Text>
              {identifiedRulesLoaded ? (
                <>
                  <Text style={styles.status}>已加载对应科目标准</Text>
                  <Text style={styles.muted}>
                    {record?.status === 'analyzing'
                      ? '正在核实整卷，解析完成后展示本卷的训练范围与提升要求。'
                      : '完成整卷解析后，可使用对应科目标准升档。'}
                  </Text>
                </>
              ) : (
                <Text style={styles.muted}>
                  正在加载对应科目标准，随后核实整卷。
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.muted}>
              先识别并确认原卷科目，再加载该科标准。科目不明或混合多科时，请补充清晰、完整的单科原卷。
            </Text>
          )}
          {subjectVerification && (
            <SubjectVerificationSummary verification={subjectVerification} />
          )}
        </Card>

        {!!analysis && (
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
              依据题目要求预估，不等同于实测难度系数。
            </Text>
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
            {analysis.unresolvedIssues.length > 0 && (
              <View>
                <Text style={styles.error}>
                  以下内容还不能确认，补充清晰、完整的页面后再升档：
                </Text>
                {analysis.unresolvedIssues.map((issue, index) => (
                  <Text key={index} style={styles.error}>
                    • {issue}
                  </Text>
                ))}
              </View>
            )}
            <Button
              title={showQuestions ? '收起逐题分析' : '查看逐题分析'}
              secondary
              onPress={() => setShowQuestions(value => !value)}
            />
            {showQuestions &&
              analysis.questions.map(question => (
                <View key={question.id} style={styles.question}>
                  <Text style={styles.label}>
                    {question.number}. {question.type}
                    {question.score !== null ? ` · ${question.score}分` : ''}
                    {question.isListening ? ' · 听力保留' : ''}
                  </Text>
                  <Text selectable style={styles.body}>
                    {question.stem}
                  </Text>
                  <Text style={styles.muted}>
                    知识点：{question.knowledgePoints.join('、')}
                  </Text>
                  <Text style={styles.muted}>
                    难度预估 {question.difficulty.rating} · 推理步骤约{' '}
                    {question.difficulty.reasoningSteps}：
                    {question.difficulty.explanation}
                  </Text>
                  {showAnswerDetails &&
                    record?.candidate?.questions
                      .filter(variant => variant.id === question.id)
                      .map(variant => (
                        <View key={variant.id} style={styles.review}>
                          <Text style={styles.label}>本次变种微调</Text>
                          {variant.upgrade.changes.map((change, index) => (
                            <Text key={index} style={styles.body}>
                              • {change}
                            </Text>
                          ))}
                          {variant.upgrade.directionEvidence?.map(evidence => (
                            <View
                              key={evidence.directionId}
                              style={styles.review}>
                              <Text style={styles.label}>
                                {policy?.deepDirections.find(
                                  direction =>
                                    direction.id === evidence.directionId,
                                )?.name || '深化思路'}
                              </Text>
                              <Text style={styles.body}>
                                原要求：{evidence.originalDemand}
                              </Text>
                              <Text style={styles.body}>
                                新要求：{evidence.newDemand}
                              </Text>
                            </View>
                          ))}
                          <Text style={styles.muted}>
                            {variant.upgrade.scopeExplanation}
                          </Text>
                        </View>
                      ))}
                </View>
              ))}
          </Card>
        )}

        <Card>
          <Text style={styles.heading}>选择升档难度</Text>
          <Text style={styles.muted}>
            当前使用深度与掌握训练标准 v{CHALLENGE_RULES.version}
            ，以下要求用于本次重新升档。
          </Text>
          {historicalPolicy && (
            <Text style={styles.notice}>
              此卷按旧版标准生成，重新升档可使用当前深度与掌握训练标准。
            </Text>
          )}
          <View style={styles.actions}>
            {([1, 2, 3] as const).map(value => (
              <Button
                key={value}
                title={`升 ${value} 档`}
                disabled={!!busy}
                secondary={level !== value}
                onPress={() => setLevel(value)}
              />
            ))}
          </View>
          {!confirmedSubject && !!policy && (
            <Text style={styles.notice}>
              正在参考所选科目的标准；本卷仍需独立识别并确认科目。
            </Text>
          )}
          {!!policyError && <Text style={styles.error}>{policyError}</Text>}
          {policy && (
            <>
              <Text style={styles.label}>
                {policy.subjectLabel} · {policy.label}
              </Text>
              <Text style={styles.body}>{policy.summary}</Text>
              <DepthSummary requirements={policy.depthRequirements} />
              <SubjectBlueprint
                blueprint={policy.subjectBlueprint}
                level={level}
                expanded={showPolicies}
              />
            </>
          )}
          <MasterySummary
            requirements={policy?.masteryRequirements}
            level={level}
          />
          {analysis && confirmedSubject && policy && (
            <MatchedMasteryCatalog analysis={analysis} level={level} />
          )}
          {!!policy?.deepDirections.length && (
            <Text style={styles.muted}>
              可深化的思路：
              {policy.deepDirections
                .map(direction => direction.name)
                .join('、')}
              。按原题条件选用，不能靠罗列方法名升档。
            </Text>
          )}
          {policy?.aspects.map((aspect, index) => (
            <Text key={index} style={styles.body}>
              • {aspect}
            </Text>
          ))}
          {policy?.metrics.map(metric => (
            <Text key={metric.key} style={styles.muted}>
              {metric.label}：{metric.min}
              {metric.max !== undefined ? `—${metric.max}` : ' 起'}
              {metricScope(metric)}
            </Text>
          ))}
          <Text style={styles.muted}>
            题型、题量和知识范围保持；英语听力沿用原题与原录音，不另造听力内容。每道非听力题按所选档位作变种微调。
          </Text>
          <Button
            title={showPolicies ? '收起各科标准' : '查看各科三档提升标准'}
            secondary
            disabled={!!busy}
            onPress={() => setShowPolicies(value => !value)}
          />
          {showPolicies && (
            <View>
              {!analysis && (
                <>
                  <Text style={styles.muted}>
                    选择一科查看参考标准；生成始终以原卷识别确认的科目为准。
                  </Text>
                  <View style={styles.actions}>
                    {CHALLENGE_RULES.subjects.map(item => (
                      <Button
                        key={item.subject}
                        title={item.label}
                        secondary={policySubject !== item.subject}
                        onPress={() => setPolicySubject(item.subject)}
                      />
                    ))}
                  </View>
                </>
              )}
              {(subjectRules ? [subjectRules] : []).map(item => (
                <View key={item.subject}>
                  <Text style={styles.label}>{item.label}三档标准</Text>
                  {!analysis && !!item.masteryChallenges?.length && (
                    <View style={styles.question}>
                      <Text style={styles.label}>可选易错与难点训练目录</Text>
                      <Text style={styles.muted}>
                        解析后按学段、原知识点和题型筛选，以下目录不是本卷已覆盖的项目。
                      </Text>
                      {item.masteryChallenges.map(challenge => (
                        <Text key={challenge.id} style={styles.body}>
                          • {challenge.name}
                          {challenge.educationLevels?.length
                            ? `（${challenge.educationLevels
                                .map(grade =>
                                  grade === 'high' ? '高中' : '初中',
                                )
                                .join('、')}原题适用）`
                            : ''}
                        </Text>
                      ))}
                    </View>
                  )}
                  {!!item.deepDirections?.length && (
                    <View style={styles.question}>
                      <Text style={styles.label}>可用深化方向</Text>
                      {item.deepDirections.map(direction => (
                        <View key={direction.id} style={styles.review}>
                          <Text style={styles.label}>{direction.name}</Text>
                          <Text style={styles.body}>
                            {direction.description}
                          </Text>
                          <Text style={styles.muted}>
                            {metricScope(direction)}
                          </Text>
                        </View>
                      ))}
                      <Text style={styles.muted}>
                        只在原题核心知识和题型内深化，可以重新组织条件与解法。不能承载所选档位时，会说明原因，不增加新知识硬升档。
                      </Text>
                    </View>
                  )}
                  {item.tiers.map(tier => (
                    <View key={tier.level} style={styles.question}>
                      <Text style={styles.label}>{tier.label}</Text>
                      <Text style={styles.body}>{tier.summary}</Text>
                      <DepthSummary requirements={tier.depthRequirements} />
                      <MasterySummary
                        requirements={tier.masteryRequirements}
                        level={tier.level}
                      />
                      {tier.aspects.map((aspect, index) => (
                        <Text key={index} style={styles.muted}>
                          • {aspect}
                        </Text>
                      ))}
                      {tier.metrics.map(metric => (
                        <Text key={metric.key} style={styles.muted}>
                          {metric.label}：{metric.min}
                          {metric.max !== undefined ? `—${metric.max}` : ' 起'}
                          {metricScope(metric)}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
          <Button
            title="升档"
            disabled={!canUpgrade || !!busy}
            onPress={() => {
              run(true);
            }}
          />
          <Text style={styles.label}>
            下一次生成评审：{reviewModeLabel(settings.roundtableSize)}
          </Text>
          <Text style={styles.muted}>
            可在模型设置中调整人数；生成开始时保存本次选择，历史评审按各卷记录显示。
          </Text>
          {!analysis && (
            <Text style={styles.muted}>先解析并核对原卷，之后可以升档。</Text>
          )}
        </Card>

        {!!record &&
          (record.reviewRounds.length > 0 ||
            record.reviewRoundtableSize !== undefined) && (
            <Card>
              <Text style={styles.heading}>生成校核</Text>
              <Text style={styles.label}>
                本次采用：
                {reviewModeLabel(
                  record.reviewRoundtableSize ??
                    record.reviewRounds[record.reviewRounds.length - 1]
                      ?.roundtableSize,
                )}
              </Text>
              <Text style={styles.muted}>
                按对应科目标准逐角色核对；本轮全部通过后输出试卷与答案，有修订意见则先修复，再由全部角色重新评审。
              </Text>
              {!record.reviewRounds.length && (
                <Text style={styles.muted}>新卷生成后开始本次评审。</Text>
              )}
              {record.reviewRounds.map(round => (
                <ReviewRoundSummary
                  key={round.round}
                  round={round}
                  record={record}
                  showDetails={showAnswerDetails}
                />
              ))}
            </Card>
          )}

        {pdfReady && (
          <Card>
            <Text style={styles.heading}>新试卷与答案</Text>
            <Text style={styles.status}>
              试卷校核已完成 · 升 {record!.level} 档
            </Text>
            <Text style={styles.muted}>
              本卷生成标准：{savedPolicyLabel(record?.policyVersion)}
            </Text>
            {historicalPolicy && (
              <Text style={styles.muted}>
                此卷按旧版标准生成，重新升档可使用当前深度与掌握训练标准。
              </Text>
            )}
            {pendingAudio && (
              <Text style={styles.muted}>
                听力保持原卷内容。未提供原录音或完整转写的题目，答案已标为待核，需配合原录音使用。
              </Text>
            )}
            {!showAnswerDetails && (
              <Text style={styles.muted}>
                具体解法、错因诊断与修订说明在答案侧查看，先完成试卷再核对。
              </Text>
            )}
            <View style={styles.actions}>
              <Button
                title="试卷 PDF"
                secondary={preview !== 'paper'}
                onPress={() => {
                  setPreview('paper');
                  setPreviewError('');
                  setPdfPage('');
                }}
              />
              <Button
                title="答案 PDF"
                secondary={preview !== 'answers'}
                onPress={() => {
                  setPreview('answers');
                  setPreviewError('');
                  setPdfPage('');
                }}
              />
            </View>
            <View style={styles.actions}>
              <Button
                title="下载试卷"
                disabled={!!busy}
                onPress={() => {
                  download(false);
                }}
              />
              <Button
                title="下载答案"
                secondary
                disabled={!!busy}
                onPress={() => {
                  download(true);
                }}
              />
            </View>
            <Text style={styles.muted}>可在下方浏览、双指缩放 {pdfPage}</Text>
            {previewError ? (
              <View>
                <Text style={styles.error}>PDF 预览失败：{previewError}</Text>
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
          </Card>
        )}

        <Text style={styles.sectionTitle}>最近挑战</Text>
        {loading ? (
          <ActivityIndicator color="#A55B17" />
        ) : records.length === 0 ? (
          <Card>
            <Text style={styles.muted}>还没有挑战，先上传一份试卷。</Text>
          </Card>
        ) : (
          records.map(value => (
            <Card key={value.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`打开挑战${value.title || '未命名试卷'}`}
                disabled={!!busy}
                onPress={() => {
                  open(value.id);
                }}>
                <Text style={styles.label}>{value.title || '未命名试卷'}</Text>
                <Text style={styles.muted}>
                  {new Date(value.createdAt).toLocaleString()} ·{' '}
                  {value.pageUris.length} 页 · {STATUS_LABELS[value.status]}
                </Text>
              </Pressable>
              <View style={styles.actions}>
                <Button
                  title={`打开${value.title || '未命名试卷'}`}
                  secondary
                  disabled={!!busy}
                  onPress={() => {
                    open(value.id);
                  }}
                />
                <Button
                  title={`删除${value.title || '未命名试卷'}`}
                  secondary
                  disabled={!!busy || draftUsesRecord(sources, value)}
                  onPress={() => removeRecord(value)}
                />
              </View>
              {draftUsesRecord(sources, value) && (
                <Text style={styles.muted}>
                  当前补充页面正在使用此记录，完成解析或移除这些页面后可删除。
                </Text>
              )}
            </Card>
          ))
        )}
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
  safe: {flex: 1, backgroundColor: '#F8F8FB'},
  container: {padding: 20, paddingBottom: 48, gap: 16},
  header: {
    flexDirection: 'row',
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
  pdf: {height: 560, width: '100%', backgroundColor: '#E2E8F0'},
});
