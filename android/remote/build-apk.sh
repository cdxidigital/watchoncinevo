#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_SDK_ROOT:-/tmp/android-sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
WORK="${TMPDIR:-/tmp}/cinevo-remote-apk"
OUT="$ROOT/../../public/installers/CINEVO.apk"
STOREPASS="${CINEVO_REMOTE_STOREPASS:?Set CINEVO_REMOTE_STOREPASS}"
KEYPASS="${CINEVO_REMOTE_KEYPASS:-$STOREPASS}"
rm -rf "$WORK"
mkdir -p "$WORK/classes" "$WORK/compiled"
"$BT/aapt2" compile --dir "$ROOT/res" -o "$WORK/compiled"
"$BT/aapt2" link \
  -o "$WORK/base.apk" \
  -I "$JAR" \
  --manifest "$ROOT/AndroidManifest.xml" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  "$WORK/compiled/"*.flat
javac --release 17 -classpath "$JAR" -d "$WORK/classes" "$ROOT/src/me/cinevo/remote/MainActivity.java"
"$BT/d8" --min-api 24 --lib "$JAR" --output "$WORK" "$WORK/classes/me/cinevo/remote/"*.class
python3 - << PY2
import zipfile
zipfile.ZipFile("$WORK/base.apk", "a").write("$WORK/classes.dex", "classes.dex")
PY2
"$BT/zipalign" -p -f 4 "$WORK/base.apk" "$WORK/aligned.apk"
KEYSTORE="${CINEVO_REMOTE_KEYSTORE:-$ROOT/cinevo-remote.jks}"
if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$STOREPASS" -keypass "$KEYPASS" \
    -alias cinevo -keyalg RSA -keysize 2048 -validity 3650 \
    -dname "CN=CINEVO Remote, O=CINEVO, C=AU"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$STOREPASS" --key-pass "pass:$KEYPASS" \
  --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT"
cp -f "$OUT" "$ROOT/../../public/installers/CINEVO-Remote.apk"
echo "wrote $OUT"
