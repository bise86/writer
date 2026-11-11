import React, {useEffect, useState} from 'react';
import {getEssayUsage} from '../db/database';
import {EssayUsage, StepId} from '../types';
import ModelUsageDetails from './ModelUsageDetails';

const STAGES: [StepId, string][] = [
  ['vision_ocr', '逐页图片识别'],
  ['reconcile', '原图复核'],
  ['scoring', '评分与批注'],
];
export default function UsageDetails({essayId}: {essayId: string}) {
  const [usage, setUsage] = useState<EssayUsage>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let reading = false;
    setUsage(undefined);
    const refresh = async () => {
      if (reading) {
        return;
      }
      reading = true;
      try {
        const value = await getEssayUsage(essayId);
        if (active) {
          setUsage(value);
          setError('');
        }
      } catch {
        if (active) {
          setError('消耗记录读取失败，正在重试');
        }
      } finally {
        reading = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 1200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [essayId]);
  return (
    <ModelUsageDetails
      key={essayId}
      usage={usage}
      stages={STAGES}
      error={error}
      note="单位：token。累计本作文所有处理与重试；输入已包含缓存命中部分，缓存及思考分项不重复加到合计。未返回的字段保留为空，旧版调用无法补算。"
    />
  );
}
