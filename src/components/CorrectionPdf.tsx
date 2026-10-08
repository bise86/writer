import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Pdf from 'react-native-pdf';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {Essay, ScoreResult} from '../types';
import {buildAnnotatedPdf} from '../services/annotated-pdf';

export default function CorrectionPdf({
  essay,
  score,
}: {
  essay: Essay;
  score: ScoreResult;
}) {
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState('');
  useEffect(() => {
    let active = true;
    let path = '';
    setUri('');
    setError('');
    setPage('');
    const generate = async () => {
      const base64 = await buildAnnotatedPdf(
        essay.canonicalText,
        essay.title,
        score,
      );
      if (!active) {
        return;
      }
      path = `${RNFS.CachesDirectoryPath}/essay-correction-${essay.id.replace(
        /[^a-zA-Z0-9_-]/g,
        '_',
      )}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      await RNFS.writeFile(path, base64, 'base64');
      if (active) {
        setUri(`file://${path}`);
      } else {
        await RNFS.unlink(path).catch(() => undefined);
      }
    };
    generate().catch(reason => {
      if (active) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });
    return () => {
      active = false;
      // Keep completed files in the cache for external share readers. Settings can clear them.
    };
  }, [essay.id, essay.canonicalText, essay.title, score, attempt]);
  const exportPdf = async () => {
    if (!uri || exporting) {
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      await Share.open({
        url: uri,
        type: 'application/pdf',
        title: `${essay.title || '作文'}批改`,
        failOnCancel: false,
      });
    } catch (reason) {
      setExportError(
        `导出失败：${
          reason instanceof Error ? reason.message : String(reason)
        }`,
      );
    } finally {
      setExporting(false);
    }
  };
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.help}>
          左侧完整原文，右侧批注 · 彩色文字与划线对应批注编号 · 可双指缩放{' '}
          {page}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={exportPdf}
          disabled={!uri || exporting}
          style={[styles.button, (!uri || exporting) && styles.disabled]}>
          <Text style={styles.buttonText}>
            {exporting ? '正在导出…' : '导出 PDF'}
          </Text>
        </Pressable>
      </View>
      {!!exportError && <Text style={styles.error}>{exportError}</Text>}
      {error ? (
        <View style={styles.message}>
          <Text style={styles.error}>批改 PDF 打开失败：{error}</Text>
          <Pressable
            onPress={() => setAttempt(value => value + 1)}
            style={styles.button}>
            <Text style={styles.buttonText}>重新生成</Text>
          </Pressable>
        </View>
      ) : uri ? (
        <Pdf
          source={{
            uri:
              (Platform.OS as string) === 'harmony'
                ? uri.replace(/^file:\/\//, '')
                : uri,
            cache: false,
          }}
          style={styles.pdf}
          trustAllCerts={false}
          onPageChanged={(current, count) => setPage(`${current}/${count}`)}
          onError={reason => setError(String(reason))}
        />
      ) : (
        <View style={styles.message}>
          <ActivityIndicator color="#2563eb" />
          <Text style={styles.help}>正在生成原文和批注 PDF…</Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: {flex: 1},
  toolbar: {padding: 12, gap: 10, flexDirection: 'row', alignItems: 'center'},
  help: {flexShrink: 1, color: '#475569', fontSize: 12, lineHeight: 20},
  button: {backgroundColor: '#2563eb', borderRadius: 8, padding: 10},
  buttonText: {color: '#fff', fontWeight: '700'},
  disabled: {opacity: 0.4},
  pdf: {flex: 1, backgroundColor: '#e2e8f0'},
  message: {
    flex: 1,
    padding: 24,
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {color: '#b91c1c', padding: 12, lineHeight: 22},
});
