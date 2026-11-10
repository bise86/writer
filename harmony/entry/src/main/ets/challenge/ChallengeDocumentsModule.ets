import { TurboModule } from '@rnoh/react-native-openharmony/ts';
import type { TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { pdfService } from '@kit.PDFKit';

interface PickedPdf { uri: string; name: string }
interface RenderedPdf { pageUris: string[]; pageCount: number }

const MAX_BYTES: number = 80 * 1024 * 1024;
const MAX_PAGES: number = 50;
const MAX_EDGE: number = 2048;

/** PDFKit is already required by the existing in-app PDF viewer (API 12+). */
export class ChallengeDocumentsModule extends TurboModule {
  private context: common.UIAbilityContext;
  private pickerBusy: boolean = false;
  private renderBusy: boolean = false;
  private destroyed: boolean = false;

  constructor(ctx: TurboModuleContext) {
    super(ctx);
    this.context = ctx.uiAbilityContext;
  }

  private newDirectory(prefix: string): string {
    const path = `${this.context.cacheDir}/challenge-imports/${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    fs.mkdirSync(path, true);
    return path;
  }

  private localPath(uri: string): string {
    let path: string = uri;
    if (uri.startsWith('file:///')) {
      path = decodeURIComponent(uri.slice(7));
    }
    if (!path.startsWith('/') || path.includes('\u0000')) {
      throw new Error('只支持本机 PDF 文件');
    }
    return path;
  }

  private ensureActive(): void {
    if (this.destroyed) throw new Error('文件操作已中断，请返回应用后重试');
  }

  private async removeDirectory(path: string): Promise<void> {
    if (!path.startsWith(`${this.context.cacheDir}/challenge-imports/`)) return;
    try {
      await fs.rmdir(path);
    } catch (_) { }
  }

  private validatePdf(path: string): void {
    const source: fs.File = fs.openSync(path, fs.OpenMode.READ_ONLY);
    try {
      const size: number = fs.statSync(source.fd).size;
      if (size < 5 || size > MAX_BYTES) throw new Error('PDF 文件为空、无法读取或超过 80 MB');
      const header: ArrayBuffer = new ArrayBuffer(5);
      const count: number = fs.readSync(source.fd, header, { offset: 0, length: 5 });
      const bytes: Uint8Array = new Uint8Array(header);
      if (count !== 5 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70 || bytes[4] !== 45) {
        throw new Error('所选文件不是有效的 PDF');
      }
    } finally {
      fs.closeSync(source);
    }
  }

  private async copyBounded(sourceUri: string, destinationUri: string): Promise<void> {
    const source: fs.File = await fs.open(sourceUri, fs.OpenMode.READ_ONLY);
    let destination: fs.File | undefined = undefined;
    try {
      if (fs.statSync(source.fd).size > MAX_BYTES) throw new Error('PDF 超过 80 MB，请分卷后重新导入');
      destination = await fs.open(destinationUri, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      const buffer: ArrayBuffer = new ArrayBuffer(64 * 1024);
      let total: number = 0;
      while (true) {
        this.ensureActive();
        const count: number = await fs.read(source.fd, buffer, { offset: total, length: buffer.byteLength });
        if (count === 0) break;
        if (count < 0 || total + count > MAX_BYTES) throw new Error('PDF 超过 80 MB或读取失败，请分卷后重新导入');
        let written: number = 0;
        while (written < count) {
          const amount: number = await fs.write(destination.fd, buffer.slice(written, count), { offset: total + written });
          if (amount <= 0) throw new Error('PDF 文件写入失败');
          written += amount;
        }
        total += count;
      }
      if (total === 0) throw new Error('PDF 文件为空');
      await fs.fsync(destination.fd);
    } finally {
      try {
        if (destination) await fs.close(destination);
      } finally {
        await fs.close(source);
      }
    }
  }

  async pickPdf(): Promise<PickedPdf | null> {
    this.ensureActive();
    if (this.pickerBusy) throw new Error('已有文件选择或保存任务正在进行');
    this.pickerBusy = true;
    let directory: string = '';
    try {
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = ['PDF|.pdf'];
      const documentPicker = new picker.DocumentViewPicker(this.context);
      const uris: string[] = await documentPicker.select(options);
      this.ensureActive();
      if (!uris.length) return null;
      const selected: string = uris[0];
      if (!selected.startsWith('file://')) throw new Error('文件选择未返回有效的文档地址');
      directory = this.newDirectory('source');
      const path: string = `${directory}/source.pdf`;
      await this.copyBounded(selected, path);
      this.validatePdf(path);
      let name: string = decodeURIComponent(selected.substring(selected.lastIndexOf('/') + 1).split('?')[0]);
      if (!name) name = '试卷.pdf';
      return { uri: `file://${path}`, name };
    } catch (error) {
      if (directory) await this.removeDirectory(directory);
      throw error;
    } finally {
      this.pickerBusy = false;
    }
  }

  async renderPdf(uri: string): Promise<RenderedPdf> {
    this.ensureActive();
    if (this.renderBusy) throw new Error('已有 PDF 正在渲染，请稍后重试');
    this.renderBusy = true;
    const document: pdfService.PdfDocument = new pdfService.PdfDocument();
    let directory: string = '';
    try {
      const path: string = this.localPath(uri);
      this.validatePdf(path);
      const result: pdfService.ParseResult = document.loadDocument(path, '');
      if (result !== pdfService.ParseResult.PARSE_SUCCESS) {
        throw new Error('PDF 已加密、损坏或格式不受支持，无法完整读取');
      }
      const count: number = document.getPageCount();
      if (count < 1 || count > MAX_PAGES) throw new Error('PDF 须为 1—50 页；未截断导入，请分卷后重试');
      directory = this.newDirectory('pages');
      const pageUris: string[] = [];
      for (let index: number = 0; index < count; index++) {
        this.ensureActive();
        const page: pdfService.PdfPage = document.getPage(index);
        let pixels: image.PixelMap | undefined = undefined;
        let packer: image.ImagePacker | undefined = undefined;
        try {
          const width: number = page.getWidth();
          const height: number = page.getHeight();
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('PDF 页面尺寸无效');
          const scale: number = MAX_EDGE / Math.max(width, height);
          const pixelWidth: number = Math.min(MAX_EDGE, Math.max(1, Math.ceil(width * scale)));
          const pixelHeight: number = Math.min(MAX_EDGE, Math.max(1, Math.ceil(height * scale)));
          const matrix: pdfService.PdfMatrix = new pdfService.PdfMatrix();
          matrix.x = 0;
          matrix.y = 0;
          matrix.width = width;
          matrix.height = height;
          matrix.rotate = 0;
          // Render annotations too; OCR distinguishes printed questions from answers.
          pixels = page.getAreaPixelMap(matrix, pixelWidth, pixelHeight, false, true);
          if (!pixels) throw new Error('PDF 页面渲染失败');
          packer = image.createImagePacker();
          const data: ArrayBuffer = await packer.packing(pixels, { format: 'image/jpeg', quality: 95 });
          const outputPath: string = `${directory}/page_${index + 1}.jpg`;
          const output: fs.File = await fs.open(outputPath, fs.OpenMode.WRITE_ONLY | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
          try {
            let offset: number = 0;
            while (offset < data.byteLength) {
              const written: number = await fs.write(output.fd, data.slice(offset), { offset });
              if (written <= 0) throw new Error('PDF 页面图片保存失败');
              offset += written;
            }
          } finally {
            await fs.close(output);
          }
          pageUris.push(`file://${outputPath}`);
        } finally {
          if (packer) { try { await packer.release(); } catch (_) { } }
          if (pixels) { try { await pixels.release(); } catch (_) { } }
          try { page.release(); } catch (_) { }
        }
      }
      return { pageUris, pageCount: count };
    } catch (error) {
      if (directory) await this.removeDirectory(directory);
      throw error;
    } finally {
      this.renderBusy = false;
      try { document.releaseDocument(); } catch (_) { }
    }
  }

  async savePdf(uri: string, name: string): Promise<boolean> {
    this.ensureActive();
    if (this.pickerBusy) throw new Error('已有文件选择或保存任务正在进行');
    this.pickerBusy = true;
    try {
      const path: string = this.localPath(uri);
      this.validatePdf(path);
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = [name.replace(/[\\/\u0000-\u001f]/g, '_')];
      options.fileSuffixChoices = ['PDF|.pdf'];
      const documentPicker = new picker.DocumentViewPicker(this.context);
      const targets: string[] = await documentPicker.save(options);
      this.ensureActive();
      if (!targets.length) return false;
      if (!targets[0].startsWith('file://')) throw new Error('未返回有效的保存位置');
      try {
        await this.copyBounded(path, targets[0]);
      } catch (error) {
        try { await fs.unlink(targets[0]); } catch (_) { }
        throw error;
      }
      return true;
    } finally {
      this.pickerBusy = false;
    }
  }

  public __onDestroy__(): void {
    this.destroyed = true;
  }
}
