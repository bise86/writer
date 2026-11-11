import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/** One offline Unicode font setup for every printable document. */
export async function createPdfWithFont(fontData?: string | Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    fontData || (require('../../assets/fonts/noto-sans-sc.json') as string),
    {subset: true},
  );
  return {pdf, font};
}
