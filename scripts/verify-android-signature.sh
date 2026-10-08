#!/usr/bin/env bash
# Verify the built APK's actual signer before allowing release upload.
set -euo pipefail
apk="${1:?Usage: verify-android-signature.sh path/to/release.apk}"
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${sdk_dir:?Android SDK location is required}"
apksigner="${sdk_dir}/build-tools/35.0.0/apksigner"
test -x "${apksigner}"
report="$(mktemp)"
trap 'rm -f -- "${report}"' EXIT
"${apksigner}" verify --verbose --print-certs "${apk}" | tee "${report}"
python3 - "${project_dir}/android/signing/release-certificate.sha256" "${report}" <<'PY'
import pathlib
import re
import sys
expected = pathlib.Path(sys.argv[1]).read_text().strip().lower()
report = pathlib.Path(sys.argv[2]).read_text()
signers = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$', report, re.MULTILINE)
if len(signers) != 1 or signers[0].lower() != expected:
    sys.exit('APK certificate does not match the permanent signing certificate; release upload blocked')
print('APK signature verified against the permanent certificate.')
PY
