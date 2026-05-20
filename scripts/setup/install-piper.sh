#!/usr/bin/env bash
set -euo pipefail

VENV_DIR="assets/piper-venv"
VOICES_DIR="assets/voices"
PIPER_BIN="$VENV_DIR/bin/piper"

echo "==> Setting up Piper TTS venv at $VENV_DIR..."
if [ ! -x "$PIPER_BIN" ]; then
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --quiet --upgrade pip
  "$VENV_DIR/bin/pip" install --quiet piper-tts
else
  echo "    piper already installed in venv"
fi

mkdir -p "$VOICES_DIR"

download_voice() {
  local name="$1"
  local onnx_url="$2"
  local json_url="$3"
  if [ -f "$VOICES_DIR/$name.onnx" ]; then
    echo "    $name already downloaded"
    return
  fi
  echo "==> Downloading $name..."
  curl -L -o "$VOICES_DIR/$name.onnx" "$onnx_url"
  curl -L -o "$VOICES_DIR/$name.onnx.json" "$json_url"
}

# Ryan (male, authoritative)
download_voice "en_US-ryan-high" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json"

# Amy (female, clear)
download_voice "en_US-amy-medium" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx" \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"

echo "==> Piper setup complete."
echo "    Binary: $PIPER_BIN"
ls -la "$VOICES_DIR"
