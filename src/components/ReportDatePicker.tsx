import React, {useState} from 'react';
import {
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {dateLabel, parseDate} from '../services/reports';

export default function ReportDatePicker({
  label,
  value,
  onSelect,
  onClose,
}: {
  label: string;
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const initial = parseDate(value) || new Date();
  const [month, setMonth] = useState(
    new Date(initial.getFullYear(), initial.getMonth(), 1),
  );
  const [error, setError] = useState('');
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const padding = (month.getDay() + 6) % 7;
  const cells = Array.from(
    {length: Math.ceil((padding + days) / 7) * 7},
    (_, i) => i - padding + 1,
  );
  const navigate = (offset: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.dialogContent}>
            <Text style={styles.heading}>{label}</Text>
            <TextInput
              accessibilityLabel={`${label}输入`}
              value={draft}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#64748b"
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={10}
              style={styles.input}
              onChangeText={text => {
                setDraft(text);
                setError('');
                const parsed = parseDate(text);
                if (parsed) {
                  setMonth(
                    new Date(parsed.getFullYear(), parsed.getMonth(), 1),
                  );
                }
              }}
            />
            <View style={styles.navigation}>
              <Pressable
                accessibilityLabel="上个月"
                accessibilityRole="button"
                disabled={
                  month.getFullYear() === 1900 && month.getMonth() === 0
                }
                onPress={() => navigate(-1)}
                style={styles.action}>
                <Text style={styles.link}>‹</Text>
              </Pressable>
              <Text style={styles.month}>
                {month.getFullYear()} 年 {month.getMonth() + 1} 月
              </Text>
              <Pressable
                accessibilityLabel="下个月"
                accessibilityRole="button"
                disabled={
                  month.getFullYear() === 9998 && month.getMonth() === 11
                }
                onPress={() => navigate(1)}
                style={styles.action}>
                <Text style={styles.link}>›</Text>
              </Pressable>
            </View>
            <View style={styles.grid}>
              {['一', '二', '三', '四', '五', '六', '日'].map(day => (
                <View key={day} style={styles.cell}>
                  <Text style={styles.muted}>{day}</Text>
                </View>
              ))}
              {cells.map((day, i) => {
                if (day < 1 || day > days) {
                  return <View key={`blank-${i}`} style={styles.cell} />;
                }
                const date = dateLabel(
                  new Date(month.getFullYear(), month.getMonth(), day),
                );
                const selected = date === draft;
                return (
                  <Pressable
                    key={date}
                    accessibilityRole="button"
                    accessibilityLabel={date}
                    accessibilityState={{selected}}
                    style={[styles.cell, selected && styles.selected]}
                    onPress={() => {
                      setDraft(date);
                      setError('');
                    }}>
                    <Text style={[styles.day, selected && styles.selectedText]}>
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={styles.action}>
                <Text style={styles.muted}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (!parseDate(draft)) {
                    setError('请输入有效日期，例如 2026-10-09');
                    return;
                  }
                  onSelect(draft);
                }}
                style={styles.confirm}>
                <Text style={styles.selectedText}>确定</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0f172a80',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '95%',
    backgroundColor: '#fff',
    borderRadius: 18,
  },
  dialogContent: {padding: 16},
  heading: {fontSize: 18, fontWeight: '700', color: '#0f172a'},
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    color: '#0f172a',
    marginTop: 14,
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  month: {fontSize: 16, fontWeight: '700', color: '#334155'},
  grid: {flexDirection: 'row', flexWrap: 'wrap'},
  cell: {
    width: '14.285714%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  day: {fontSize: 15, color: '#334155'},
  selected: {backgroundColor: '#2563eb'},
  selectedText: {color: '#fff', fontWeight: '700'},
  action: {padding: 12},
  link: {color: '#2563eb', fontSize: 24},
  muted: {color: '#64748b', fontSize: 14},
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    marginTop: 10,
  },
  confirm: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  error: {color: '#b91c1c', marginTop: 8},
});
