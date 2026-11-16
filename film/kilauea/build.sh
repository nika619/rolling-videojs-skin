#!/bin/sh
# Builds "Kīlauea 2026", the film the Rolling page plays, from USGS Hawaiian Volcano Observatory footage (public domain).
# sh film/kilauea/build.sh   ->  media/out/kilauea-2026-mezzanine.mp4 (for Mux), site/public/film/kilauea-2026.mp4 (web),
#                                poster and storyboard. Needs ffmpeg and curl. The chapter and text tracks are written by hand
#                                next to the web file; the cumulative times this prints are what they follow.
set -e
cd "$(dirname "$0")/../.."
SRC=media/src WORK=media/work OUT=media/out WEB=site/public/film
mkdir -p $SRC $WORK $OUT $WEB
S3=https://usgs-ocapsv2-public-input-media.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/media/video
fetch() { [ -s $SRC/$1.mp4 ] || curl -sL -o $SRC/$1.mp4 "$S3/$2"; }
fetch ep43 multimediaFile-4597.mp4
fetch ep44 episode44-2.mp4
fetch ep45 multimediaFile-4629.mp4
fetch ep46 ep46highlights.mp4
fetch ep48 DSC_7557_converted.mp4
fetch ep55 multimediaFile-4758_mp4.mp4
fetch ep56v1 vlc-record-2026-11-09-09h43m57s-V1cam20261105M.avi--converted.mp4
# drawtext reads fonts and text by relative path (a Windows drive colon breaks filter parsing).
cp /c/Windows/Fonts/pala.ttf /c/Windows/Fonts/palai.ttf $WORK/ 2>/dev/null || true
printf 'K  Ī  L  A  U  E  A     2  0  2  6' > $WORK/title.txt
printf 'Seven eruptions at the summit, March to November' > $WORK/sub.txt
printf 'Footage: U.S. Geological Survey, Hawaiian Volcano Observatory. Public domain.' > $WORK/end1.txt
printf 'Filmed by M. Patrick, L. Gallant, D. Downs and the HVO webcams.' > $WORK/end2.txt
printf 'Cut for Rolling, a skin for Video.js 10.' > $WORK/end3.txt

TAIL='scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p'
ENC='-c:v libx264 -preset slow -crf 12 -g 30 -c:a aac -b:a 320k -ar 48000 -ac 2'
AUD='aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-18:TP=-2:LRA=7'
calc() { awk "BEGIN { printf \"%.3f\", $1 }"; }
T=0; N=0; : > $WORK/list.txt
# seg <source> <in> <seconds of source> <n|s4|t> [extra video filters]
#   n: real time (120 and 60 fps sources blend frames into a film-like shutter); s4: four times slower over the
#   real-time sound; t: the six-hour webcam timelapse, a quarter faster, under episode 44's sound.
seg() {
  src=$1 in=$2 dur=$3 mode=$4 extra=${5:+,$5}
  fps=$(ffprobe -v error -select_streams v -show_entries stream=r_frame_rate -of csv=p=0 $SRC/$src.mp4 | awk -F/ '{printf "%d", $1/$2 + 0.5}')
  case $mode in
    n) out=$dur; blend=$([ $fps -ge 100 ] && echo 'tmix=frames=3,' || ([ $fps -ge 50 ] && echo 'tmix=frames=2,') || true)
       vf="${blend}fps=30"; asrc="-ss $in -t $out -i $SRC/$src.mp4" ;;
    s4) out=$(calc "$dur * 4"); vf='setpts=4*PTS,fps=30'; asrc="-ss $in -t $out -i $SRC/$src.mp4" ;;
    t) out=$(calc "$dur / 1.25"); vf='setpts=PTS/1.25,framerate=fps=30'; asrc="-ss 60 -t $out -i $SRC/ep44.mp4" ;;
  esac
  frames=$(awk "BEGIN { printf \"%d\", $out * 30 + 0.5 }")
  N=$((N + 1)); file=$WORK/seg$(printf %02d $N).mp4
  (cd $WORK && ffmpeg -loglevel error -y -ss $in -t $dur -i ../../$SRC/$src.mp4 $(echo "$asrc" | sed "s# $SRC/# ../../$SRC/#") \
    -filter_complex "[0:v]$vf,$TAIL$extra[v];[1:a]$AUD,apad,atrim=0:$out,afade=t=in:d=0.04,afade=t=out:st=$(calc "$out - 0.04"):d=0.04[a]" \
    -map '[v]' -map '[a]' -frames:v $frames $ENC $(basename $file))
  echo "file '$(basename $file)'" >> $WORK/list.txt
  printf '%-7s %6.2f -> %6.2f  (%s)\n' $src $T $(calc "$T + $out") $mode
  T=$(calc "$T + $out")
}
FADE_IN="fade=t=in:d=0.8"
TITLE="drawtext=fontfile=pala.ttf:textfile=title.txt:fontsize=84:fontcolor=0xfff3dc:x=(w-tw)/2:y=h*0.42:shadowy=2:shadowcolor=black@0.55:alpha='clip(min((t-0.8)/0.8,(5.4-t)/0.8),0,1)',drawtext=fontfile=palai.ttf:textfile=sub.txt:fontsize=40:fontcolor=0xfff3dc:x=(w-tw)/2:y=h*0.42+120:shadowy=2:shadowcolor=black@0.55:alpha='clip(min((t-1.4)/0.8,(5.4-t)/0.8),0,1)'"
seg ep43 0.0 6.0 n "$FADE_IN,$TITLE"
seg ep43 9.6 5.0 n
seg ep43 39.2 5.0 n
seg ep44 1.0 5.0 n
seg ep44 17.0 5.0 n
seg ep44 29.0 5.0 n
seg ep45 0.5 4.0 n
seg ep45 12.0 5.5 n
seg ep45 34.0 1.75 s4
seg ep45 42.5 3.0 n
seg ep46 0.5 5.0 n
seg ep46 11.0 1.25 s4
seg ep46 40.5 4.0 n
seg ep48 6.0 9.0 n
seg ep55 2.0 9.0 n
seg ep56v1 10.0 18.5 t "fade=t=out:st=13.8:d=1"

