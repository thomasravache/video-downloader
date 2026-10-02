#!/bin/sh
# Gera e2e/fixtures/sample.mp4 (2 s, 160x120, sintético: testsrc2 + tom senoidal), sem conteúdo de terceiros.
# Determinístico: sem metadados/timestamps (-fflags +bitexact). Requer ffmpeg local.
set -eu
cd "$(dirname "$0")"
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=160x120:rate=10:duration=2" \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 32k -shortest \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -movflags +faststart sample.mp4

# SPEC-0010: media/stream.mp4 (4 s, 320x240, > 100 KiB, o corte mínimo da detecção por rede); mesmo conteúdo sintético.
mkdir -p media
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=320x240:rate=25:duration=4" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -c:v libx264 -preset veryfast -b:v 400k -pix_fmt yuv420p -c:a aac -b:a 64k -shortest \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -movflags +faststart media/stream.mp4
