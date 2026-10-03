import {NativeModules, Platform} from 'react-native';
import {imageAsDataUri, parseJson, runResponse, visionResponse} from './openai';
import {AppSettings} from '../types';

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
  if ((Platform.OS as string) === 'harmony') {return undefined;}
  try {
    return require('@react-native-ml-kit/text-recognition') as typeof import('@react-native-ml-kit/text-recognition');
  } catch (_) {
    return undefined;
  }
}

export async function localOcr(uri: string): Promise<OcrResult> {
  if (!NativeOcr?.recognize) {
    const mlKit = mlKitOcr();
    if (!mlKit?.default?.recognize)
      {return {text: '', confidence: 0, engine: 'local-model-unavailable'};}
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

export async function cloudOcr(
  uri: string,
  settings: AppSettings,
): Promise<OcrResult> {
  const result = await visionResponse(
    uri,
    '你是作文图像文字识别器。请只输出图片中作文的完整文字，按原有段落换行；不要总结、不要修正错别字、不要添加解释。',
    settings,
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
) {
  if (!localText.trim())
    {return {
      text: visionText.trim(),
      corrections: '本地 OCR 未返回文本，采用视觉模型结果。',
    };}
  if (!visionText.trim())
    {return {
      text: localText.trim(),
      corrections: '视觉模型未返回文本，采用本地 OCR 结果。',
    };}
  const result = await visionResponseFromText(localText, visionText, settings);
  return result;
}

async function visionResponseFromText(
  localText: string,
  visionText: string,
  settings: AppSettings,
) {
  const fallback = {
    text: visionText,
    corrections: '两路 OCR 均已返回，未能完成差异合并。',
  };
  const response = await runResponse(
    `本地 OCR：\n${localText}\n\n视觉模型 OCR：\n${visionText}`,
    '你是 OCR 校对器。对照两份文字，保留图片能确认的文字、段落和标点；不要润色作文，不要改变原意。只输出 JSON：{"text":"校对后的完整作文","corrections":"列出有差异的位置和采用的版本"}。',
    settings,
  );
  return parseJson(response.text, fallback);
}

export async function getImagePreview(uri: string) {
  return imageAsDataUri(uri);
}
