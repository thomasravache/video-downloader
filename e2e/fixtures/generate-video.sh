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

# SPEC-0012: hls/clip/ — clipe sintético de 6 s em 2 qualidades (640x360 e 320x180), H.264 + AAC, segmentos
# MPEG-TS de 2 s (extensão .mpegts: arquivos .ts são lidos como TypeScript pelo tsc/eslint/prettier) (keyframe a cada 2 s, sem scene-cut) e uma variante fMP4 (EXT-X-MAP). Sem conteúdo de terceiros.
# As playlists de mídia vêm do ffmpeg; o master é escrito aqui. Determinístico (bitexact, sem metadados).
rm -rf hls/clip
mkdir -p hls/clip/fmp4
hls_clip() {
  # $1 largura, $2 altura, $3 bitrate de vídeo, $4 nome (v360/v180)
  ffmpeg -y -loglevel error \
    -f lavfi -i "testsrc2=size=$1x$2:rate=25:duration=6" \
    -f lavfi -i "sine=frequency=440:duration=6" \
    -c:v libx264 -threads 1 -preset veryfast -profile:v main -b:v "$3" -maxrate "$3" -bufsize "$3" \
    -g 50 -keyint_min 50 -sc_threshold 0 -pix_fmt yuv420p \
    -c:a aac -b:a 48k -ar 44100 -ac 1 -shortest \
    -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_flags independent_segments \
    -hls_segment_filename "hls/clip/$4-%d.mpegts" "hls/clip/$4.m3u8"
}
hls_clip 640 360 300k v360
hls_clip 320 180 120k v180
cat > hls/clip/master.m3u8 <<'M'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
v360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180,CODECS="avc1.4d4015,mp4a.40.2"
v180.m3u8
M
# fMP4: mesma imagem 320x180, init.mp4 + segmentos .m4s.
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=320x180:rate=25:duration=6" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -c:v libx264 -threads 1 -preset veryfast -profile:v main -b:v 120k -maxrate 120k -bufsize 120k \
  -g 50 -keyint_min 50 -sc_threshold 0 -pix_fmt yuv420p \
  -c:a aac -b:a 48k -ar 44100 -ac 1 -shortest \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "hls/clip/fmp4/f-%d.m4s" hls/clip/fmp4/media.m3u8
# Segmento TS com MPEG-2 + MP2 (sem H.264/AAC): o mux.js não produz trilhas -> UNSUPPORTED_CODEC (SPEC-0012:UT-05).
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=64x64:rate=10:duration=1" \
  -f lavfi -i "sine=frequency=440:duration=1" \
  -c:v mpeg2video -threads 1 -b:v 100k -c:a mp2 -b:a 32k -shortest \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -f mpegts hls/clip/other-codec.mpegts

# SPEC-0013: hls/single-file/ — o mesmo clipe sintético (6 s, 320x180, H.264 + AAC) como fMP4 de ARQUIVO ÚNICO:
# media.mp4 + media.m3u8 com EXT-X-MAP/EXT-X-BYTERANGE (trechos do mesmo arquivo, servidos com Range/206).
rm -rf hls/single-file
mkdir -p hls/single-file
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=320x180:rate=25:duration=6" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -c:v libx264 -threads 1 -preset veryfast -profile:v main -b:v 120k -maxrate 120k -bufsize 120k \
  -g 50 -keyint_min 50 -sc_threshold 0 -pix_fmt yuv420p \
  -c:a aac -b:a 48k -ar 44100 -ac 1 -shortest \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags single_file \
  -hls_segment_filename hls/single-file/media.mp4 hls/single-file/media.m3u8

# SPEC-0014: hls/split-av/ — vídeo e áudio em ARQUIVOS SEPARADOS, como o HLS dos sites de curso: cada trilha é um
# fMP4 de arquivo único (video.mp4 só H.264 `-an`; audio.mp4 só AAC `-vn`, ambas com track_ID 1) com a sua
# playlist (EXT-X-MAP + EXT-X-BYTERANGE), e master.m3u8 com EXT-X-STREAM-INF AUDIO="a1" + EXT-X-MEDIA (6 s, 320x180).
# master-enc-audio.m3u8 aponta para audio-enc.m3u8 (mesma faixa, mas com EXT-X-KEY AES-128: a chave não existe;
# a extensão deve recusar sem baixar nada).
rm -rf hls/split-av
mkdir -p hls/split-av
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=320x180:rate=25:duration=6" \
  -an -c:v libx264 -threads 1 -preset veryfast -profile:v main -b:v 120k -maxrate 120k -bufsize 120k \
  -g 50 -keyint_min 50 -sc_threshold 0 -pix_fmt yuv420p \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags single_file \
  -hls_segment_filename hls/split-av/video.mp4 hls/split-av/video.m3u8
ffmpeg -y -loglevel error \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -vn -c:a aac -b:a 48k -ar 44100 -ac 1 \
  -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags single_file \
  -hls_segment_filename hls/split-av/audio.mp4 hls/split-av/audio.m3u8
cat > hls/split-av/master.m3u8 <<'M'
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x180,CODECS="avc1.4d4015,mp4a.40.2",AUDIO="a1"
video.m3u8
M
sed 's#^\(\#EXT-X-VERSION.*\)$#\1\n\#EXT-X-KEY:METHOD=AES-128,URI="key.bin"#' hls/split-av/audio.m3u8 > hls/split-av/audio-enc.m3u8
sed 's#audio.m3u8#audio-enc.m3u8#' hls/split-av/master.m3u8 > hls/split-av/master-enc-audio.m3u8
