import React, {useMemo} from 'react';
import {ChallengeRecord, ChallengeStage} from '../challenge/types';
import {getChallengeUsage} from '../challenge/usage';
import ModelUsageDetails from './ModelUsageDetails';

const STAGES: [ChallengeStage, string][] = [
  ['analysis', '原卷解析'],
  ['generation', '升档出题'],
  ['review', '圆桌评审'],
  ['repair', '问题修正'],
  ['pdf', 'PDF 生成'],
];

export default function ChallengeUsageDetails({
  record,
}: {
  record: ChallengeRecord;
}) {
  const usage = useMemo(() => getChallengeUsage(record.calls), [record.calls]);
  return (
    <ModelUsageDetails
      key={record.id}
      usage={usage}
      stages={STAGES}
      note="单位：token。累计本挑战解析、出题、评审、修正的所有请求与重试；输入已包含缓存命中部分，缓存及思考分项不重复加到合计。未返回的字段保留为空，旧版调用无法补算。"
    />
  );
}
