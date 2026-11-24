import {discardPreparedImages, persistImage} from '../media/images';
import {ImportedSource, PreparedImage} from '../media/types';
import {discardImportedPdf, pickPdf} from './documents';

/** Shared PDF upload and page-persistence flow. Successful results transfer
 * ownership of persisted images to the caller, matching useImageImport. */
export async function importPdfImages(
  options: {shouldContinue?: () => boolean} = {},
): Promise<PreparedImage[] | undefined> {
  const shouldContinue = options.shouldContinue ?? (() => true);
  let source: ImportedSource | null = null;
  const prepared: PreparedImage[] = [];
  let transferred = false;
  try {
    source = await pickPdf();
    if (!source || !shouldContinue()) {
      return undefined;
    }
    for (const [index, pageUri] of source.pageUris.entries()) {
      if (!shouldContinue()) {
        return undefined;
      }
      const uri = await persistImage(pageUri);
      prepared.push({
        uri,
        name: `${source.name} 第 ${index + 1} 页`,
      });
    }
    if (!prepared.length || !shouldContinue()) {
      return undefined;
    }
    transferred = true;
    return [...prepared];
  } finally {
    if (!transferred && prepared.length) {
      await discardPreparedImages(prepared.map(image => image.uri));
    }
    if (source) {
      await discardImportedPdf(source).catch(() => undefined);
    }
  }
}
