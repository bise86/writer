import {
  containRect,
  constrainTransform,
  cropPixels,
  moveCrop,
  pinchTransform,
} from '../src/services/image-geometry';

test('横图在竖屏中居中留白，裁剪坐标映射回源像素', () => {
  const fitted = containRect(
    {width: 4000, height: 2000},
    {width: 400, height: 600},
  );
  expect(fitted).toEqual({x: 0, y: 200, width: 400, height: 200});
  expect(
    cropPixels({x: 50, y: 20, width: 300, height: 150}, fitted, {
      width: 4000,
      height: 2000,
    }),
  ).toEqual({x: 500, y: 200, width: 3000, height: 1500});
});
test('边角不能反转或超出原图，整框拖动不改变大小', () => {
  const rect = {x: 40, y: 60, width: 180, height: 220};
  const size = {width: 300, height: 400};
  expect(moveCrop(rect, 'nw', -100, -100, size)).toEqual({
    x: 0,
    y: 0,
    width: 220,
    height: 280,
  });
  expect(moveCrop(rect, 'se', -1000, -1000, size)).toEqual({
    ...rect,
    width: 48,
    height: 48,
  });
  expect(moveCrop(rect, 'move', 1000, 1000, size)).toEqual({
    ...rect,
    x: 120,
    y: 180,
  });
});
test('捏合围绕手指中点缩放，倍率和拖动限制在有效边界', () => {
  const value = pinchTransform(
    {scale: 1, x: 0, y: 0},
    {x: 50, y: 30},
    {x: 70, y: 40},
    2,
  );
  expect(value).toEqual({scale: 2, x: -30, y: -20});
  expect(
    constrainTransform(
      {scale: 20, x: 9999, y: -9999},
      {width: 400, height: 600},
      {width: 400, height: 600},
    ),
  ).toEqual({scale: 8, x: 1400, y: -2100});
  expect(
    constrainTransform(
      {scale: 0.3, x: 500, y: 500},
      {width: 400, height: 600},
      {width: 400, height: 600},
    ),
  ).toEqual({scale: 1, x: 0, y: 0});
});
