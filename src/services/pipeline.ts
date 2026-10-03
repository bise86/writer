import rules from '../assets/scoring-rules.json';
import {getEssay, getSettings, updateEssay, updateStep} from '../db/database';
import {AppSettings, Essay, ScoreResult, StepId} from '../types';
import {localOcr, cloudOcr, reconcileOcr} from './ocr';
import {parseJson, runResponse} from './openai';

export type ProgressCallback = (step: StepId, detail: string) => void;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retry<T>(label: string, retries: number, fn: () => Promise<T>) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries) {throw error;}
      attempt += 1;
      await sleep(Math.min(1500 * 2 ** (attempt - 1), 8000));
    }
  }
}

async function step<T>(
  essayId: string,
  id: StepId,
  retries: number,
  onProgress: ProgressCallback | undefined,
  fn: () => Promise<T>,
) {
  await updateStep(essayId, id, 'running', '处理中');
  onProgress?.(id, '处理中');
  try {
    const result = await retry(id, retries, fn);
    await updateStep(essayId, id, 'success', '完成');
    onProgress?.(id, '完成');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStep(essayId, id, 'failed', message, retries);
    throw new Error(`${id}: ${message}`);
  }
}

function scoreFallback(text: string): ScoreResult {
  const length = text.trim().length;
  const score = length > 600 ? 60 : length > 300 ? 50 : 35;
  return {
    score,
    bandId: score >= 60 ? 'pass' : 'unqualified',
    dimensionScores: {
      thesis: Math.round(score * 0.25),
      content: Math.round(score * 0.25),
      structure: Math.round(score * 0.2),
      language: Math.round(score * 0.2),
      format: Math.round(score * 0.1),
    },
    summary: '模型返回格式无法解析，已保存基础评分结果，请重试评分。',
    strengths: length ? ['已识别到作文正文。'] : [],
    weaknesses: ['尚未获得结构化评分。'],
    improvements: ['重新执行评分步骤。'],
    suggestions: ['检查模型设置和输出格式。'],
    annotations: [],
  };
}

function scoreInstructions() {
  return `你是严格、具体、克制的初中作文老师。按照以下 JSON 评分规则评分：\n${JSON.stringify(
    rules,
  )}\n\n要求：\n1. 独立给五个分项打分，分数不得超过分项上限；总分为分项之和。\n2. 先检查分项底线和封顶规则，再确定 bandId。\n3. 语言不生动、主题没有自然深化、材料空泛或结构流水账时，不得进入第三档。\n4. 不要因为有一个金句或某个修辞就加高分。\n5. annotations 必须引用原文短句，给出 start/end（无法定位时填 -1），说明哪里写得好或需要怎样改。\n6. 只输出 JSON，不要 Markdown。`;
}

export async function scoreEssay(
  text: string,
  settings?: AppSettings,
): Promise<ScoreResult> {
  const actualSettings = settings || (await getSettings());
  const response = await runResponse(text, scoreInstructions(), actualSettings);
  return parseJson(response.text, scoreFallback(text));
}

export async function runEssayPipeline(
  essay: Essay,
  onProgress?: ProgressCallback,
) {
  const settings = await getSettings();
  const retries = settings.retryCount;
  try {
    await updateEssay(essay.id, {
      status: 'local_ocr',
      error: '',
      updatedAt: new Date().toISOString(),
    });
    const local = await step(essay.id, 'local_ocr', retries, onProgress, () =>
      localOcr(essay.imageUri),
    );
    await updateEssay(essay.id, {
      localOcr: local.text,
      updatedAt: new Date().toISOString(),
    });

    const vision = await step(essay.id, 'vision_ocr', retries, onProgress, () =>
      cloudOcr(essay.imageUri, settings),
    );
    await updateEssay(essay.id, {
      visionOcr: vision.text,
      updatedAt: new Date().toISOString(),
    });

    const reconciled = await step(
      essay.id,
      'reconcile',
      retries,
      onProgress,
      () => reconcileOcr(local.text, vision.text, settings),
    );
    await updateEssay(essay.id, {
      canonicalText: reconciled.text,
      corrections: reconciled.corrections,
      updatedAt: new Date().toISOString(),
    });

    const score = await step(essay.id, 'scoring', retries, onProgress, () =>
      scoreEssay(reconciled.text, settings),
    );
    await updateEssay(essay.id, {
      scoreJson: JSON.stringify(score),
      status: 'completed',
      updatedAt: new Date().toISOString(),
    });
    return score;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateEssay(essay.id, {
      status: 'failed',
      error: message,
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function retryEssay(
  essayId: string,
  onProgress?: ProgressCallback,
) {
  const essay = await getEssay(essayId);
  if (!essay) {throw new Error('作文不存在');}
  return runEssayPipeline(essay, onProgress);
}
