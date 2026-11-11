import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function PageGallery({
  uris,
  label = '原始照片',
  height = 180,
  onOpen,
}: {
  uris: string[];
  label?: string;
  height?: number;
  onOpen: (index: number) => void;
}) {
  return (
    <View style={styles.gallery} accessibilityLabel={label}>
      <View style={styles.heading}>
        <Text style={styles.title}>
          {label} · {uris.length} 张
        </Text>
        <Text style={styles.help}>左右滑动 · 点击放大</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {uris.map((uri, index) => (
          <Pressable
            key={`${uri}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`查看${label} ${index + 1}`}
            onPress={() => onOpen(index)}>
            <Image
              source={{uri}}
              resizeMode="contain"
              style={[styles.image, {height, width: height * 0.75}]}
              accessibilityLabel={`${label} ${index + 1}`}
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  gallery: {padding: 12, backgroundColor: '#fff', borderRadius: 14, gap: 10},
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  title: {fontWeight: '700', color: '#334155', fontSize: 14},
  help: {fontSize: 12, color: '#64748b'},
  image: {marginRight: 10, borderRadius: 8, backgroundColor: '#f1f5f9'},
});
