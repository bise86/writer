import rules from '../assets/scoring-rules.json';
import {
  getEssay,
  getSettings,
  getSteps,
  updateEssay,
  updateStep,
} from '../db/database';
import {AppSettings, Essay, ScoreResult, StepId} from '../types';
import {localOcr, cloudOcr, reconcileOcr} from './ocr';
import {parseJson, runResponse} from './openai';
import {RequestOptions, RequestProgress} from './context';
import {validateScore} from './score-validation';

export type ProgressCallback = (step: StepId, detail: string) => void;

const STEPS: StepId[] = ['local_ocr', 'vision_ocr', 'reconcile', 'scoring'];
const inFlight = new Set<string>();

async function step<T>(
  essayId: string,
  id: StepId,
  onProgress: ProgressCallback | undefined,
  fn: (report: RequestProgress) => Promise<T>,
) {
  await updateStep(essayId, id, 'running', '处理中', 0);
  onProgress?.(id, '处理中');
  try {
    const result = await fn(async (detail, retries) => {
      await updateStep(essayId, id, 'running', detail, retries);
      onProgress?.(id, detail);
    });
    await updateStep(essayId, id, 'success', '完成');
    onProgress?.(id, '完成');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStep(essayId, id, 'failed', message);
    onProgress?.(id, message);
    throw new Error(`${id}: ${message}`);
  }
}

function scoreInstructions() {
  return `你是严格、具体、克制的初中作文老师。按照以下 JSON 评分规则评分：\n${JSON.stringify(
    rules,
  )}\n\n要求：\n1. 独立给五个分项打分，分数不得超过分项上限；总分为分项之和。\n2. 先检查分项底线和封顶规则，再确定 bandId。\n3. 语言不生动、主题没有自然深化、材料空泛或结构流水账时，不得进入第三档。\n4. 不要因为有一个金句或某个修辞就加高分。\n5. annotations 必须引用原文短句，给出 start/end（无法定位时填 -1），说明哪里写得好或需要怎样改。\n6. 只输出 JSON，不要 Markdown。`;
}

export async function scoreEssay(
  text: string,
  settings?: AppSettings,
  options: RequestOptions = {},
): Promise<ScoreResult> {
  if (!text.trim()) {
    throw new Error('未识别到作文正文，不能评分');
  }
  const actualSettings = settings || (await getSettings());
  const response = await runResponse(
    text,
    scoreInstructions(),
    actualSettings,
    actualSettings.modelName,
    options,
  );
  return validateScore(parseJson<ScoreResult>(response.text), text);
}

export async function runEssayPipeline(
  essay: Essay,
  onProgress?: ProgressCallback,
  startFrom: StepId = 'local_ocr',
) {
  if (inFlight.has(essay.id)) {
    throw new Error('这篇作文正在处理中，请等待当前流程结束');
  }
  inFlight.add(essay.id);
  try {
    const settings = await getSettings();
    let start = STEPS.indexOf(startFrom);
    if (start > 1 && !essay.visionOcr.trim()) {
      start = 1;
    }
    if (start > 2 && !essay.canonicalText.trim()) {
      start = 2;
    }
    await updateEssay(essay.id, {
      status: STEPS[start],
      error: '',
      updatedAt: new Date().toISOString(),
    });
    let localText = essay.localOcr;
    if (start <= 0) {
      const local = await step(essay.id, 'local_ocr', onProgress, () =>
        localOcr(essay.imageUri),
      );
      localText = local.text;
      await updateEssay(essay.id, {
        localOcr: localText,
        updatedAt: new Date().toISOString(),
      });
    }

    let visionText = essay.visionOcr;
    if (start <= 1) {
      await updateEssay(essay.id, {status: 'vision_ocr'});
      const vision = await step(essay.id, 'vision_ocr', onProgress, report =>
        cloudOcr(essay.imageUri, settings, {onProgress: report}),
      );
      visionText = vision.text;
      await updateEssay(essay.id, {
        visionOcr: visionText,
        updatedAt: new Date().toISOString(),
      });
    }

    let canonicalText = essay.canonicalText;
    if (start <= 2) {
      await updateEssay(essay.id, {status: 'reconcile'});
      const reconciled = await step(essay.id, 'reconcile', onProgress, report =>
        reconcileOcr(localText, visionText, settings, {onProgress: report}),
      );
      canonicalText = reconciled.text;
      await updateEssay(essay.id, {
        canonicalText,
        corrections: reconciled.corrections,
        updatedAt: new Date().toISOString(),
      });
    }

    await updateEssay(essay.id, {status: 'scoring'});
    const score = await step(essay.id, 'scoring', onProgress, report =>
      scoreEssay(canonicalText, settings, {onProgress: report}),
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
  } finally {
    inFlight.delete(essay.id);
  }
}

export async function retryEssay(
  essayId: string,
  onProgress?: ProgressCallback,
) {
  const essay = await getEssay(essayId);
  if (!essay) {
    throw new Error('作文不存在');
  }
  const steps = await getSteps(essayId);
  const resume = STEPS.find(
    id => steps.find(item => item.step === id)?.status !== 'success',
  );
  return runEssayPipeline(essay, onProgress, resume || 'scoring');
}
