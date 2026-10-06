import {
  getEssay,
  getSettings,
  getSteps,
  updateEssay,
  updateStep,
} from '../db/database';
import {Essay, StepId} from '../types';
import {localOcrPages, cloudOcr, reconcileOcr} from './ocr';
import {RequestProgress} from './context';
import {scoreEssay} from './scoring';
import {recognizedTitle} from './essay-text';

export {scoreEssay} from './scoring';

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
    let title = essay.title;
    const imageUris = essay.imageUris?.length
      ? essay.imageUris
      : [essay.imageUri];
    if (start <= 0) {
      const local = await step(essay.id, 'local_ocr', onProgress, () =>
        localOcrPages(imageUris),
      );
      localText = local.text;
      title = title || recognizedTitle(localText);
      await updateEssay(essay.id, {
        localOcr: localText,
        title,
        updatedAt: new Date().toISOString(),
      });
    }

    let visionText = essay.visionOcr;
    if (start <= 1) {
      await updateEssay(essay.id, {status: 'vision_ocr'});
      const vision = await step(essay.id, 'vision_ocr', onProgress, report =>
        cloudOcr(imageUris, settings, {onProgress: report}),
      );
      visionText = vision.text;
      title = title || recognizedTitle(visionText);
      await updateEssay(essay.id, {
        visionOcr: visionText,
        title,
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
      title = title || recognizedTitle(canonicalText);
      await updateEssay(essay.id, {
        canonicalText,
        title,
        corrections: reconciled.corrections,
        updatedAt: new Date().toISOString(),
      });
    }

    await updateEssay(essay.id, {status: 'scoring'});
    const score = await step(essay.id, 'scoring', onProgress, report =>
      scoreEssay(canonicalText, settings, {
        onProgress: report,
        essayId: essay.id,
      }),
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
