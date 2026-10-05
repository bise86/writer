import {NativeModules, Platform} from 'react-native';
import {imageAsDataUri, parseJson, runResponse, visionResponse} from './openai';
import {AppSettings} from '../types';
import {RequestOptions} from './context';

export interface OcrResult {
  text: string;
  confidence: number;
  engine: string;
}

type NativeOcrModule = {
  recognize(uri: string): Promise<{text: string; confidence?: number}>;
};
const NativeOcr = NativeModules.EssayOcr as NativeOcrModule | undefined;

function mlKitOcr() {
  if ((Platform.OS as string) === 'harmony') {
    return undefined;
  }
  try {
    return require('@react-native-ml-kit/text-recognition') as typeof import('@react-native-ml-kit/text-recognition');
  } catch (_) {
    return undefined;
  }
}

export async function localOcr(uri: string): Promise<OcrResult> {
  if (!NativeOcr?.recognize) {
    const mlKit = mlKitOcr();
    if (!mlKit?.default?.recognize) {
      return {text: '', confidence: 0, engine: 'local-model-unavailable'};
    }
    try {
      const result = await mlKit.default.recognize(
        uri,
        mlKit.TextRecognitionScript.CHINESE,
      );
      return {
        text: result.text || '',
        confidence: result.text ? 0.78 : 0,
        engine: 'on-device-ml-kit',
      };
    } catch (_) {
      return {text: '', confidence: 0, engine: 'local-model-failed'};
    }
  }
  const result = await NativeOcr.recognize(uri);
  return {
    text: result.text || '',
    confidence: result.confidence ?? 0,
    engine: 'local-model',
  };
}

export async function localOcrPages(uris: string[]): Promise<OcrResult> {
  const pages: OcrResult[] = [];
  for (const [index, uri] of uris.entries()) {
    const result = await localOcr(uri);
    pages.push({
      ...result,
      text: result.text ? `【第 ${index + 1} 页】\n${result.text}` : '',
    });
  }
  return {
    text: pages
      .map(page => page.text)
      .filter(Boolean)
      .join('\n\n'),
    confidence: pages.length
      ? pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length
      : 0,
    engine:
      pages.map(page => page.engine).join(',') || 'local-model-unavailable',
  };
}

export async function cloudOcr(
  uri: string | string[],
  settings: AppSettings,
  options: RequestOptions = {},
): Promise<OcrResult> {
  const result = await visionResponse(
    uri,
    '你是作文图像文字识别器。请只输出图片中作文的完整文字，按原有段落换行；不要总结、不要修正错别字、不要添加解释。',
    settings,
    options,
  );
  return {
    text: result.text.trim(),
    confidence: result.text.trim() ? 0.9 : 0,
    engine: 'vision-model',
  };
}

export async function reconcileOcr(
  localText: string,
  visionText: string,
  settings: AppSettings,
  options: RequestOptions = {},
) {
  if (!localText.trim()) {
    return {
      text: visionText.trim(),
      corrections: '本地 OCR 未返回文本，采用视觉模型结果。',
    };
  }
  if (!visionText.trim()) {
    return {
      text: localText.trim(),
      corrections: '视觉模型未返回文本，采用本地 OCR 结果。',
    };
  }
  const result = await visionResponseFromText(
    localText,
    visionText,
    settings,
    options,
  );
  return result;
}

async function visionResponseFromText(
  localText: string,
  visionText: string,
  settings: AppSettings,
  options: RequestOptions,
) {
  const response = await runResponse(
    `本地 OCR：\n${localText}\n\n视觉模型 OCR：\n${visionText}`,
    '你是 OCR 校对器。对照两份文字，保留图片能确认的文字、段落和标点；不要润色作文，不要改变原意。只输出 JSON：{"text":"校对后的完整作文","corrections":"列出有差异的位置和采用的版本"}。',
    settings,
    settings.modelName,
    options,
  );
  const result = parseJson<{text: string; corrections: string}>(response.text);
  if (
    !result ||
    typeof result.text !== 'string' ||
    !result.text.trim() ||
    typeof result.corrections !== 'string'
  ) {
    throw new Error('模型未返回完整的校对文字和差异说明，请重试');
  }
  return result;
}

export async function getImagePreview(uri: string) {
  return imageAsDataUri(uri);
}
