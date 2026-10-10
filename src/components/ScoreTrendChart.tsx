import React from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {
  dateLabel,
  ReportEntry,
  SCORE_METRICS,
  ScoreMetric,
  ScoreMetricDefinition,
} from '../services/reports';

const HEIGHT = 160;
const TOP = 24;
const ITEM_WIDTH = 68;

/** Native views keep the same chart available on Android, iOS and Harmony. */
export default function ScoreTrendChart({
  entries,
  metric,
  selectedId,
  onSelect,
  metrics = SCORE_METRICS,
}: {
  entries: ReportEntry[];
  metric: ScoreMetric;
  selectedId?: string;
  onSelect: (id: string) => void;
  metrics?: readonly ScoreMetricDefinition[];
}) {
  const descriptor = metrics.find(item => item.key === metric)!;
  return (
    <View style={styles.chart} accessibilityLabel={`${descriptor.label}趋势图`}>
      <View style={styles.axis}>
        {[1, 0.5, 0].map(fraction => (
          <Text
            key={fraction}
            style={[styles.tick, {top: TOP + HEIGHT * (1 - fraction) - 8}]}>
            {descriptor.max * fraction}
          </Text>
        ))}
      </View>
      <View style={styles.plot}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[1, 0.5, 0].map(fraction => (
            <View
              key={fraction}
              style={[styles.gridline, {top: TOP + HEIGHT * (1 - fraction)}]}
            />
          ))}
        </View>
        <FlatList
          horizontal
          data={entries}
          keyExtractor={entry => entry.id}
          initialNumToRender={8}
          maxToRenderPerBatch={12}
          windowSize={3}
          showsHorizontalScrollIndicator
          getItemLayout={(_, index) => ({
            index,
            length: ITEM_WIDTH,
            offset: ITEM_WIDTH * index,
          })}
          extraData={`${metric}-${selectedId}`}
          renderItem={({item, index}) => {
            const value = item.scores[metric];
            const height = (HEIGHT * value) / descriptor.max;
            const selected = item.id === selectedId;
            return (
              <Pressable
                style={styles.column}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}，${new Date(
                  item.scoredAt,
                ).toLocaleString()}，${descriptor.label} ${value} 分，满分 ${
                  descriptor.max
                }`}
                accessibilityState={{selected}}
                onPress={() => onSelect(item.id)}>
                <View style={styles.barArea}>
                  <Text style={[styles.value, {bottom: height + 4}]}>
                    {value}
                  </Text>
                  <View
                    testID={`score-bar-${item.id}`}
                    style={[styles.bar, {height}, selected && styles.selected]}
                  />
                </View>
                <Text style={styles.date}>
                  {dateLabel(new Date(item.scoredAt)).slice(5)}
                </Text>
                <Text style={styles.ordinal}>第 {index + 1} 篇</Text>
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  chart: {flexDirection: 'row', marginTop: 16},
  axis: {width: 30, height: HEIGHT + TOP},
  tick: {position: 'absolute', right: 6, fontSize: 11, color: '#64748b'},
  plot: {flex: 1},
  gridline: {
    position: 'absolute',
    height: 1,
    left: 0,
    right: 0,
    backgroundColor: '#e2e8f0',
  },
  column: {width: ITEM_WIDTH, paddingBottom: 8},
  barArea: {height: HEIGHT + TOP, alignItems: 'center'},
  bar: {
    position: 'absolute',
    bottom: 0,
    width: 28,
    backgroundColor: '#93c5fd',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  selected: {backgroundColor: '#2563eb'},
  value: {
    position: 'absolute',
    color: '#1d4ed8',
    fontWeight: '700',
    fontSize: 12,
  },
  date: {textAlign: 'center', color: '#475569', fontSize: 11, marginTop: 8},
  ordinal: {textAlign: 'center', color: '#64748b', fontSize: 10, marginTop: 3},
});
