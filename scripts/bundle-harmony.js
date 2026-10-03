const path = require('node:path');
const {
  commandBundleHarmony,
} = require('@react-native-oh/react-native-harmony-cli/dist/commands/bundle-harmony');

commandBundleHarmony
  .func(
    {},
    {},
    {
      dev: false,
      entryFile: 'index.js',
      resetCache: false,
      bundleOutput: path.join(
        'harmony',
        'entry',
        'src',
        'main',
        'resources',
        'rawfile',
        'bundle.harmony.js',
      ),
      assetsDest: path.join(
        'harmony',
        'entry',
        'src',
        'main',
        'resources',
        'rawfile',
        'assets',
      ),
      jsEngine: 'any',
      minify: true,
    },
  )
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
