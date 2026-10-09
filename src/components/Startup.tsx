import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {getSettings, initDatabase, listEssays} from '../db/database';
import {AppSettings, Essay} from '../types';

export interface StartupData {
  settings: AppSettings;
  essays: Essay[];
}

function errorMessage(error: unknown) {
  // Native modules can reject with {message, code} rather than an Error.
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return typeof error === 'string' ? error : '发生未知错误，请重试';
}

export default function Startup({
  children,
}: {
  children: (data: StartupData) => React.ReactNode;
}) {
  const [data, setData] = useState<StartupData>();
  const [stage, setStage] = useState('正在打开本地数据库');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<Promise<StartupData>>();
  const report = useRef<(message: string) => void>(() => {});

  useEffect(() => {
    let active = true;
    setError('');
    report.current = setStage;
    const timeout = setTimeout(() => {
      if (active) {
        setError(
          '本地数据准备超过 15 秒。可以重试；若仍无响应，请关闭应用后重新打开。',
        );
      }
    }, 15_000);
    if (!pending.current) {
      const load = async (): Promise<StartupData> => {
        report.current('正在打开本地数据库');
        await initDatabase();
        report.current('正在读取设置');
        const settings = await getSettings();
        report.current('正在读取作文记录');
        return {settings, essays: await listEssays()};
      };
      pending.current = load();
      const request = pending.current;
      const settled = () => {
        if (pending.current === request) {
          pending.current = undefined;
        }
      };
      request.then(settled, settled);
    }
    // A timeout only changes the UI. Reuse an unfinished load on retry so two
    // schema migrations cannot run against the same database at the same time.
    pending.current.then(
      result => {
        clearTimeout(timeout);
        if (active) {
          setError('');
          setData(result);
        }
      },
      reason => {
        clearTimeout(timeout);
        if (active) {
          setError(errorMessage(reason));
        }
      },
    );
    return () => {
      active = false;
      report.current = () => {};
      clearTimeout(timeout);
    };
  }, [attempt]);

  if (data) {
    return <>{children(data)}</>;
  }
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.title}>作文批改</Text>
        {!error && <ActivityIndicator size="large" color="#2563eb" />}
        <Text style={styles.stage}>{stage}</Text>
        {!!error && (
          <>
            <Text style={styles.errorTitle}>启动未完成</Text>
            <Text selectable style={styles.error}>
              {error}
            </Text>
            <Text style={styles.hint}>
              本机作文和设置会保留，无需卸载或清除数据。
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt(value => value + 1)}
              style={styles.button}>
              <Text style={styles.buttonText}>重试启动</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f7f8fc'},
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 16,
  },
  title: {fontSize: 28, fontWeight: '700', color: '#111827'},
  stage: {fontSize: 16, color: '#475569', textAlign: 'center'},
  errorTitle: {fontSize: 18, fontWeight: '600', color: '#b91c1c'},
  error: {color: '#b91c1c', textAlign: 'center'},
  hint: {color: '#64748b', textAlign: 'center'},
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {color: '#fff', fontWeight: '600', fontSize: 16},
});
