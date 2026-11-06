#!/bin/sh
# 作用：把图片地址的几条候选线路都试一遍，哪个能下载成功就自动切换到哪个。
# 结果写在 extensions/kindle-dash/test.log 里（想给我看就插 USB 打开这个文件）。
DIR=/mnt/us/extensions/kindle-dash
LOG=$DIR/test.log
TMP=/tmp/urltest.png

log() { echo "$(date '+%m-%d %H:%M') $1" >> $LOG; }

URL=$(tr -cd '[:graph:]' < $DIR/url.txt)
log "==== 开始测试 ===="

# 从 url.txt 的地址里取出后半段（用户名/仓库名/分支/文件路径）
P=${URL#*raw.githubusercontent.com/}
if [ "$P" = "$URL" ]; then
  log "url.txt 里的地址不像 GitHub 图片地址，请先按教程填好再测"
  exit 1
fi

# 候选线路，按优先级排列
C1="https://raw.githubusercontent.com/$P"
C2="https://raw.gitmirror.com/$P"
C3="https://ghproxy.net/https://raw.githubusercontent.com/$P"
C4="https://cdn.jsdelivr.net/gh/$(echo $P | sed 's|/main/|@main/|')"
C5="http://raw.githubusercontent.com/$P"

WINNER=""
for C in "$C1" "$C2" "$C3" "$C4" "$C5"; do
  rm -f $TMP
  wget -q --no-check-certificate -T 20 -O $TMP "$C?nocache=$(date +%s)" 2>/dev/null
  SIZE=$(wc -c < $TMP 2>/dev/null | tr -cd '0-9')
  if [ -n "$SIZE" ] && [ "$SIZE" -gt 20000 ]; then
    log "成功 ($SIZE 字节) $C"
    if [ -z "$WINNER" ]; then WINNER=$C; fi
  else
    log "失败 $C"
  fi
done

if [ -n "$WINNER" ]; then
  echo "$WINNER" > $DIR/url.txt.new
  mv $DIR/url.txt.new $DIR/url.txt
  log "已把 url.txt 换成最快的线路，正在启动看板…"
  rm -f $DIR/.pid
  $DIR/bin/start.sh &
  log "==== 测试结束，看板已启动 ===="
else
  log "全部线路都失败：多半是 Kindle 没连上 WiFi，先到 设置→飞行模式 关掉飞行模式并连 WiFi"
  log "==== 测试结束 ===="
fi
