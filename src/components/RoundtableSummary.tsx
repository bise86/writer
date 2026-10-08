import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {RoundtableReport} from '../types';

export default function RoundtableSummary({
  report,
}: {
  report: RoundtableReport;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.root}>
      <Text style={styles.title}>圆桌评审 · {report.reviewerCount} 个角色</Text>
      <Text style={styles.body}>
        评分和批注分别投票，各需 {report.majority} 票同意。
      </Text>
      {report.rounds.map(round => (
        <View key={round.round} style={styles.round}>
          <Text style={styles.title}>
            第 {round.round} 轮 · 草案 {round.draftScore} 分
          </Text>
          <Text style={styles.body}>
            评分 {round.scoreVotes}/{report.reviewerCount} 同意 · 批注{' '}
            {round.annotationVotes}/{report.reviewerCount} 同意
          </Text>
          {expanded &&
            round.votes.map(vote => {
              const review = round.reviews.find(
                item => item.roleId === vote.roleId,
              );
              return (
                <View key={vote.roleId} style={styles.role}>
                  <Text style={styles.title}>{vote.roleName}</Text>
                  {review && (
                    <>
                      <Text selectable style={styles.body}>
                        独立审阅评分：{review.scoreReason}
                      </Text>
                      <Text selectable style={styles.body}>
                        独立审阅批注：{review.annotationsReason}
                      </Text>
                    </>
                  )}
                  <Text selectable style={styles.body}>
                    讨论后评分投票：{vote.scoreApproved ? '同意' : '不同意'}。
                    {vote.scoreReason}
                  </Text>
                  <Text selectable style={styles.body}>
                    讨论后批注投票：
                    {vote.annotationsApproved ? '同意' : '不同意'}。
                    {vote.annotationsReason}
                  </Text>
                  {vote.changes.map((change, index) => (
                    <Text selectable style={styles.body} key={index}>
                      修改要求：{change}
                    </Text>
                  ))}
                </View>
              );
            })}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded}}
        onPress={() => setExpanded(!expanded)}>
        <Text style={styles.link}>
          {expanded ? '收起评审记录' : '展开评审记录'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 10},
  title: {fontSize: 15, fontWeight: '700', color: '#1e293b'},
  body: {fontSize: 14, color: '#475569', lineHeight: 22},
  round: {gap: 6, paddingVertical: 8},
  role: {
    gap: 6,
    marginTop: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#cbd5e1',
  },
  link: {color: '#2563eb', paddingVertical: 8, fontWeight: '600'},
});
