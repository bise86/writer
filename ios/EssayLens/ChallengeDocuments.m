#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <React/RCTUtils.h>
#import <PDFKit/PDFKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <UIKit/UIKit.h>

static const unsigned long long CDMaxBytes = 80ULL * 1024ULL * 1024ULL;
static const NSUInteger CDMaxPages = 50;
static const CGFloat CDMaxImageEdge = 2048;

static NSError *CDError(NSString *message) {
  return [NSError errorWithDomain:@"ChallengeDocuments" code:1 userInfo:@{NSLocalizedDescriptionKey: message}];
}

@interface ChallengeDocuments : NSObject <RCTBridgeModule, RCTInvalidating, UIDocumentPickerDelegate>
@property(nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock pendingReject;
@property(nonatomic, strong) UIDocumentPickerViewController *picker;
@property(nonatomic, copy) NSString *operation;
@property(nonatomic, strong) NSURL *exportDirectory;
@property(nonatomic, strong) dispatch_queue_t ioQueue;
@property(atomic, assign) BOOL invalidated;
@property(atomic, assign) BOOL rendering;
@end

@implementation ChallengeDocuments
RCT_EXPORT_MODULE(ChallengeDocuments)

+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init {
  if ((self = [super init])) {
    _ioQueue = dispatch_queue_create("com.essaylens.challenge.documents", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (NSURL *)newDirectory:(NSString *)prefix error:(NSError **)error {
  NSURL *cache = [[NSFileManager defaultManager] URLForDirectory:NSCachesDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:error];
  if (!cache) return nil;
  NSURL *root = [cache URLByAppendingPathComponent:@"challenge-imports" isDirectory:YES];
  NSURL *directory = [root URLByAppendingPathComponent:[NSString stringWithFormat:@"%@_%@", prefix, NSUUID.UUID.UUIDString] isDirectory:YES];
  return [[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:error] ? directory : nil;
}

- (NSURL *)localURL:(NSString *)uri {
  if (![uri isKindOfClass:NSString.class] || [uri rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0, 1)]].location != NSNotFound) return nil;
  if ([uri hasPrefix:@"/"]) return [NSURL fileURLWithPath:uri];
  NSURL *url = [NSURL URLWithString:uri];
  return url.isFileURL && (url.host.length == 0 || [url.host isEqualToString:@"localhost"]) ? url : nil;
}

- (BOOL)validatePdf:(NSURL *)url error:(NSError **)error {
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:url.path error:error];
  unsigned long long size = [attributes[NSFileSize] unsignedLongLongValue];
  if (!attributes || ![attributes[NSFileType] isEqualToString:NSFileTypeRegular] || size < 5 || size > CDMaxBytes) {
    if (error && !*error) *error = CDError(@"PDF 文件为空、无法读取或超过 80 MB");
    return NO;
  }
  NSFileHandle *file = [NSFileHandle fileHandleForReadingFromURL:url error:error];
  if (!file) return NO;
  NSData *header = [file readDataOfLength:5];
  [file closeFile];
  if (![header isEqualToData:[@"%PDF-" dataUsingEncoding:NSASCIIStringEncoding]]) {
    if (error) *error = CDError(@"所选文件不是有效的 PDF");
    return NO;
  }
  return YES;
}

- (BOOL)copyBounded:(NSURL *)source destination:(NSURL *)destination error:(NSError **)error {
  NSInputStream *input = [NSInputStream inputStreamWithURL:source];
  NSOutputStream *output = [NSOutputStream outputStreamWithURL:destination append:NO];
  if (!input || !output) {
    if (error) *error = CDError(@"无法读取或写入 PDF 文件");
    return NO;
  }
  [input open];
  [output open];
  uint8_t buffer[64 * 1024];
  unsigned long long total = 0;
  BOOL succeeded = NO;
  while (!self.invalidated) {
    NSInteger length = [input read:buffer maxLength:sizeof(buffer)];
    if (length < 0) {
      if (error) *error = input.streamError ?: CDError(@"PDF 读取失败");
      break;
    }
    if (length == 0) {
      succeeded = total > 0;
      if (!succeeded && error) *error = CDError(@"PDF 文件为空");
      break;
    }
    total += length;
    if (total > CDMaxBytes) {
      if (error) *error = CDError(@"PDF 超过 80 MB，请分卷后重新导入");
      break;
    }
    NSInteger offset = 0;
    while (offset < length) {
      NSInteger written = [output write:buffer + offset maxLength:(NSUInteger)(length - offset)];
      if (written <= 0) {
        if (error) *error = output.streamError ?: CDError(@"PDF 写入失败");
        break;
      }
      offset += written;
    }
    if (offset != length) break;
  }
  if (self.invalidated && error) *error = CDError(@"文件操作已中断");
  [input close];
  [output close];
  if (!succeeded) [[NSFileManager defaultManager] removeItemAtURL:destination error:nil];
  return succeeded;
}

- (BOOL)beginPicker:(NSString *)operation resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  if (self.pendingResolve) {
    reject(@"E_BUSY", @"已有文件选择或保存任务正在进行", nil);
    return NO;
  }
  if (self.invalidated || !RCTPresentedViewController()) {
    reject(@"E_ACTIVITY", @"当前页面不可用，请返回应用后重试", nil);
    return NO;
  }
  self.operation = operation;
  self.pendingResolve = resolve;
  self.pendingReject = reject;
  return YES;
}

- (void)clearPicker {
  self.pendingResolve = nil;
  self.pendingReject = nil;
  self.operation = nil;
  self.picker.delegate = nil;
  self.picker = nil;
  if (self.exportDirectory) {
    [[NSFileManager defaultManager] removeItemAtURL:self.exportDirectory error:nil];
    self.exportDirectory = nil;
  }
}

RCT_EXPORT_METHOD(pickPdf:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![self beginPicker:@"pick" resolve:resolve reject:reject]) return;
  self.picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[UTTypePDF] asCopy:YES];
  self.picker.allowsMultipleSelection = NO;
  self.picker.delegate = self;
  [RCTPresentedViewController() presentViewController:self.picker animated:YES completion:nil];
}