# End card: credits on dark walnut, in silence.
N=$((N + 1))
(cd $WORK && ffmpeg -loglevel error -y -f lavfi -i color=c=0x140c08:s=1920x1080:r=30:d=5 -f lavfi -i anullsrc=r=48000:cl=stereo -t 5 \
  -vf "drawtext=fontfile=pala.ttf:textfile=end1.txt:fontsize=40:fontcolor=0xfff3dc:x=(w-tw)/2:y=h*0.42,drawtext=fontfile=palai.ttf:textfile=end2.txt:fontsize=32:fontcolor=0xd9c9a8:x=(w-tw)/2:y=h*0.42+70,drawtext=fontfile=palai.ttf:textfile=end3.txt:fontsize=32:fontcolor=0xd9c9a8:x=(w-tw)/2:y=h*0.42+120,fade=t=in:d=0.6,fade=t=out:st=4.2:d=0.8,format=yuv420p" \
  $ENC seg$(printf %02d $N).mp4)
echo "file 'seg$(printf %02d $N).mp4'" >> $WORK/list.txt
printf 'end     %6.2f -> %6.2f\n' $T $(calc "$T + 5")

# One film, loudness to -16 LUFS (two passes), then the files people get.
(cd $WORK && ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt -c copy joined.mp4)
stats=$(ffmpeg -hide_banner -nostats -i $WORK/joined.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
NORM="loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=48000"
ffmpeg -loglevel error -y -i $WORK/joined.mp4 -af "$NORM" -c:v libx264 -preset slow -crf 14 -profile:v high -pix_fmt yuv420p -g 60 -c:a aac -b:a 320k -movflags +faststart $OUT/kilauea-2026-mezzanine.mp4
ffmpeg -loglevel error -y -i $OUT/kilauea-2026-mezzanine.mp4 -c:v libx264 -preset slow -crf 23 -maxrate 6M -bufsize 12M -profile:v high -pix_fmt yuv420p -g 60 -c:a aac -b:a 160k -movflags +faststart $WEB/kilauea-2026.mp4
ffmpeg -loglevel error -y -ss 33 -i $OUT/kilauea-2026-mezzanine.mp4 -frames:v 1 -q:v 3 $WEB/kilauea-2026-poster.jpg
# Storyboard for the loupe when the film is not on Mux: 284x160 tiles every 2 s, ten to a row (Mux's own layout).
ffmpeg -loglevel error -y -i $OUT/kilauea-2026-mezzanine.mp4 -vf "fps=1/2,scale=284:160,tile=10x6" -frames:v 1 -q:v 4 $WEB/kilauea-2026-storyboard.jpg
awk -v d="$(calc "$T + 5")" 'function ts(t) { return sprintf("%02d:%02d:%06.3f", int(t / 3600), int(t / 60) % 60, t - int(t / 60) * 60) }
BEGIN { print "WEBVTT"; for (i = 0; i * 2 < d; i++) { e = (i + 1) * 2 < d ? (i + 1) * 2 : d
  printf "\n%s --> %s\nkilauea-2026-storyboard.jpg#xywh=%d,%d,284,160\n", ts(i * 2), ts(e), (i % 10) * 284, int(i / 10) * 160 } }' > $WEB/kilauea-2026-storyboard.vtt
ls -la $OUT $WEB
