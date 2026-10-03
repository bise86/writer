import OpenAI from 'openai';
import RNFS from 'react-native-fs';
import {AppSettings} from '../types';

export interface ResponseUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function clientFor(settings: AppSettings) {
  if (!settings.apiKey.trim()) {throw new Error('请先在设置中填写 API Key');}
  return new OpenAI({
    apiKey: settings.apiKey.trim(),
    baseURL: settings.apiBaseUrl.trim() || undefined,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: 10 * 60 * 1000,
  } as any);
}

function cleanUri(uri: string) {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

export async function imageAsDataUri(uri: string) {
  if (uri.startsWith('data:')) {return uri;}
  const file = cleanUri(uri);
  const base64 = await RNFS.readFile(file, 'base64');
  const type = /\.png$/i.test(file)
    ? 'image/png'
    : /\.webp$/i.test(file)
    ? 'image/webp'
    : 'image/jpeg';
  return `data:${type};base64,${base64}`;
}

function estimateTokens(input: unknown) {
  return Math.ceil(JSON.stringify(input).length / 4);
}

export async function compactIfNeeded(
  input: unknown,
  instructions: string,
  settings: AppSettings,
) {
  const estimated = estimateTokens(input);
  const limit = settings.contextWindow * settings.compactionThreshold;
  if (estimated <= limit) {return input;}
  const client = clientFor(settings);
  const compacted = await (client as any).beta.responses.compact({
    model: settings.modelName,
    input,
    instructions,
  });
  return compacted.output;
}

export async function runResponse(
  input: unknown,
  instructions: string,
  settings: AppSettings,
  model = settings.modelName,
) {
  const client = clientFor(settings);
  const compactedInput = await compactIfNeeded(input, instructions, settings);
  const request: Record<string, unknown> = {
    model,
    instructions,
    input: compactedInput as any,
    max_output_tokens: settings.maxOutputTokens,
  };
  // Reasoning controls are accepted by reasoning-capable models. Vision OCR
  // defaults to a compact multimodal model, so leave the field out there.
  if (/^(gpt-5|o[1-9])/i.test(model))
    {request.reasoning = {effort: settings.reasoningEffort};}
  const response = await client.responses.create(request as any);
  return {
    text: response.output_text || '',
    usage: {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    } as ResponseUsage,
  };
}

export async function visionResponse(
  imageUri: string,
  instructions: string,
  settings: AppSettings,
) {
  const imageUrl = await imageAsDataUri(imageUri);
  return runResponse(
    [
      {
        role: 'user',
        content: [
          {type: 'input_text', text: instructions},
          {type: 'input_image', image_url: imageUrl, detail: 'high'},
        ],
      },
    ],
    instructions,
    settings,
    settings.visionModelName,
  );
}

export function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch (_) {
    /* try fenced/embedded JSON */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try {
      return JSON.parse(fenced) as T;
    } catch (_) {
      /* continue */
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch (_) {
      /* fallback */
    }
  }
  return fallback;
}
