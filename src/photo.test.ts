import { expect, it } from 'vitest';
import { resizedDimensions } from './photo';

it('横長写真の縦横比を維持して長辺を1920pxにする', () => {
  expect(resizedDimensions(4032, 3024)).toEqual({ width: 1920, height: 1440 });
});
it('縦長写真の縦横比を維持して長辺を1920pxにする', () => {
  expect(resizedDimensions(3024, 4032)).toEqual({ width: 1440, height: 1920 });
});
it('小さい写真を拡大しない', () => {
  expect(resizedDimensions(600, 400)).toEqual({ width: 600, height: 400 });
});
it('無効な写真サイズを拒否する', () => {
  expect(() => resizedDimensions(0, 400)).toThrow();
  expect(() => resizedDimensions(Infinity, 400)).toThrow();
});