RCT_EXPORT_METHOD(renderPdf:(NSString *)uri resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (self.rendering || self.invalidated) {
    reject(@"E_BUSY", @"已有 PDF 正在渲染或应用已关闭，请稍后重试", nil);
    return;
  }
  self.rendering = YES;
  dispatch_async(self.ioQueue, ^{
    NSError *error = nil;
    NSURL *source = [self localURL:uri];
    NSURL *directory = nil;
    NSMutableArray<NSString *> *pages = [NSMutableArray array];
    @try {
      if (!source || ![self validatePdf:source error:&error]) {
        error = error ?: CDError(@"只支持有效的本机 PDF 文件");
      }
      PDFDocument *document = error ? nil : [[PDFDocument alloc] initWithURL:source];
      if (!error && (!document || document.isLocked)) error = CDError(@"PDF 已加密或损坏，无法读取");
      NSUInteger count = document.pageCount;
      if (!error && (count < 1 || count > CDMaxPages)) error = CDError(@"PDF 须为 1—50 页；未截断导入，请分卷后重试");
      if (!error) directory = [self newDirectory:@"pages" error:&error];
      for (NSUInteger index = 0; !error && index < count; index++) {
        @autoreleasepool {
          if (self.invalidated) { error = CDError(@"PDF 渲染已中断，请重试"); break; }
          PDFPage *page = [document pageAtIndex:index];
          CGRect bounds = [page boundsForBox:kPDFDisplayBoxCropBox];
          if (!page || !isfinite(bounds.size.width) || !isfinite(bounds.size.height) || bounds.size.width <= 0 || bounds.size.height <= 0) {
            error = CDError(@"PDF 页面尺寸无效");
            break;
          }
          // PDFKit applies the page's intrinsic rotation. Derive the final aspect
          // ratio from its rendered image instead of stretching rotated pages.
          UIImage *thumbnail = [page thumbnailOfSize:CGSizeMake(CDMaxImageEdge, CDMaxImageEdge) forBox:kPDFDisplayBoxCropBox];
          CGSize renderedSize = thumbnail.size;
          if (!thumbnail || !isfinite(renderedSize.width) || !isfinite(renderedSize.height) || renderedSize.width <= 0 || renderedSize.height <= 0) { error = CDError(@"PDF 页面渲染失败"); break; }
          CGFloat scale = CDMaxImageEdge / MAX(renderedSize.width, renderedSize.height);
          CGSize size = CGSizeMake(MIN(CDMaxImageEdge, MAX(1, ceil(renderedSize.width * scale))), MIN(CDMaxImageEdge, MAX(1, ceil(renderedSize.height * scale))));
          UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
          format.scale = 1;
          format.opaque = YES;
          UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:format];
          UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
            [UIColor.whiteColor setFill];
            CGContextFillRect(context.CGContext, CGRectMake(0, 0, size.width, size.height));
            [thumbnail drawInRect:CGRectMake(0, 0, size.width, size.height)];
          }];
          NSData *jpeg = UIImageJPEGRepresentation(image, 0.95);
          NSURL *destination = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"page_%lu.jpg", (unsigned long)index + 1]];
          if (!jpeg || ![jpeg writeToURL:destination options:NSDataWritingAtomic error:&error]) {
            error = error ?: CDError(@"PDF 页面图片保存失败");
            break;
          }
          [pages addObject:destination.absoluteString];
        }
      }
    } @catch (NSException *exception) {
      error = CDError([NSString stringWithFormat:@"PDF 读取失败：%@", exception.reason ?: @"文件损坏"]);
    }
    self.rendering = NO;
    if (error) {
      if (directory) [[NSFileManager defaultManager] removeItemAtURL:directory error:nil];
      reject(@"E_PDF_RENDER", error.localizedDescription, error);
    } else {
      resolve(@{@"pageUris": pages, @"pageCount": @(pages.count)});
    }
  });
}

