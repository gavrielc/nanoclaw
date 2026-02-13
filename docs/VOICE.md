# Voice on the Target Device (ESP32-S3)

This doc covers how voice input/output should work on the Waveshare ESP32-S3 target (`docs/TARGET_DEVICE.md`) and what it takes to run the voice models discussed so far.

## Summary (What Runs Where)

Reality check for this board (16 MB flash, 8 MB PSRAM):
- General ASR models like Whisper/Distil-Whisper are not realistic to run fully on-device.
- Neural high-quality TTS models (0.3B-0.5B params) are not realistic to run fully on-device.
- On-device voice is still very feasible for:
  - Wake word detection.
  - Offline command recognition (bounded command sets).
  - Basic TTS (not neural / not "studio quality"), or "speech as a feature" via remote TTS.

Recommended architecture:
- On-device (ESP32-S3): AFE + wake word + command recognition + audio capture/playback.
- Off-device (LAN/Cloud): full ASR and "crisp" neural TTS.

If "fully offline, general ASR + high-quality neural TTS on the ESP32-S3 itself" is a hard requirement, this target is the wrong class of hardware. Plan for an off-device gateway (LAN) or upgrade the target to a Linux-capable SoC with an NPU/GPU.

## On-Device Building Blocks (ESP-IDF / ESP-SR)

Espressif ESP-SR provides:
- Wake word: WakeNet. Designed for always-listening wake words on ESP32-S3.
- Offline command recognition: MultiNet. Up to ~200 commands, customizable, with low delay.
- Acoustic front-end (AFE): AEC/VAD/noise suppression/etc. (configuration dependent).

Relevant docs:
- ESP-SR repo: https://github.com/espressif/esp-sr
- ESP-SR docs (ESP32-S3): https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/

Benchmark/resource notes (ESP32-S3, per Espressif docs):
- WakeNet9 (quantized, 2ch): ~16 KB RAM + ~324 KB PSRAM, ~3 ms per 32 ms frame.
- MultiNet (varies by model): roughly ~1.0 MB to ~4.1 MB PSRAM, ~11-18 ms per 32 ms frame.
- ESP-SR TTS exists but is documented as Chinese-only; flash image size ~2.2 MB and runtime RAM ~20 KB.

This is the "TinyML" tier that actually fits ESP32-S3-class devices.

## On-Device TTS Options (If We Need Local Speech)

1. ESP-SR TTS (Chinese-only)
- Use if Chinese output is acceptable.
- See ESP-SR docs: "Speech Synthesis (Only Supports Chinese Language)".

2. PicoTTS (multi-language, non-neural)
- `esp-picotts` is an ESP-IDF component that can generate 16 kHz PCM.
- It is resource intensive but feasible on ESP32-S3 with PSRAM: language resources ~750-1400 KB flash (per language) and ~1.1 MB RAM when initialized.
- Repo: https://github.com/DiUS/esp-picotts

If we require "crisp neural TTS", treat local TTS as a fallback only and use remote TTS.

## Off-Device Voice Models (Run Remotely, Stream Audio To/From ESP32)

The board should treat these as remote services, not on-device inference.

### ASR: Distil-Whisper (distil-small.en)

- Hugging Face model: `distil-whisper/distil-small.en` (166M parameters).
- Intended as a smaller/faster Whisper variant but still far beyond ESP32-S3 budgets.
- Run on a server (x86/ARM Linux) and expose a simple HTTP/WebSocket API:
  - request: 16 kHz mono PCM/WAV
  - response: JSON transcript + timings (optional)

Model card:
- https://huggingface.co/distil-whisper/distil-small.en

### TTS: Parler-TTS Tiny v1

- Hugging Face model: `parler-tts/parler-tts-tiny-v1` (0.3B params).
- Not feasible on ESP32-S3; run on a server (likely needs a GPU for good latency).

Model card:
- https://huggingface.co/parler-tts/parler-tts-tiny-v1

### TTS: Microsoft VibeVoice Realtime 0.5B

- Microsoft open-sourced `VibeVoice-Realtime-0.5B` (0.5B params) for real-time streaming TTS.
- Not feasible on ESP32-S3; run on a server (GPU recommended for "realtime").

Repo:
- https://github.com/microsoft/VibeVoice

### TTS: Smallest.ai Lightning v2

- Lightning v2 is a Smallest.ai model offered via their platform/docs (API service).
- Treat as a remote TTS provider (network required); do not plan on-device inference.

Docs:
- https://waves-docs.smallest.ai/

### Sensory (Wake word / Commands / NLU)

- Sensory provides proprietary wake word + speech-to-text + "Micro Language Models" for embedded use cases.
- Their wake word marketing material claims very small footprints (starting tens of KB), but their embedded STT models are described in the tens-to-hundreds of MB range and may not fit this board's 16 MB flash.

Product pages:
- https://sensory.com/product/wake-word/
- https://sensory.com/product/speech-to-text/
- https://sensory.com/product/micro-language-and-custom-grammar-models/

If we go this route, treat it as a licensed vendor SDK decision and validate memory/flash requirements early.

## Practical Integration Plan (NanoClaw Rust Port)

We should model voice as a first-class subsystem with explicit resource bounds:

On-device responsibilities:
- Capture audio (I2S mic) at 16 kHz mono, 16-bit samples.
- Run AFE + WakeNet continuously.
- After wake: run MultiNet for local commands OR record a short utterance buffer and upload for remote ASR.
- Play audio (I2S DAC) from either:
  - remote TTS audio stream (preferred for "crisp" output), or
  - local TTS fallback (PicoTTS / ESP-SR TTS where acceptable).

Remote responsibilities:
- Provide `voice-gateway` service with:
  - `/asr` endpoint (Distil-Whisper or alternate)
  - `/tts` endpoint (VibeVoice/Parler-TTS/Smallest API or alternate)
  - strict egress allowlist, logging redaction, and bounded payload sizes

Security notes:
- Audio is sensitive data. Default to local-LAN inference where possible.
- Enforce egress policy in the device network stack and in the gateway.
- Keep credentials out of device firmware; use short-lived tokens if we must call a cloud API.
