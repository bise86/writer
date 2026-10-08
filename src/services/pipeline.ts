import {
  getEssay,
  getSettings,
  getSteps,
  updateEssay,
  updateStep,
} from '../db/database';
import {Essay, StepId} from '../types';
import {cloudOcr, reconcileOcr} from './ocr';
import {RequestProgress} from './context';
import {scoreEssay} from './scoring';
import {recognizedTitle} from './essay-text';

export {scoreEssay} from './scoring';

export type ProgressCallback = (step: StepId, detail: string) => void;

const STEPS: StepId[] = ['vision_ocr', 'reconcile', 'scoring'];
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
  startFrom: StepId = 'vision_ocr',
) {
  if (inFlight.has(essay.id)) {
    throw new Error('这篇作文正在处理中，请等待当前流程结束');
  }
  inFlight.add(essay.id);
  try {
    const settings = await getSettings();
    let start = Math.max(0, STEPS.indexOf(startFrom));
    if (start > 0 && !essay.visionOcr.trim()) {
      start = 0;
    }
    if (start > 1 && !essay.canonicalText.trim()) {
      start = 1;
    }
    // A new recognition invalidates all downstream outputs and progress.
    for (const id of STEPS.slice(start)) {
      await updateStep(essay.id, id, 'pending', '', 0);
    }
    await updateEssay(essay.id, {
      status: STEPS[start],
      error: '',
      scoreJson: '',
      ...(start <= 1 ? {canonicalText: '', corrections: ''} : {}),
      ...(start === 0 ? {visionOcr: '', localOcr: '', title: ''} : {}),
      updatedAt: new Date().toISOString(),
    });
    const imageUris = essay.imageUris?.length
      ? essay.imageUris
      : [essay.imageUri];
    let visionText = essay.visionOcr;
    if (start === 0) {
      await updateEssay(essay.id, {status: 'vision_ocr'});
      const vision = await step(essay.id, 'vision_ocr', onProgress, report =>
        cloudOcr(imageUris, settings, {
          onProgress: report,
          onPage: async text => {
            await updateEssay(essay.id, {
              visionOcr: text,
              title: recognizedTitle(text),
              updatedAt: new Date().toISOString(),
            });
          },
        }),
      );
      visionText = vision.text;
      await updateEssay(essay.id, {
        visionOcr: visionText,
        title: recognizedTitle(visionText),
        updatedAt: new Date().toISOString(),
      });
    }

    let canonicalText = essay.canonicalText;
    if (start <= 1) {
      await updateEssay(essay.id, {status: 'reconcile'});
      const reconciled = await step(essay.id, 'reconcile', onProgress, report =>
        reconcileOcr(imageUris, visionText, settings, {onProgress: report}),
      );
      canonicalText = reconciled.text;
      await updateEssay(essay.id, {
        canonicalText,
        title: recognizedTitle(canonicalText),
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
