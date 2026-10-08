const fs = require('node:fs');
const path = require('node:path');

// RN 0.77 codegen accepts .ts specs but rejects .tsx. This upstream spec has
// no JSX; renaming it preserves the implementation and lets Metro parse it.
const spec = path.join(
  path.dirname(
    require.resolve('@react-native-oh-tpl/react-native-pdf/package.json'),
  ),
  'fabric',
  'RTNPdfViewNativeComponent',
);
if (fs.existsSync(`${spec}.tsx`)) {
  fs.renameSync(`${spec}.tsx`, `${spec}.ts`);
} else if (!fs.existsSync(`${spec}.ts`)) {
  throw new Error(
    'Harmony PDF native spec is missing; check the pinned dependency version',
  );
}

// Arbitrary HTTP headers cannot be represented by RN 0.77 component codegen.
// The app previews local files; the native source shape still accepts other fields.
const source = fs.readFileSync(`${spec}.ts`, 'utf8');
fs.writeFileSync(
  `${spec}.ts`,
  source
    .replace(/  headers\?: \{[\s\S]*?  \};\r?\n/, '')
    .replace('expiration?: number', 'expiration?: Float'),
);
