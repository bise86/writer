import {NativeModules} from 'react-native';
import RNFS from 'react-native-fs';
import {ImportedSource} from '../media/types';

export const PDF_IMPORT_LIMITS = {
  maxPages: 50,
  maxBytes: 80 * 1024 * 1024,
  maxImageEdge: 2048,
} as const;

interface DocumentBridge {
  pickPdf(): Promise<{uri: string; name: string} | null>;
  renderPdf(uri: string): Promise<{pageUris: string[]; pageCount: number}>;
  savePdf(uri: string, name: string): Promise<boolean>;
}

let busy = false;

function bridge(): DocumentBridge {
  const value = NativeModules.ChallengeDocuments as DocumentBridge | undefined;
  if (
    !value ||
    typeof value.pickPdf !== 'function' ||
    typeof value.renderPdf !== 'function' ||
    typeof value.savePdf !== 'function'
  ) {
    throw new Error(
      'PDF 文件功能未装入当前应用，请更新到支持文件功能的新安装包',
    );
  }
  return value;
}

function localUri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value.startsWith('/') || /^file:\/\/\//.test(value)) &&
    ![...value].some(char => char.charCodeAt(0) < 32)
  );
}

function cancelled(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    ['E_CANCELLED', 'DOCUMENT_PICKER_CANCELED'].includes(String(error.code))
  );
}

/** Only remove native import/render copies, never a user's original document. */
export async function discardImportedPdf(source: ImportedSource) {
  if (source.kind !== 'pdf') {
    return;
  }
  const prefix = `${RNFS.CachesDirectoryPath}/challenge-imports/`;
  const directories = new Set<string>();
  for (const uri of [source.uri, ...source.pageUris]) {
    let path: string;
    try {
      path = decodeURIComponent(uri.replace(/^file:\/\//, ''));
    } catch (_) {
      continue;
    }
    if (path.startsWith(prefix) && !path.split('/').includes('..')) {
      const relative = path.slice(prefix.length);
      const directory = relative.split('/')[0];
      if (directory && relative.includes('/')) {
        directories.add(`${prefix}${directory}`);
      }
    }
  }
  await Promise.all(
    [...directories].map(path => RNFS.unlink(path).catch(() => undefined)),
  );
}

export async function pickPdf(): Promise<ImportedSource | null> {
  if (busy) {
    throw new Error('已有文件选择或保存任务正在进行，请稍后重试');
  }
  busy = true;
  let source: ImportedSource | undefined;
  try {
    const native = bridge();
    const selected = await native.pickPdf();
    if (!selected) {
      return null;
    }
    if (localUri(selected.uri)) {
      source = {
        kind: 'pdf',
        name: selected.name,
        uri: selected.uri,
        pageUris: [],
      };
    }
    if (!source || typeof selected.name !== 'string' || !selected.name.trim()) {
      throw new Error('文件选择未返回有效的本地 PDF');
    }
    const rendered = await native.renderPdf(source.uri);
    if (Array.isArray(rendered?.pageUris)) {
      // Remember returned copies even on malformed results, so failure can clean them.
      source.pageUris = rendered.pageUris.filter(localUri);
    }
    if (
      !rendered ||
      !Number.isInteger(rendered.pageCount) ||
      rendered.pageCount < 1 ||
      rendered.pageCount > PDF_IMPORT_LIMITS.maxPages ||
      !Array.isArray(rendered.pageUris) ||
      rendered.pageUris.length !== rendered.pageCount ||
      !rendered.pageUris.every(localUri) ||
      new Set(rendered.pageUris).size !== rendered.pageCount
    ) {
      throw new Error('PDF 页面渲染不完整，未截断导入；请检查文件或分卷后重试');
    }
    return source;
  } catch (error) {
    if (source) {
      await discardImportedPdf(source);
    }
    if (cancelled(error)) {
      return null;
    }
    throw error;
  } finally {
    busy = false;
  }
}

export async function savePdf(uri: string, name: string): Promise<boolean> {
  if (!localUri(uri)) {
    throw new Error('没有可保存的本地 PDF，请先生成 PDF');
  }
  if (busy) {
    throw new Error('已有文件选择或保存任务正在进行，请稍后重试');
  }
  busy = true;
  const cleaned =
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map(char => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('')
      .trim()
      .slice(0, 100) || '文档';
  const filename = /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
  try {
    const saved = await bridge().savePdf(uri, filename);
    if (typeof saved !== 'boolean') {
      throw new Error('文件保存未返回确认结果，请在文件应用中核对后重试');
    }
    return saved;
  } catch (error) {
    if (cancelled(error)) {
      return false;
    }
    throw error;
  } finally {
    busy = false;
  }
}