RCT_EXPORT_METHOD(savePdf:(NSString *)uri name:(NSString *)name resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![self beginPicker:@"save" resolve:resolve reject:reject]) return;
  dispatch_async(self.ioQueue, ^{
    NSError *error = nil;
    NSURL *source = [self localURL:uri];
    if (!source || ![self validatePdf:source error:&error]) error = error ?: CDError(@"没有可保存的本机 PDF");
    NSURL *directory = error ? nil : [self newDirectory:@"export" error:&error];
    NSString *filename = [name lastPathComponent];
    if (!filename.length) filename = @"挑战试卷.pdf";
    NSURL *destination = [directory URLByAppendingPathComponent:filename];
    if (!error) [self copyBounded:source destination:destination error:&error];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.invalidated || !self.pendingResolve) {
        if (directory) [[NSFileManager defaultManager] removeItemAtURL:directory error:nil];
        return;
      }
      if (error) {
        if (directory) [[NSFileManager defaultManager] removeItemAtURL:directory error:nil];
        [self clearPicker];
        reject(@"E_PDF_SAVE", error.localizedDescription, error);
        return;
      }
      self.exportDirectory = directory;
      self.picker = [[UIDocumentPickerViewController alloc] initForExportingURLs:@[destination] asCopy:YES];
      self.picker.delegate = self;
      UIViewController *controller = RCTPresentedViewController();
      if (!controller) {
        [self clearPicker];
        reject(@"E_ACTIVITY", @"当前页面不可用，请返回应用后重试", nil);
        return;
      }
      [controller presentViewController:self.picker animated:YES completion:nil];
    });
  });
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  if (controller != self.picker || !self.pendingResolve) return;
  RCTPromiseResolveBlock resolve = self.pendingResolve;
  BOOL saving = [self.operation isEqualToString:@"save"];
  [self clearPicker];
  resolve(saving ? @NO : (id)kCFNull);
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  if (controller != self.picker || !self.pendingResolve) return;
  RCTPromiseResolveBlock resolve = self.pendingResolve;
  RCTPromiseRejectBlock reject = self.pendingReject;
  BOOL saving = [self.operation isEqualToString:@"save"];
  [self clearPicker];
  if (saving) { resolve(@(urls.count > 0)); return; }
  NSURL *selected = urls.firstObject;
  if (!selected) { resolve((id)kCFNull); return; }
  BOOL scoped = [selected startAccessingSecurityScopedResource];
  dispatch_async(self.ioQueue, ^{
    NSError *error = nil;
    NSURL *directory = [self newDirectory:@"source" error:&error];
    NSURL *destination = [directory URLByAppendingPathComponent:@"source.pdf"];
    if (!error) {
      NSFileCoordinator *coordinator = [[NSFileCoordinator alloc] init];
      __block NSError *copyError = nil;
      [coordinator coordinateReadingItemAtURL:selected options:0 error:&error byAccessor:^(NSURL *readURL) {
        if ([self copyBounded:readURL destination:destination error:&copyError]) {
          [self validatePdf:destination error:&copyError];
        }
      }];
      error = error ?: copyError;
    }
    if (scoped) [selected stopAccessingSecurityScopedResource];
    if (error) {
      if (directory) [[NSFileManager defaultManager] removeItemAtURL:directory error:nil];
      reject(@"E_PDF_IMPORT", error.localizedDescription, error);
    } else {
      resolve(@{@"uri": destination.absoluteString, @"name": selected.lastPathComponent ?: @"试卷.pdf"});
    }
  });
}

- (void)invalidate {
  self.invalidated = YES;
  dispatch_async(dispatch_get_main_queue(), ^{
    RCTPromiseRejectBlock reject = self.pendingReject;
    [self.picker dismissViewControllerAnimated:NO completion:nil];
    [self clearPicker];
    if (reject) reject(@"E_INTERRUPTED", @"文件操作已中断，请重新选择", nil);
  });
}
@end
