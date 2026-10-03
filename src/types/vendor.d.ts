declare module 'react-native-sqlite-storage' {
  export interface ResultSet { rows: { length: number; item(index: number): any } }
  export interface SQLiteDatabase { executeSql(sql: string, params?: any[]): Promise<[ResultSet]> }
  export function enablePromise(value: boolean): void;
  export function openDatabase(options: {name: string; location?: string}): Promise<SQLiteDatabase>;
  const SQLite: { enablePromise: typeof enablePromise; openDatabase: typeof openDatabase };
  export default SQLite;
}

declare module '*.json' {
  const value: any;
  export default value;
}

declare module '@react-native-ml-kit/text-recognition' {
  export const TextRecognitionScript: {CHINESE: string; LATIN: string};
  const TextRecognition: {
    recognize(uri: string, script?: string): Promise<{text: string; blocks?: Array<{text: string}>}>;
  };
  export default TextRecognition;
}
