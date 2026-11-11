export interface ImportedSource {
  kind: 'image' | 'pdf';
  name: string;
  uri: string;
  pageUris: string[];
}
export interface PreparedImage {
  uri: string;
  name: string;
}
