#!/bin/sh
# Kindle 端：循环下载图片并刷新屏幕
# 位置：/mnt/us/extensions/kindle-dash/bin/start.sh
# 注意：这个文件不要用记事本改，要改地址请改同目录上一层的 url.txt

DIR=/mnt/us/extensions/kindle-dash
LOG=$DIR/dash.log
TMP=/tmp/dashboard.png

# 从 url.txt 读地址，顺手清掉换行符和看不见的字符（记事本存盘会带这些）
URL=$(tr -cd '[:graph:]' < $DIR/url.txt)

INTERVAL=1800   # 刷新间隔，单位秒。1800 = 30 分钟
NIGHT_START=17  # 息屏开始：17:30
NIGHT_END=8     # 息屏结束：08:00

log() { echo "$(date '+%m-%d %H:%M') $1" >> $LOG; }

if [ -z "$URL" ]; then
  log "url.txt 是空的，先填地址"
  exit 1
fi

# 已经在跑就不重复启动
if [ -f $DIR/.pid ] && kill -0 $(cat $DIR/.pid) 2>/dev/null; then
  log "已经在运行了"
  exit 0
fi
echo $$ > $DIR/.pid
log "启动，间隔 ${INTERVAL}s，息屏 ${NIGHT_START}:30–${NIGHT_END}:00，地址 $URL"

# 屏幕常亮由系统自己管；息屏时段会清屏并安静等待，到点自动恢复
while true; do
  H=$(date +%H)
  M=$(date +%M)

  # 夜间 = 17:30 之后 或 08:00 之前
  if [ "$H" -gt "$NIGHT_START" ] || { [ "$H" -eq "$NIGHT_START" ] && [ "$M" -ge 30 ]; } || [ "$H" -lt "$NIGHT_END" ]; then
    # 息屏：清一次屏（墨水屏全白 = 关屏效果），关 WiFi 省电
    eips -c 2>>$LOG
    lipc-set-prop com.lab126.cmd wirelessEnable 0 2>/dev/null
    log "进入息屏时段，安静等待"
    # 每 10 分钟醒来看一次时间，不联网不刷图，到点自动恢复
    sleep 600
    continue
  fi

  lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null

  # 等网络就绪，最多 40 秒
  i=0
  while [ $i -lt 20 ]; do
    if wget -q --spider -T 5 http://www.baidu.com 2>/dev/null; then break; fi
    sleep 2
    i=$((i+1))
  done

  OK=0
  wget -q -T 30 -O $TMP "$URL?t=$(date +%s)" 2>>$LOG && OK=1
  if [ $OK -eq 0 ]; then
    # Kindle 自带的证书库较老，可能不认新证书；再关掉校验试一次（图片地址是公开的，无风险）
    wget -q --no-check-certificate -T 30 -O $TMP "$URL?t=$(date +%s)" 2>>$LOG && OK=1
  fi

  if [ $OK -eq 1 ] && [ -s $TMP ]; then
    eips -g $TMP 2>>$LOG || eips -f -g $TMP 2>>$LOG
    log "刷新成功"
  else
    log "下载失败（网络不通或地址不对，可运行菜单里的『测试图片地址』）"
  fi

  sync
  sleep $INTERVAL
done
