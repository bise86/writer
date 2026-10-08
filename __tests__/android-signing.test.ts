import {execFileSync, spawnSync} from 'child_process';
import {createHash} from 'crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

// Reuse the existing development fixture; these tests never generate a key.
const keytoolAvailable = spawnSync('keytool', ['-help']).status === 0;
const signingTests = keytoolAvailable ? describe : describe.skip;
signingTests('permanent release signing', () => {
  const originalKeystore = readFileSync(resolve('android/app/debug.keystore'));
  let root: string;
  let env: NodeJS.ProcessEnv;
  const required = [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'writer-signing-test-'));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'android/signing'), {recursive: true});
    mkdirSync(join(root, 'temp'));
    copyFileSync(
      resolve('scripts/prepare-android-signing.sh'),
      join(root, 'scripts/prepare-android-signing.sh'),
    );
    writeFileSync(join(root, 'fixture.keystore'), originalKeystore);
    const certificate = execFileSync(
      'keytool',
      [
        '-exportcert',
        '-keystore',
        join(root, 'fixture.keystore'),
        '-storepass',
        'android',
        '-alias',
        'androiddebugkey',
      ],
      {stdio: ['ignore', 'pipe', 'ignore']},
    );
    writeFileSync(
      join(root, 'android/signing/release-certificate.sha256'),
      createHash('sha256').update(certificate).digest('hex') + '\n',
    );
    env = {
      ...process.env,
      RUNNER_TEMP: join(root, 'temp'),
      GITHUB_ENV: join(root, 'github-env'),
      ANDROID_KEYSTORE_BASE64: originalKeystore.toString('base64'),
      ANDROID_KEYSTORE_PASSWORD: 'android',
      ANDROID_KEY_ALIAS: 'androiddebugkey',
      ANDROID_KEY_PASSWORD: 'android',
    };
  });
  afterEach(() => rmSync(root, {recursive: true, force: true}));
  const run = () =>
    spawnSync('bash', [join(root, 'scripts/prepare-android-signing.sh')], {
      env,
      encoding: 'utf8',
    });
  test('successive builds restore exactly the same key bytes', () => {
    for (let i = 0; i < 2; i += 1) {
      expect(run().status).toBe(0);
    }
    const dirs = readdirSync(join(root, 'temp'));
    expect(dirs).toHaveLength(2);
    for (const dir of dirs) {
      expect(readFileSync(join(root, 'temp', dir, 'release.keystore'))).toEqual(
        originalKeystore,
      );
    }
  });
  test.each(required)(
    'missing %s cannot fall back to a different key',
    variable => {
      delete env[variable];
      expect(run().status).not.toBe(0);
      expect(existsSync(env.GITHUB_ENV!)).toBe(false);
      expect(readdirSync(join(root, 'temp'))).toEqual([]);
    },
  );
  test('another certificate is rejected and temporary credentials removed', () => {
    copyFileSync(
      resolve('android/signing/release-certificate.sha256'),
      join(root, 'android/signing/release-certificate.sha256'),
    );
    const result = run();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('differs from the pinned');
    expect(existsSync(env.GITHUB_ENV!)).toBe(false);
    expect(readdirSync(join(root, 'temp'))).toEqual([]);
  });
  test('invalid password cannot export any signing environment values', () => {
    env.ANDROID_KEYSTORE_PASSWORD = 'incorrect-password';
    expect(run().status).not.toBe(0);
    expect(existsSync(env.GITHUB_ENV!)).toBe(false);
    expect(readdirSync(join(root, 'temp'))).toEqual([]);
  });
});
