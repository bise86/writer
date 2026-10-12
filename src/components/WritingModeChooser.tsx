import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {WritingType} from '../types';
import {getWritingProfile} from '../services/writing';

const modes: {
  type: WritingType;
  glyph: string;
  caption: string;
  accent: string;
  background: string;
  border: string;
  decoration: string;
}[] = [
  {
    type: 'chinese',
    glyph: '文',
    caption: '写得具体，表达生动',
    accent: '#355CC9',
    background: '#F0F4FF',
    border: '#DDE5FA',
    decoration: '#E3EBFF',
  },
  {
    type: 'english',
    glyph: 'Aa',
    caption: '用词准确，行文自然',
    accent: '#167A68',
    background: '#EDF8F4',
    border: '#D8EBE3',
    decoration: '#DCEFE6',
  },
];

export default function WritingModeChooser({
  onSelect,
}: {
  onSelect: (type: WritingType) => void;
}) {
  return (
    <View style={styles.root} accessibilityLabel="选择批改类型">
      <View style={styles.row}>
        {modes.map(mode => {
          const profile = getWritingProfile(mode.type);
          return (
            <View key={mode.type} style={styles.slot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`进入${profile.title}`}
                onPress={() => onSelect(mode.type)}
                style={({pressed}) => [
                  styles.card,
                  pressed && styles.cardPressed,
                ]}>
                <View
                  style={[
                    styles.surface,
                    {
                      backgroundColor: mode.background,
                      borderColor: mode.border,
                    },
                  ]}>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.decoration,
                      {backgroundColor: mode.decoration},
                    ]}
                  />
                  <View
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.cardHeader}>
                    <View style={styles.icon}>
                      <View
                        style={[
                          styles.iconPage,
                          {backgroundColor: mode.decoration},
                        ]}
                      />
                      <View style={styles.iconFace}>
                        <Text
                          allowFontScaling={false}
                          style={[styles.glyph, {color: mode.accent}]}>
                          {mode.glyph}
                        </Text>
                      </View>
                    </View>
                    <View style={[styles.arrow, {borderColor: mode.accent}]} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.title}>{profile.title}</Text>
                    <Text style={styles.caption}>{mode.caption}</Text>
                  </View>
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {width: '100%', maxWidth: 720, alignSelf: 'center'},
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -7,
  },
  // A half-width slot keeps the final entry in its column when the count is odd.
  slot: {width: '50%', paddingHorizontal: 7, paddingBottom: 14},
  card: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#233655',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 2,
  },
  cardPressed: {opacity: 0.85, transform: [{scale: 0.98}]},
  surface: {
    flex: 1,
    minHeight: 190,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  decoration: {
    position: 'absolute',
    width: 134,
    height: 134,
    borderRadius: 67,
    top: -54,
    right: -50,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  icon: {width: 54, height: 54},
  iconPage: {
    position: 'absolute',
    width: 44,
    height: 48,
    borderRadius: 12,
    left: 0,
    top: 4,
    transform: [{rotate: '-10deg'}],
  },
  iconFace: {
    width: 48,
    height: 50,
    marginLeft: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {fontSize: 25, lineHeight: 32, fontWeight: '700'},
  arrow: {
    width: 8,
    height: 8,
    borderTopWidth: 1.5,
    borderRightWidth: 1.5,
    transform: [{rotate: '45deg'}],
    marginRight: 3,
    opacity: 0.65,
  },
  copy: {marginTop: 24},
  title: {fontSize: 18, lineHeight: 26, fontWeight: '700', color: '#1F2D46'},
  caption: {fontSize: 12, lineHeight: 18, color: '#586981', marginTop: 5},
});
