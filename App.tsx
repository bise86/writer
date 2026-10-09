import React, {useEffect, useRef, useState} from 'react';
import {
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
  listEssays,
  saveSettings,
} from './src/db/database';
import {AppSettings, Essay} from './src/types';
import Detail from './src/components/EssayDetail';
import {retryEssay, runEssayPipeline} from './src/services/pipeline';
import {
  OUTPUT_TOKEN_OPTIONS,
  REASONING_LEVELS,
  ROUNDTABLE_OPTIONS,
  validateSettings,
} from './src/settings';
import {
  cropImage,
  discardPreparedImages,
  persistImage,
} from './src/services/images';
import ImageCropper from './src/components/ImageCropper';
import Reports from './src/components/Reports';
import {recentMonth} from './src/services/reports';
import Startup, {StartupData} from './src/components/Startup';

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

function Home({
  essays,
  onCapture,
  onOpen,
  onSettings,
  onManage,
  onReports,
  capturing,
}: {
  essays: Essay[];
  onCapture: (camera: boolean) => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
  onManage: () => void;
  onReports: () => void;
  capturing: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ESSAY LENS</Text>
            <Text style={styles.title}>作文批改</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={onManage} style={styles.headerAction}>
              <Text style={styles.headerActionText}>管理</Text>
            </Pressable>
            <Pressable
              onPress={onReports}
              style={styles.headerAction}
              accessibilityRole="button">
              <Text style={styles.headerActionText}>报表</Text>
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
            <Button
              title="拍照"
              disabled={capturing}
              onPress={() => onCapture(true)}
            />
            <Button
              title="选择图片（可多选）"
              secondary
              disabled={capturing}
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
          图片识别、原图复核和评分共用此云端模型，请选择支持图片输入的模型。
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
          <Text style={styles.fieldLabel}>评分与批注圆桌评审</Text>
          <Text style={styles.muted}>
            默认关闭。选择 3 或 5
            后，提示模型按相应角色数量进行圆桌讨论和投票，统一生成最终评分与批注。角色分工、会议讨论和结果修订均由模型完成。
          </Text>
          <View style={styles.actionRow}>
            {ROUNDTABLE_OPTIONS.map(size => (
              <Button
                key={size}
                title={size === 0 ? '0 · 关闭' : `${size} 个角色`}
                secondary={settings.roundtableSize !== size}
                onPress={() => setSettings({...settings, roundtableSize: size})}
              />
            ))}
          </View>
        </View>
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
  const [reportRange, setReportRange] = useState(recentMonth);
  const [detailOrigin, setDetailOrigin] = useState<'home' | 'reports'>('home');
  const captureLock = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const [cropTask, setCropTask] = useState<{
    asset: Asset;
    pageLabel: string;
    resolve: (uri?: string) => void;
  }>();
  const [screen, setScreen] = useState<
    'home' | 'detail' | 'settings' | 'manage' | 'reports'
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
  const prepareAsset = async (
    asset: Asset | undefined,
    pageLabel: string,
  ): Promise<string | undefined> => {
    if (!asset?.uri) {
      throw new Error('未读取到所选图片，请重新选择或拍摄');
    }
    return new Promise(resolve => setCropTask({asset, pageLabel, resolve}));
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
    if (captureLock.current) {
      return;
    }
    captureLock.current = true;
    setCapturing(true);
    const imageUris: string[] = [];
    let committed = false;
    try {
      if (camera && !(await cameraPermission())) {
        Alert.alert(
          '无法打开相机',
          '相机权限未授权，请在系统设置中允许相机权限。',
        );
        return;
      }
      if (camera) {
        let continueCapturing = true;
        while (continueCapturing) {
          const result = await launchCamera({
            mediaType: 'photo',
            cameraType: 'back',
            includeBase64: false,
            quality: 1,
            saveToPhotos: false,
          });
          if (result.errorCode) {
            throw new Error(
              result.errorMessage || `相机错误：${result.errorCode}`,
            );
          }
          if (result.didCancel || !result.assets?.length) {
            break;
          }
          const uri = await prepareAsset(
            result.assets[0],
            `第 ${imageUris.length + 1} 张`,
          );
          if (!uri) {
            return;
          }
          imageUris.push(uri);
          continueCapturing = await askContinueCamera();
        }
      } else {
        const result = await launchImageLibrary({
          mediaType: 'photo',
          includeBase64: false,
          quality: 1,
          selectionLimit: 0,
          assetRepresentationMode: 'compatible',
        });
        if (result.errorCode) {
          throw new Error(
            result.errorMessage || `图片选择错误：${result.errorCode}`,
          );
        }
        const assets = result.assets || [];
        for (const [index, asset] of assets.entries()) {
          const uri = await prepareAsset(
            asset,
            `${index + 1} / ${assets.length}`,
          );
          if (!uri) {
            return;
          }
          imageUris.push(uri);
        }
      }
      if (!imageUris.length) {
        return;
      }
      const essay = await createEssay(imageUris);
      committed = true;
      setSelected(essay);
      setDetailOrigin('home');
      setScreen('detail');
      await refresh();
      runEssayPipeline(essay).then(refresh).catch(refresh);
    } catch (error) {
      Alert.alert(
        '无法获取图片',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (!committed) {
        await discardPreparedImages(imageUris);
      }
      captureLock.current = false;
      setCapturing(false);
    }
  };
  if (cropTask) {
    return (
      <ImageCropper
        key={`${cropTask.pageLabel}-${cropTask.asset.uri}`}
        uri={cropTask.asset.uri!}
        pageLabel={cropTask.pageLabel}
        onCancel={() => {
          setCropTask(undefined);
          cropTask.resolve();
        }}
        onSubmit={async choice => {
          const uri =
            choice.kind === 'original'
              ? await persistImage(cropTask.asset.uri!, cropTask.asset)
              : await cropImage(
                  cropTask.asset.uri!,
                  choice.source,
                  choice.rect,
                );
          setCropTask(undefined);
          cropTask.resolve(uri);
        }}
      />
    );
  }
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
  if (screen === 'reports') {
    return (
      <Reports
        initialRange={reportRange}
        onRangeChange={setReportRange}
        onBack={() => setScreen('home')}
        onOpenEssay={async id => {
          try {
            const essay = await getEssay(id);
            if (!essay) {
              Alert.alert('作文不存在', '这篇作文已删除，请刷新报表。');
              return;
            }
            setSelected(essay);
            setDetailOrigin('reports');
            setScreen('detail');
          } catch (error) {
            Alert.alert(
              '无法打开作文',
              error instanceof Error ? error.message : String(error),
            );
          }
        }}
      />
    );
  }
  if (screen === 'detail' && selected) {
    return (
      <Detail
        essay={selected}
        onBack={() => {
          setScreen(detailOrigin);
          refresh();
        }}
        onRecognize={() =>
          runEssayPipeline(selected, undefined, 'vision_ocr')
            .then(async () => {
              setSelected(await getEssay(selected.id));
              refresh();
            })
            .catch(async () => setSelected(await getEssay(selected.id)))
        }
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
      capturing={capturing}
      onCapture={capture}
      onOpen={async id => {
        setSelected(await getEssay(id));
        setDetailOrigin('home');
        setScreen('detail');
      }}
      onSettings={() => setScreen('settings')}
      onManage={() => setScreen('manage')}
      onReports={() => {
        setReportRange(recentMonth());
        setScreen('reports');
      }}
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
  errorText: {color: '#dc2626', fontSize: 13},
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
