#!/usr/bin/env bash
# Gera ícone e splash do app a partir das cores do tema (sem depender do Omarchy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/android/app/src/main/res"
BG='#121212'
ACCENT='#e68e0d'
FONT='Adwaita-Sans-Bold'

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Ícone base: quadrado escuro com moldura e um "A" laranja.
magick -size 512x512 "xc:$BG" \
  -fill none -stroke "$ACCENT" -strokewidth 18 \
  -draw 'roundrectangle 56,56 456,456 64,64' \
  -stroke none -fill "$ACCENT" -font "$FONT" -pointsize 300 \
  -gravity center -annotate +0-16 'A' \
  "$tmp/icon.png"

# Versão transparente para adaptive launcher (a borda fica no foreground).
magick -size 432x432 xc:none \
  -fill "$ACCENT" -font "$FONT" -pointsize 250 \
  -gravity center -annotate +0-14 'A' \
  "$tmp/foreground.png"

for spec in 'mdpi 48' 'hdpi 72' 'xhdpi 96' 'xxhdpi 144' 'xxxhdpi 192'; do
  set -- $spec
  dir="$RES/mipmap-$1"; size="$2"
  mkdir -p "$dir"
  magick "$tmp/icon.png" -resize "${size}x${size}" "$dir/ic_launcher.png"
  half=$(( size / 2 ))
  magick \( "$tmp/icon.png" -resize "${size}x${size}" \) \
    \( -size "${size}x${size}" xc:none -fill white \
       -draw "circle ${half},${half} ${half},0" \) \
    -alpha off -compose CopyOpacity -composite "$dir/ic_launcher_round.png"
done

for spec in 'mdpi 108' 'hdpi 162' 'xhdpi 216' 'xxhdpi 324' 'xxxhdpi 432'; do
  set -- $spec
  mkdir -p "$RES/mipmap-$1"
  magick "$tmp/foreground.png" -resize "$2x$2" "$RES/mipmap-$1/ic_launcher_foreground.png"
done

make_splash() {
  local out="$1" w="$2" h="$3"
  local mark=$(( w < h ? w : h ))
  local logo=$(( mark / 5 ))
  magick -size "${w}x${h}" "xc:$BG" \
    \( "$tmp/icon.png" -resize "${logo}x${logo}" \) \
    -gravity center -composite \
    -fill '#bebebe' -font "$FONT" -pointsize "$(( mark / 16 ))" \
    -gravity center -annotate +0+$(( logo / 2 + mark / 12 )) 'Anki Inglês' \
    "$out"
}

for res in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  case "$res" in
    mdpi)    pw=320; ph=480; lw=480; lh=320 ;;
    hdpi)    pw=480; ph=800; lw=800; lh=480 ;;
    xhdpi)   pw=720; ph=1280; lw=1280; lh=720 ;;
    xxhdpi)  pw=960; ph=1600; lw=1600; lh=960 ;;
    xxxhdpi) pw=1280; ph=1920; lw=1920; lh=1280 ;;
  esac
  mkdir -p "$RES/drawable-port-$res" "$RES/drawable-land-$res"
  make_splash "$RES/drawable-port-$res/splash.png" "$pw" "$ph"
  make_splash "$RES/drawable-land-$res/splash.png" "$lw" "$lh"
done
make_splash "$RES/drawable/splash.png" 320 480

echo "Assets gerados em $RES"
