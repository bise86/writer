import React from 'react';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import Pdf from 'react-native-pdf';
import PdfPreview from '../src/shared/pdf/PdfPreview';

jest.mock('react-native-pdf', () => 'SharedPdf');
let view: ReactTestRenderer;
const onError = jest.fn();
const onPageChanged = jest.fn();
const render = (uri: string) => (
  <PdfPreview uri={uri} onError={onError} onPageChanged={onPageChanged} />
);
beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    view = create(render('file:///paper.pdf'));
  });
});
afterEach(() => act(() => view.unmount()));

test('公共预览转发当前文件页码和错误，并保留既有预览选项', () => {
  const pdf = view.root.findByType(Pdf);
  expect(pdf.props.source).toEqual({uri: 'file:///paper.pdf', cache: false});
  expect(pdf.props.trustAllCerts).toBe(false);
  act(() => {
    pdf.props.onPageChanged(2, 5);
    pdf.props.onError('当前文件读取失败');
  });
  expect(onPageChanged).toHaveBeenCalledWith(2, 5);
  expect(onError).toHaveBeenCalledWith('当前文件读取失败');
});

test('试卷到答案再回试卷后，第一次预览的迟到回调也不能污染当前文件', () => {
  const old = view.root.findByType(Pdf).props;
  act(() => view.update(render('file:///answers.pdf')));
  act(() => view.update(render('file:///paper.pdf')));
  act(() => {
    old.onError('旧错误');
    old.onPageChanged(4, 9);
  });
  expect(onError).not.toHaveBeenCalled();
  expect(onPageChanged).not.toHaveBeenCalled();
  act(() => view.root.findByType(Pdf).props.onPageChanged(1, 5));
  expect(onPageChanged).toHaveBeenCalledWith(1, 5);
});

test('离开功能页之后不再向已卸载页面转发原生事件', () => {
  const old = view.root.findByType(Pdf).props;
  act(() => view.unmount());
  act(() => {
    old.onError('离页后的错误');
    old.onPageChanged(1, 2);
  });
  expect(onError).not.toHaveBeenCalled();
  expect(onPageChanged).not.toHaveBeenCalled();
});
