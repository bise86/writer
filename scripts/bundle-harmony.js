const fs = require('node:fs');
const path = require('node:path');
const {
  commandBundleHarmony,
} = require('@react-native-oh/react-native-harmony-cli/dist/commands/bundle-harmony');

const output = path.join(
  'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'hermes_bundle.hbc',
);
fs.rmSync(output, {force: true});
fs.rmSync(path.join(path.dirname(output), 'bundle.harmony.js'), {force: true});
commandBundleHarmony
  .func(
    {},
    {},
    {
      dev: false,
      entryFile: 'index.js',
      resetCache: false,
      bundleOutput: output,
      assetsDest: path.join(
        'harmony',
        'entry',
        'src',
        'main',
        'resources',
        'rawfile',
        'assets',
      ),
      jsEngine: 'hermes',
      hermescDir: path.dirname(require.resolve('react-native/package.json')) + '/sdks/hermesc',
      minify: true,
    },
  )
  .then(() => {
    // The CLI can log a descriptive error and resolve. Require the artifact
    // that Index.ets actually loads before reporting a successful build.
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
      throw new Error('Harmony Hermes bundle was not generated');
    }
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
