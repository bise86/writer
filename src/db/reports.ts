import type {SQLiteDatabase} from 'react-native-sqlite-storage';
import {
  ReportEntry,
  ReportRange,
  reportBounds,
  scoreMetricsFor,
  summarizeScores,
} from '../services/reports';
import {getWritingProfile, normalizeWritingType} from '../services/writing';
import {WritingType} from '../types';

export async function readScoreReport(
  database: SQLiteDatabase,
  range: ReportRange,
  writingType?: WritingType,
) {
  const {from, until} = reportBounds(range);
  if (normalizeWritingType(writingType) === 'english') {
    const [result] = await database.executeSql(
      `
      SELECT s.id, s.essay_id, e.title, s.scored_at, s.time_source,
        s.total_score, s.dimension_scores_json
      FROM writing_score_records s JOIN essays e ON e.id = s.essay_id
      WHERE s.writing_type = ? AND s.scored_at >= ? AND s.scored_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM writing_score_records newer
          WHERE newer.essay_id = s.essay_id AND newer.writing_type = ?
            AND newer.scored_at >= ? AND newer.scored_at < ?
            AND (newer.scored_at > s.scored_at OR (newer.scored_at = s.scored_at AND newer.rowid > s.rowid))
        )
      ORDER BY s.scored_at, s.rowid`,
      ['english', from, until, 'english', from, until],
    );
    const dimensions = getWritingProfile('english').rules.dimensions;
    const entries: ReportEntry[] = [];
    for (let i = 0; i < result.rows.length; i += 1) {
      const row = result.rows.item(i);
      let values: Record<string, number>;
      try {
        values = JSON.parse(row.dimension_scores_json);
        if (
          !values ||
          typeof values !== 'object' ||
          Array.isArray(values) ||
          dimensions.some(item =>
            !Number.isInteger(values[item.id]) || values[item.id] < 0 || values[item.id] > item.max,
          )
        ) {
          throw new Error('无效分项');
        }
      } catch (_) {
        throw new Error('英语评分记录的分项数据无效，请核对或重新评分');
      }
      const dimensionTotal = dimensions.reduce(
        (sum, item) => sum + values[item.id],
        0,
      );
      const admissionAdjustment = dimensionTotal - Number(row.total_score);
      if (
        !Number.isInteger(row.total_score) ||
        !Number.isInteger(admissionAdjustment) ||
        admissionAdjustment < 0 ||
        admissionAdjustment > dimensionTotal
      ) {
        throw new Error('英语评分记录的总分或准入调整无效，请核对或重新评分');
      }
      entries.push({
        id: row.id,
        essayId: row.essay_id,
        title: row.title || '未命名英语作文',
        scoredAt: row.scored_at,
        estimatedTime: row.time_source !== 'scored_at',
        admissionAdjustment,
        scores: {
          total: row.total_score,
          ...Object.fromEntries(
            dimensions.map(item => [item.id, values[item.id]]),
          ),
        },
      });
    }
    return summarizeScores(entries, scoreMetricsFor(dimensions));
  }
  // One result set is the source of both totals and charts. Choose the last
  // successful score *within the period*, so a later regrade does not erase a
  // past month's record. rowid breaks ties when scores share a timestamp.
  const [result] = await database.executeSql(
    `
    SELECT s.id, s.essay_id, e.title, s.scored_at, s.time_source,
      s.total_score, s.thesis_score, s.content_score, s.structure_score, s.language_score, s.format_score
    FROM score_records s JOIN essays e ON e.id = s.essay_id
    WHERE s.scored_at >= ? AND s.scored_at < ?
      AND NOT EXISTS (
        SELECT 1 FROM score_records newer
        WHERE newer.essay_id = s.essay_id AND newer.scored_at >= ? AND newer.scored_at < ?
          AND (newer.scored_at > s.scored_at OR (newer.scored_at = s.scored_at AND newer.rowid > s.rowid))
      )
    ORDER BY s.scored_at, s.rowid`,
    [from, until, from, until],
  );
  const entries: ReportEntry[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    entries.push({
      id: row.id,
      essayId: row.essay_id,
      title: row.title || '未命名作文',
      scoredAt: row.scored_at,
      estimatedTime: row.time_source !== 'scored_at',
      scores: {
        total: row.total_score,
        thesis: row.thesis_score,
        content: row.content_score,
        structure: row.structure_score,
        language: row.language_score,
        format: row.format_score,
      },
    });
  }
  return summarizeScores(entries);
}
