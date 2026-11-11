export type Size = {width: number; height: number};
export type Point = {x: number; y: number};
export type Rect = Point & Size;
export type ImageTransform = Point & {scale: number};
export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function containRect(image: Size, viewport: Size): Rect {
  const scale = Math.min(
    viewport.width / image.width,
    viewport.height / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  };
}

export function constrainTransform(
  value: ImageTransform,
  image: Size,
  viewport: Size,
): ImageTransform {
  const scale = clamp(value.scale, 1, 8);
  const fitted = containRect(image, viewport);
  const maxX = Math.max(0, (fitted.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (fitted.height * scale - viewport.height) / 2);
  return {
    scale,
    x: clamp(value.x, -maxX, maxX),
    y: clamp(value.y, -maxY, maxY),
  };
}

/** Keep the image point beneath the pinch midpoint beneath the fingers. */
export function pinchTransform(
  start: ImageTransform,
  from: Point,
  to: Point,
  ratio: number,
): ImageTransform {
  const scale = clamp(start.scale * ratio, 1, 8);
  const factor = scale / start.scale;
  return {
    scale,
    x: to.x - (from.x - start.x) * factor,
    y: to.y - (from.y - start.y) * factor,
  };
}

export function moveCrop(
  rect: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: Size,
): Rect {
  const minWidth = Math.min(48, bounds.width);
  const minHeight = Math.min(48, bounds.height);
  if (handle === 'move') {
    return {
      ...rect,
      x: clamp(rect.x + dx, 0, bounds.width - rect.width),
      y: clamp(rect.y + dy, 0, bounds.height - rect.height),
    };
  }
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = handle.includes('w')
    ? clamp(rect.x + dx, 0, right - minWidth)
    : rect.x;
  const y = handle.includes('n')
    ? clamp(rect.y + dy, 0, bottom - minHeight)
    : rect.y;
  const endX = handle.includes('e')
    ? clamp(right + dx, x + minWidth, bounds.width)
    : right;
  const endY = handle.includes('s')
    ? clamp(bottom + dy, y + minHeight, bounds.height)
    : bottom;
  return {x, y, width: endX - x, height: endY - y};
}

/** Map the visible selection to source pixels, including the letterbox offset. */
export function cropPixels(rect: Rect, displayed: Size, source: Size): Rect {
  const x = clamp(
    Math.round((rect.x / displayed.width) * source.width),
    0,
    source.width - 1,
  );
  const y = clamp(
    Math.round((rect.y / displayed.height) * source.height),
    0,
    source.height - 1,
  );
  const right = clamp(
    Math.round(((rect.x + rect.width) / displayed.width) * source.width),
    x + 1,
    source.width,
  );
  const bottom = clamp(
    Math.round(((rect.y + rect.height) / displayed.height) * source.height),
    y + 1,
    source.height,
  );
  return {x, y, width: right - x, height: bottom - y};
}
