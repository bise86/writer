import React, {useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';

export default function Select<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: {value: T; label: string}[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{disabled: !!disabled, expanded: open}}
        disabled={disabled}
        style={[styles.trigger, disabled && styles.disabled]}
        onPress={() => setOpen(true)}>
        <Text style={styles.text}>{selected?.label || String(value)} ▾</Text>
      </Pressable>
      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}>
          <View style={styles.overlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityLabel="关闭选择"
              onPress={() => setOpen(false)}
            />
            <View style={styles.menu} accessibilityViewIsModal>
              <Text style={styles.heading}>{label}</Text>
              {options.map(option => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{checked: option.value === value}}
                  style={styles.option}
                  onPress={() => {
                    setOpen(false);
                    onChange(option.value);
                  }}>
                  <Text style={styles.text}>
                    {option.label}
                    {option.value === value ? ' ✓' : ''}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                style={styles.option}
                onPress={() => setOpen(false)}>
                <Text style={styles.text}>取消</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  trigger: {
    borderWidth: 1,
    borderColor: '#d8dce5',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  text: {color: '#334155', fontSize: 14},
  disabled: {opacity: 0.45},
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#0005',
  },
  menu: {backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 8},
  heading: {fontSize: 17, fontWeight: '700', color: '#172033', marginBottom: 8},
  option: {paddingVertical: 14},
});
