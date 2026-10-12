import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {WritingType} from '../types';
import {getWritingProfile} from '../services/writing';

const artwork = {
  chinese: require('../assets/landing/chinese.png'),
  english: require('../assets/landing/english.png'),
};

export default function WritingModeChooser({
  onSelect,
}: {
  onSelect: (type: WritingType) => void;
}) {
  return (
    <View style={styles.root} accessibilityLabel="选择批改类型">
      <View style={styles.row}>
        {(['chinese', 'english'] as WritingType[]).map(type => {
          const profile = getWritingProfile(type);
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={`进入${profile.title}`}
              onPress={() => onSelect(type)}
              style={styles.card}>
              <Image source={artwork[type]} style={styles.image} />
              <Text style={styles.title}>{profile.title}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {width: '100%', maxWidth: 700, alignSelf: 'center'},
  row: {flexDirection: 'row', gap: 16},
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  image: {width: '100%', aspectRatio: 1, borderRadius: 11},
  title: {fontSize: 18, color: '#0f172a', fontWeight: '800', marginVertical: 12, textAlign: 'center'},
});
