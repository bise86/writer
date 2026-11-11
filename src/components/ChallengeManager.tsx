import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {ChallengeRecord} from '../challenge/types';
import {CHALLENGE_STATUS_LABELS} from '../challenge/presentation';

function Button({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}>
      <Text style={styles.link}>{title}</Text>
    </Pressable>
  );
}

export default function ChallengeManager({
  records,
  protectedIds,
  loading,
  busy,
  error,
  onBack,
  onRefresh,
  onOpen,
  onDelete,
}: {
  records: ChallengeRecord[];
  protectedIds: string[];
  loading: boolean;
  busy: boolean;
  error: string;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const mounted = useRef(true);
  const deletionLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const eligible = records.filter(value => !protectedIds.includes(value.id));
  const selected = eligible
    .filter(value => selectedIds.includes(value.id))
    .map(value => value.id);
  const disabled = busy || deleting;
  const toggle = (id: string) => {
    if (disabled || protectedIds.includes(id)) {
      return;
    }
    setSelectedIds(values =>
      values.includes(id)
        ? values.filter(value => value !== id)
        : [...values, id],
    );
  };
  const confirmDelete = (ids: string[], days?: number) => {
    if (disabled || !ids.length) {
      return;
    }
    Alert.alert(
      days ? '按时间清理' : '删除挑战',
      `确定删除${days ? ` ${days} 天前创建的` : '选中的'} ${
        ids.length
      } 份挑战及其原卷、试卷、答案和调用记录吗？正在处理的任务会停止。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: days ? '确认清理' : '删除',
          style: 'destructive',
          onPress: async () => {
            // Ignore confirmations from a management view already left behind.
            if (!mounted.current || deletionLock.current) {
              return;
            }
            deletionLock.current = true;
            setDeleting(true);
            try {
              await onDelete(ids);
              if (mounted.current) {
                setSelectedIds([]);
              }
            } catch (reason) {
              if (mounted.current) {
                Alert.alert(
                  '删除失败',
                  reason instanceof Error ? reason.message : String(reason),
                );
              }
            } finally {
              deletionLock.current = false;
              if (mounted.current) {
                setDeleting(false);
              }
            }
          },
        },
      ],
    );
  };
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={onBack}>
            <Text style={styles.back}>‹ 返回挑战</Text>
          </Pressable>
          <Text style={styles.title}>挑战管理</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>批量操作</Text>
          <Text style={styles.muted}>
            点选记录后可批量删除；按时间清理只影响挑战记录。
          </Text>
          {!!protectedIds.length && (
            <Text style={styles.muted}>
              当前补充页面正在使用的记录暂不可删除，完成解析或移除这些页面后可删除。
            </Text>
          )}
          <View style={styles.actions}>
            <Button
              title={`删除已选（${selected.length}）`}
              disabled={disabled || !selected.length}
              onPress={() => confirmDelete(selected)}
            />
            <Button
              title="全选"
              disabled={disabled || !eligible.length}
              onPress={() => setSelectedIds(eligible.map(value => value.id))}
            />
          </View>
          <View style={styles.actions}>
            {[7, 30, 90].map(days => {
              const cutoff = Date.now() - days * 86400000;
              const ids = eligible
                .filter(value => Date.parse(value.createdAt) < cutoff)
                .map(value => value.id);
              return (
                <Button
                  key={days}
                  title={`清理 ${days} 天前`}
                  disabled={disabled || !ids.length}
                  onPress={() => confirmDelete(ids, days)}
                />
              );
            })}
          </View>
        </View>
        {!!error && (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button
              title="重新读取记录"
              disabled={disabled}
              onPress={() => {
                onRefresh();
              }}
            />
          </View>
        )}
        {loading ? (
          <ActivityIndicator color="#A55B17" />
        ) : !records.length ? (
          <Text style={styles.muted}>暂无挑战记录。</Text>
        ) : (
          records.map(value => {
            const checked = selected.includes(value.id);
            const protectedSource = protectedIds.includes(value.id);
            return (
              <View key={value.id} style={styles.card}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`选择${value.title || '未命名试卷'}`}
                  accessibilityState={{
                    checked,
                    disabled: disabled || protectedSource,
                  }}
                  disabled={disabled || protectedSource}
                  onPress={() => toggle(value.id)}
                  style={styles.row}>
                  <View style={[styles.checkbox, checked && styles.checked]}>
                    {checked && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  {!!value.pageUris[0] && (
                    <Image
                      source={{uri: value.pageUris[0]}}
                      style={styles.thumb}
                    />
                  )}
                  <View style={styles.meta}>
                    <Text style={styles.heading}>
                      {value.title || '未命名试卷'}
                    </Text>
                    <Text style={styles.muted}>
                      {new Date(value.createdAt).toLocaleString()}
                    </Text>
                    <Text style={styles.muted}>
                      {value.pageUris.length} 页 ·{' '}
                      {CHALLENGE_STATUS_LABELS[value.status]}
                    </Text>
                    {protectedSource && (
                      <Text style={styles.muted}>正在补充页面，暂不可删除</Text>
                    )}
                  </View>
                </Pressable>
                <Button
                  title={`打开${value.title || '未命名试卷'}`}
                  disabled={disabled}
                  onPress={() => onOpen(value.id)}
                />
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F8F8FB'},
  container: {padding: 20, paddingBottom: 48, gap: 16},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  back: {
    fontSize: 16,
    color: '#A55B17',
    fontWeight: '700',
    paddingVertical: 12,
  },
  title: {fontSize: 20, color: '#172033', fontWeight: '700'},
  card: {backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12},
  heading: {fontSize: 16, fontWeight: '700', color: '#172033'},
  muted: {fontSize: 13, color: '#64748b', lineHeight: 21},
  error: {color: '#b91c1c', lineHeight: 22},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  button: {
    backgroundColor: '#FFF5E8',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  link: {color: '#965414', fontWeight: '700'},
  disabled: {opacity: 0.45},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12},
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: {backgroundColor: '#A55B17', borderColor: '#A55B17'},
  checkMark: {color: '#fff', fontWeight: '700'},
  thumb: {width: 44, height: 60, borderRadius: 6, backgroundColor: '#f1f5f9'},
  meta: {flex: 1, gap: 4},
});
