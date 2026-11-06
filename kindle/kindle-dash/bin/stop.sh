#!/bin/sh
DIR=/mnt/us/extensions/kindle-dash
if [ -f $DIR/.pid ]; then
  kill $(cat $DIR/.pid) 2>/dev/null
  rm -f $DIR/.pid
fi
echo "$(date '+%m-%d %H:%M') 已停止" >> $DIR/dash.log
lipc-set-prop com.lab126.powerd preventScreenSaver 0 2>/dev/null
