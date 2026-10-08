#!/usr/bin/env bash
# Restore the existing release key from Actions Secrets. Never generate a key.
set -euo pipefail
umask 077

for variable in ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    echo "::error::Missing permanent signing secret: ${variable}. Release signing cannot use a debug key."
    exit 1
  fi
done
for variable in ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
  if [[ "${!variable}" == *$'\n'* || "${!variable}" == *$'\r'* ]]; then
    echo "::error::Signing secret ${variable} must be a single line."
    exit 1
  fi
done
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
expected="$(tr -d '[:space:]' < "${project_dir}/android/signing/release-certificate.sha256")"
if [[ ! "${expected}" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo '::error::The pinned release certificate SHA-256 fingerprint is invalid.'
  exit 1
fi

signing_dir="$(mktemp -d "${RUNNER_TEMP}/essaylens-signing.XXXXXX")"
keystore="${signing_dir}/release.keystore"
certificate="${signing_dir}/certificate.der"
prepared=false
trap 'if [[ "${prepared}" != true ]]; then rm -rf -- "${signing_dir}"; fi' EXIT
printf '%s' "${ANDROID_KEYSTORE_BASE64}" | base64 --decode > "${keystore}"
test -s "${keystore}"
keytool -exportcert -keystore "${keystore}" \
  -storepass:env ANDROID_KEYSTORE_PASSWORD -alias "${ANDROID_KEY_ALIAS}" \
  -file "${certificate}" >/dev/null
actual="$(sha256sum "${certificate}" | cut -d ' ' -f 1)"
if [[ "${actual,,}" != "${expected,,}" ]]; then
  echo '::error::The signing certificate differs from the pinned permanent certificate. Refusing to change the app signing identity.'
  exit 1
fi
{
  printf 'ANDROID_KEYSTORE_FILE=%s\n' "${keystore}"
  printf 'ANDROID_KEYSTORE_PASSWORD=%s\n' "${ANDROID_KEYSTORE_PASSWORD}"
  printf 'ANDROID_KEY_ALIAS=%s\n' "${ANDROID_KEY_ALIAS}"
  printf 'ANDROID_KEY_PASSWORD=%s\n' "${ANDROID_KEY_PASSWORD}"
  printf 'ESSAY_SIGNING_DIR=%s\n' "${signing_dir}"
} >> "${GITHUB_ENV}"
prepared=true
echo "Permanent signing certificate verified: ${actual}"
