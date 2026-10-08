#!/usr/bin/env bash
# One-time local setup. Release workflows only restore this key, never generate it.
set -euo pipefail
umask 077
if [[ -n "${GITHUB_ACTIONS:-}" || "${CI:-}" == true ]]; then
  echo 'Generate the permanent signing key once on your own machine, not in CI.' >&2
  exit 1
fi
command -v keytool >/dev/null
command -v python3 >/dev/null
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
signing_dir="${1:-${XDG_DATA_HOME:-${HOME}/.local/share}/essaylens/signing}"
signing_dir="$(python3 - "${signing_dir}" "${project_dir}" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1]).expanduser().resolve()
project = Path(sys.argv[2]).resolve()
try:
    path.relative_to(project)
except ValueError:
    print(path)
else:
    sys.exit('Private signing files must be stored outside the repository.')
PY
)"
mkdir -p -- "$(dirname -- "${signing_dir}")"
# mkdir is atomic: even two concurrent invocations cannot replace an existing key.
if ! mkdir -- "${signing_dir}"; then
  echo "Signing directory already exists; refusing to replace any key: ${signing_dir}" >&2
  exit 1
fi

python3 - "${signing_dir}" <<'PY'
from pathlib import Path
import secrets
import sys
folder = Path(sys.argv[1])
(folder / 'password.txt').write_text(secrets.token_urlsafe(32) + '\n', encoding='utf-8')
PY
keytool -genkeypair -noprompt -storetype PKCS12 \
  -keystore "${signing_dir}/essaylens-release.p12" \
  -alias essaylens-release -keyalg RSA -keysize 3072 -sigalg SHA256withRSA \
  -validity 36500 -dname 'CN=EssayLens Android, O=EssayLens, C=CN' \
  -storepass:file "${signing_dir}/password.txt" \
  -keypass:file "${signing_dir}/password.txt"
keytool -exportcert -keystore "${signing_dir}/essaylens-release.p12" \
  -alias essaylens-release -storepass:file "${signing_dir}/password.txt" \
  -file "${signing_dir}/certificate.der" >/dev/null

python3 - "${signing_dir}" "${project_dir}" <<'PY'
import base64
import hashlib
from pathlib import Path
import os
import sys
folder, project = map(Path, sys.argv[1:])
password = (folder / 'password.txt').read_text().strip()
encoded = base64.b64encode((folder / 'essaylens-release.p12').read_bytes()).decode('ascii')
fingerprint = hashlib.sha256((folder / 'certificate.der').read_bytes()).hexdigest()
(folder / 'keystore.base64').write_text(encoded + '\n', encoding='ascii')
(folder / 'github-secrets.env').write_text(
    f'ANDROID_KEYSTORE_BASE64={encoded}\n'
    f'ANDROID_KEYSTORE_PASSWORD={password}\n'
    'ANDROID_KEY_ALIAS=essaylens-release\n'
    f'ANDROID_KEY_PASSWORD={password}\n', encoding='utf-8')
(folder / 'release-certificate.sha256').write_text(fingerprint + '\n', encoding='ascii')
# Only this public fingerprint belongs in Git. The private key and password stay local.
pin = project / 'android/signing/release-certificate.sha256'
temporary = pin.with_suffix('.sha256.tmp')
temporary.write_text(fingerprint + '\n', encoding='ascii')
os.chmod(temporary, 0o644)
os.replace(temporary, pin)
print(f'Created permanent EssayLens signing key in: {folder}')
print(f'Certificate SHA-256: {fingerprint}')
print('Back up the entire private directory. Passwords are saved in password.txt and github-secrets.env.')
print('Configure the four repository Secrets before publishing a new tag. Do not regenerate this key for future releases.')
PY
