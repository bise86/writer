import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {ChallengeRecord} from '../challenge/types';
import {CHALLENGE_STATUS_LABELS} from '../challenge/presentation';

export default function ChallengeHome({
  records,
  busy,
  loading,
  error,
  onBack,
  onManage,
  onSettings,
  onCamera,
  onPhotos,
  onPdf,
  onOpen,
  onRefresh,
}: {
  records: ChallengeRecord[];
  busy: boolean;
  loading: boolean;
  error: string;
  onBack: () => void;
  onManage: () => void;
  onSettings: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onPdf: () => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text style={styles.back}>‹ 返回首页</Text>
        </Pressable>
        <View style={styles.header}>
          <Text style={styles.title}>挑战</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onManage}
              disabled={busy}>
              <Text style={styles.link}>管理</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onSettings}
              disabled={busy}>
              <Text style={styles.link}>模型设置</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.subtitle}>在原知识范围内，让试卷更有深度。</Text>
        <View style={styles.startCard}>
          <Text style={styles.heading}>开始试卷升华</Text>
          <Text style={styles.muted}>
            拍照或上传多张照片，逐张裁剪；每份试卷可上传一个 PDF。
          </Text>
          <View style={styles.actions}>
            {[
              ['拍照', onCamera],
              ['上传照片', onPhotos],
              ['上传 PDF', onPdf],
            ].map(([label, action]) => (
              <Pressable
                key={label as string}
                accessibilityRole="button"
                disabled={busy}
                onPress={action as () => void}
                style={[styles.button, busy && styles.disabled]}>
                <Text style={styles.buttonText}>{label as string}</Text>
              </Pressable>
            ))}
          </View>
          {busy && <ActivityIndicator color="#A55B17" />}
        </View>
        {!!error && (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Pressable accessibilityRole="button" onPress={onRefresh}>
              <Text style={styles.link}>重新读取记录</Text>
            </Pressable>
          </View>
        )}
        <Text style={styles.heading}>最近挑战</Text>
        {loading ? (
          <ActivityIndicator color="#A55B17" />
        ) : !records.length ? (
          <View style={styles.card}>
            <Text style={styles.muted}>还没有挑战，先上传一份试卷。</Text>
          </View>
        ) : (
          records.map(record => (
            <Pressable
              key={record.id}
              accessibilityRole="button"
              accessibilityLabel={`打开挑战${record.title || '待解析试卷'}`}
              disabled={busy}
              onPress={() => onOpen(record.id)}
              style={styles.card}>
              <Text style={styles.recordTitle}>
                {record.analysis?.title ||
                  (record.status === 'imported'
                    ? '待解析试卷'
                    : record.title) ||
                  '待解析试卷'}
              </Text>
              <Text style={styles.muted}>
                {new Date(record.createdAt).toLocaleString()} ·{' '}
                {record.pageUris.length} 页
              </Text>
              <Text style={styles.status}>
                {CHALLENGE_STATUS_LABELS[record.status]}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F8F8FB'},
  container: {padding: 20, paddingBottom: 48, gap: 18},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {fontSize: 28, fontWeight: '800', color: '#172033'},
  heading: {fontSize: 20, fontWeight: '700', color: '#172033'},
  back: {
    color: '#A55B17',
    fontSize: 16,
    paddingVertical: 10,
    fontWeight: '700',
  },
  link: {color: '#A55B17', fontWeight: '700', fontSize: 15},
  subtitle: {color: '#64748b', fontSize: 15},
  muted: {fontSize: 13, color: '#64748b', lineHeight: 21},
  startCard: {
    backgroundColor: '#FFF4E6',
    padding: 20,
    borderRadius: 18,
    gap: 14,
  },
  card: {backgroundColor: '#fff', padding: 18, borderRadius: 16, gap: 8},
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  button: {backgroundColor: '#A55B17', padding: 13, borderRadius: 10},
  buttonText: {fontWeight: '700', color: '#fff'},
  disabled: {opacity: 0.45},
  recordTitle: {fontSize: 17, fontWeight: '700', color: '#172033'},
  status: {fontSize: 13, color: '#A55B17'},
  error: {color: '#b91c1c', lineHeight: 22},
});
