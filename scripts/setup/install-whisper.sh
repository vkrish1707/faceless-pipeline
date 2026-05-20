#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing whisper-cpp via Homebrew..."
# The whisper-cpp formula ships the binary as `whisper-cli` (renamed upstream).
if ! command -v whisper-cli >/dev/null 2>&1; then
  brew install whisper-cpp
else
  echo "    whisper-cli already installed"
fi

WHISPER_DIR="assets/whisper"
mkdir -p "$WHISPER_DIR"

MODEL="$WHISPER_DIR/ggml-small.en.bin"
if [ -f "$MODEL" ]; then
  echo "    small.en model already downloaded"
else
  echo "==> Downloading small.en model (~466MB)..."
  curl -L -o "$MODEL" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
fi

echo "==> whisper setup complete."
ls -la "$WHISPER_DIR"
