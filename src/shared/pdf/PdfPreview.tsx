import React, {useEffect, useRef} from 'react';
import {Platform, StyleProp, StyleSheet, ViewStyle} from 'react-native';
import Pdf from 'react-native-pdf';

export default function PdfPreview({
  uri,
  style,
  onPageChanged,
  onError,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  onPageChanged?: (page: number, count: number) => void;
  onError?: (message: string) => void;
}) {
  const active = useRef(true);
  const source = useRef({uri, revision: 0});
  if (source.current.uri !== uri) {
    source.current = {uri, revision: source.current.revision + 1};
  }
  const revision = source.current.revision;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <Pdf
      key={`${revision}-${uri}`}
      source={{
        uri:
          (Platform.OS as string) === 'harmony'
            ? uri.replace(/^file:\/\//, '')
            : uri,
        cache: false,
      }}
      style={[styles.pdf, style]}
      fitPolicy={0}
      trustAllCerts={false}
      onPageChanged={(page, count) => {
        if (active.current && source.current.revision === revision) {
          onPageChanged?.(page, count);
        }
      }}
      onError={reason => {
        if (active.current && source.current.revision === revision) {
          onError?.(String(reason));
        }
      }}
    />
  );
}
const styles = StyleSheet.create({pdf: {flex: 1, backgroundColor: '#e2e8f0'}});
