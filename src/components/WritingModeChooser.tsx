import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {WritingType} from '../types';
import {getWritingProfile} from '../services/writing';

const artwork = {
  chinese: require('../assets/landing/chinese.png'),
  english: require('../assets/landing/english.png'),
};

export default function WritingModeChooser({
  active,
  onSelect,
}: {
  active: WritingType;
  onSelect: (type: WritingType) => void;
}) {
  return (
    <View style={styles.root} accessibilityLabel="选择批改类型">
      <Text style={styles.heading}>选择批改类型</Text>
      <Text style={styles.hint}>点击图片进入对应的识别、评分和批改功能。</Text>
      <View style={styles.row}>
        {(['chinese', 'english'] as WritingType[]).map(type => {
          const profile = getWritingProfile(type);
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={`进入${profile.title}`}
              onPress={() => onSelect(type)}
              style={[styles.card, active === type && styles.active]}>
              <Image source={artwork[type]} style={styles.image} />
              <Text style={styles.title}>{profile.title}</Text>
              <Text style={styles.label}>{profile.label} · 拍照识别评分</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {marginBottom: 18},
  heading: {fontSize: 18, color: '#0f172a', fontWeight: '800'},
  hint: {fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 20},
  row: {flexDirection: 'row', gap: 12, marginTop: 12},
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  active: {borderColor: '#2563eb', backgroundColor: '#eff6ff'},
  image: {width: '100%', height: 104, borderRadius: 11},
  title: {fontSize: 15, color: '#0f172a', fontWeight: '800', marginTop: 8},
  label: {fontSize: 11, color: '#64748b', marginTop: 3},
});
