/**
 * Kindle 看板渲染脚本 · 猫的打工小屋版
 * 作用：抓天气 + 读日历 + 读待办 → 拼成一张猫咪看板 HTML → 截成灰度 PNG
 * 用法：node dashboard/render.mjs（加 --html-only 只出 HTML 预览）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ical from 'node-ical';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'dashboard/config.json'), 'utf8'));
// 私密订阅链接（滴答清单等）不写进仓库，放在 GitHub Secrets 里，运行时从这里注入
if (process.env.TODO_ICS_URL) cfg.todoIcsUrl = process.env.TODO_ICS_URL.trim();
if (process.env.CALENDAR_ICS_URL) cfg.calendarIcsUrl = process.env.CALENDAR_ICS_URL.trim();

/* 按配置时区取“现在”。
   GitHub Actions 的服务器是 UTC，直接 new Date().getHours() 会差 8 小时，
   所以统一用 Intl 按 cfg.timezone 换算，本地跑和云端跑结果一致。 */
function nowInTz(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date())) p[type] = value;
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}
const NOW = nowInTz(cfg.timezone);

/* ==========================================================
   0. 素材：原图猫（base64 内联，GitHub Actions 上也能直接跑）
   ========================================================== */
const ASSET_DIR = path.join(ROOT, 'dashboard/assets');
async function asset(name) {
  try {
    const b = await fs.readFile(path.join(ASSET_DIR, name));
    return `data:image/png;base64,${b.toString('base64')}`;
  } catch {
    return '';
  }
}
const PHOTO = { trio: await asset('cat-trio.png'), desk: await asset('cat-desk.png') };

/* 每日一句：工作日吐槽上班，周末说点轻松的。
   两个池子各自按“第几个工作日/第几个周末日”取，同一天刷新不变，跨天自动换。
   工作日池约 140 条（半年不重复），周末池约 48 条（约 10 个月不重复）。 */
const WEEKDAY_QUIPS = [
  '今天也想辞职，但猫粮还没买。',
  '工位是租来的，命是自己的。',
  '打工嘛，主要是为了下班那一刻。',
  '周报写不完，就写“在推进”。',
  '会议的意义，是让所有人一起浪费时间。',
  '需求会变，我的耐心不会。',
  '上班如上坟，下班如重生。',
  '我负责努力，老板负责画饼。',
  '摸鱼，是打工人的呼吸。',
  '今天效率很高——开了六个会。',
  '别问我进度，问就是 90%。',
  '计划赶不上变化，变化赶不上老板一句话。',
  '工资是精神损失费。',
  '我不加班，我只是走得晚。',
  '上午的计划，下午的借口。',
  '这件事明天做，明天的我会更强。',
  '同事很好，就是工作不太好。',
  '每天进步一点点——离下班近一点。',
  '老板说要有光，于是我打开了台灯。',
  '先把简单的事做完，难的事就会自己消失。',
  '我的 KPI 是把今天熬过去。',
  '一天只有两个高光时刻：午饭和下班。',
  '工位上的绿植活得比我久。',
  '会开完了，事还在。',
  '假装很忙，是职场最高级的技能。',
  '不是不想干，是想干点别的。',
  '我把青春献给了周报。',
  '只要能摸鱼，哪里都是海。',
  '周一的意义，是提醒你周末有多好。',
  '键盘敲得响，进度看不见。',
  '老板说“简单改一下”，一般要改三天。',
  '需求评审的结论：下周再评审一次。',
  '我在会上最常说的是“好的没问题”。',
  '目标定得高，是为了年底好总结。',
  '忙起来就不困了，这叫以毒攻毒。',
  '我的桌面很干净，因为活都在脑子里。',
  '今天不加班，明天加两天。',
  '谁都可以催你，除了你自己。',
  '工牌一挂，人就有了 KPI。',
  '别小看打工人，我们撑起了整栋楼。',
  '办公室最好的地方是窗边。',
  '我不是拖延，我是在等灵感。',
  '早会十分钟，回神两小时。',
  '我热爱工作，尤其是下班后回想起它。',
  '打工不伤人，打卡才伤。',
  '工作量守恒：省下的力气都会还回来。',
  '领导的“自愿”，从来都不自愿。',
  '只要不点开邮件，坏消息就不存在。',
  '我把待办清单当许愿池。',
  '会议纪要写得好，不如会议少一点。',
  '空调风口的位置，决定今天的心情。',
  '年底述职，考的其实是记性。',
  '我的劳动合同里没写“耐心”。',
  '加班的夜晚，月亮都替我累。',
  '忙的时候想摸鱼，闲的时候想离职。',
  '工位第三格抽屉里，藏着我的理想。',
  '一天最开始那杯咖啡，是打工人的开机键。',
  '报销流程比项目本身还长。',
  '每次说“最后一次改”，都在撒谎。',
  '我不讨厌工作，我讨厌工作日。',
  '打工人最勇敢的事，是准点起身。',
  '表格填得再漂亮，也填不满钱包。',
  '老板的微笑，通常意味着新的需求。',
  '我的效率取决于 wifi 速度。',
  '别把我的沉默当成同意。',
  '慢慢来，反正也做不完。',
  '他们说跳出舒适区，我舒适区就在工位。',
  '打印机比我先崩溃。',
  '一个人加班，空调都为你调低两度。',
  '我把“收到”说得比“我爱你”还熟练。',
  '论持久战，打工人从来没输过。',
  '今天喝了三杯水，干了两件事。',
  '通知里最可怕的词是“顺便”。',
  '一切正常，除了进度。',
  '我不是不想升职，是不想开会。',
  '我的人生进度条卡在周一。',
  '打卡机是这个世界上最诚实的机器。',
  '忙碌是假的，deadline 是真的。',
  '心情好不好，取决于邮件多不多。',
  '我负责把事情做对，别人负责改需求。',
  '会议室的椅子，是打工人的床。',
  '每个“紧急”背后，都有一个拖延的甲方。',
  '咖啡续的是命，不是精神。',
  '我的工位望向远方，远方就是下班。',
  '别慌，慌也做不完。',
  '今天的目标：不惹事，少接活。',
  '工资涨得慢，需求涨得快。',
  '我不是效率低，我是信息太多。',
  '一看表十点，一抬头三点。',
  '每次想认真工作，就来一条群消息。',
  '加班到深夜，才发现家里的灯是暖的。',
  '上班第一件事，是把昨天的事重做一遍。',
  '我的周报里没有“完成”，只有“推进”。',
  '同事之间最好的默契：一起叹气。',
  '计划写三页，执行靠当天。',
  '打工人的日常：等审批、等回复、等下班。',
  '别问我有什么打算，我打算下班。',
  '一直在赶路，从来没到过终点。',
  '我擅长的事是把简单的事说复杂。',
  '领导的“参考一下”，等于重做。',
  '一个人吃午饭，是打工人最自由的半小时。',
  '需求越改越顺，前提是别提意见。',
  '我的身体在工位，灵魂在假期。',
  '今天的自己，配得上明天的工资。',
  '别说我摸鱼，我在等思路。',
  '收拾桌面，是我最后的掌控感。',
  '会前十分钟，是最紧张的时刻。',
  '早高峰的地铁，是打工人的预演。',
  '每次点开日历，都有点想哭。',
  '我不是不会拒绝，是拒绝不出口。',
  '任务清单越写越长，人生越过越短。',
  '把工作做完的秘诀：先把它放一放。',
  '工位上最忙的是我的鼠标。',
  '我不想当卷王，我只想准点走。',
  '只要能坐着，哪里都是工位。',
  '别催进度，猫也在等下班。',
  '今天干得不错——没出错。',
  '我记不住事，所以写满便签。',
  '打工人的信仰：周五会来。',
  '领导说“年轻就要拼”，我说“我要睡觉”。',
  '每次开会，都有人带回一个新的任务。',
  '我的工牌挂在胸前，灵魂挂在假期上。',
  '走神也是一种休息，别打断我。',
  '一天总有两个时刻想辞职：上午和下午。',
  '做不完的活，看不完的群。',
  '工资是发给我忍受这些的钱。',
  '心里有片海，脚下有打卡机。',
  '别把加班当本事，那是没办法。',
  '我把所有耐心都给了文档。',
  '今天不出错，就是胜利。',
  '键盘是有记忆的，它记得我的抱怨。',
  '每次说“马上”，都是在给拖延找台阶。',
  '打工人三大幻觉：快下班了、快涨薪了、快结束了。',
  '别问我忙不忙，问就是挺忙。',
];

const WEEKEND_QUIPS = [
  '周末不设闹钟，是对自己最大的温柔。',
  '今天的日程：吃饭、睡觉、晒太阳。',
  '猫起得比我早，但它不催我。',
  '阳光刚好，什么都不用做。',
  '周末的意义：把时间还给自己。',
  '今天只想当一个有电量的猫。',
  '不赶时间的早晨，才是真正的假期。',
  '出门走走，捡点风。',
  '洗了衣服，晒了被子，也算成就。',
  '生活的进度条，今天由猫决定。',
  '一杯咖啡，一段空白，刚刚好。',
  '周末的任务清单只有一条：休息。',
  '慢一点没关系，反正今天不上班。',
  '窗外有风，屋里有猫，够了。',
  '今天不卷，今天躺。',
  '把手机放下，抬头看看天。',
  '做饭的日子，是踏实的一天。',
  '出门买个菜，也算旅行。',
  '什么都不做，也是一种完成。',
  '猫在睡觉，我在发呆，很配。',
  '今天的光线适合什么都不干。',
  '假期余额不多，但足够幸福。',
  '逛超市能治好一半的坏心情。',
  '睡到自然醒，是打工人的顶级奢侈。',
  '今天出门看树，不看屏幕。',
  '洗个热水澡，人生重启。',
  '周末的雨声，最适合发呆。',
  '不必高效，今天允许自己低功率。',
  '陪自己吃顿饭，很值得。',
  '猫粮买好了，心就安了。',
  '今天的目标：走够五千步。',
  '安静地待着，也是享受。',
  '把屋子收拾干净，心情跟着亮。',
  '心里有事就写下来，写完就轻了。',
  '周末适合慢慢做一顿饭。',
  '出门晒十分钟太阳，效率最高的休息。',
  '不开心就去阳台，风会带走一点。',
  '阳光、热茶、一只猫，三件套齐了。',
  '今天不做计划，走到哪算哪。',
  '休息不是偷懒，是充电。',
  '傍晚散个步，是给自己的礼物。',
  '少想一点，日子就轻一点。',
  '今天要做的事：把没睡够的觉补上。',
  '周末的时钟走得比上班慢，真好。',
  '什么都别做，让日子自己过去。',
  '明天又要上班了，但今天还早。',
  '假期的快乐，在于不用回消息。',
  '窗帘拉开，就是今天最大的工程。',
];

const QUIP_EPOCH = new Date(2026, 0, 1);
function dailyQuip(now) {
  const target = new Date(now);
  target.setHours(0, 0, 0, 0);
  const isWeekend = target.getDay() === 0 || target.getDay() === 6;
  // 统计从基准日起已经过了多少个工作日 / 多少个周末日，保证池子按顺序走完不提前重复
  let weekdays = 0;
  let weekendDays = 0;
  const cursor = new Date(QUIP_EPOCH);
  while (cursor < target) {
    const w = cursor.getDay();
    if (w === 0 || w === 6) weekendDays++;
    else weekdays++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return isWeekend
    ? WEEKEND_QUIPS[weekendDays % WEEKEND_QUIPS.length]
    : WEEKDAY_QUIPS[weekdays % WEEKDAY_QUIPS.length];
}

/* ==========================================================
   1. 天气（Open-Meteo，免费、不用注册、不用 API Key）
   ========================================================== */
const WMO = {
  0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '阵雨', 82: '强阵雨',
  85: '阵雪', 86: '阵雪',
  95: '雷阵雨', 96: '雷阵雨', 99: '雷暴',
};

async function getWeather() {
  const cacheFile = path.join(ROOT, 'dashboard/weather-cache.json');
  const ttl = (cfg.weatherTtlHours ?? 4) * 3600 * 1000;
  const geo = `${cfg.latitude},${cfg.longitude}`;   // 缓存指纹：换城市就不复用旧数据
  let cached = null;
  try {
    cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (!cached || cached.geo !== geo) cached = null;
    if (cached && cached.data && Date.now() - cached.at < ttl) {
      console.log(`天气：用缓存（${Math.round((Date.now() - cached.at) / 60000)} 分钟前抓的）`);
      return cached.data;
    }
  } catch { /* 没缓存就抓新的 */ }

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${cfg.latitude}&longitude=${cfg.longitude}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + `&timezone=${encodeURIComponent(cfg.timezone)}&forecast_days=4`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`天气接口返回 ${r.status}`);
    const d = await r.json();
    const data = {
      now: Math.round(d.current.temperature_2m),
      feels: Math.round(d.current.apparent_temperature),
      humidity: d.current.relative_humidity_2m,
      code: d.current.weather_code,
      text: WMO[d.current.weather_code] || '—',
      days: d.daily.time.map((t, i) => ({
        date: t,
        code: d.daily.weather_code[i],
        text: WMO[d.daily.weather_code[i]] || '—',
        min: Math.round(d.daily.temperature_2m_min[i]),
        max: Math.round(d.daily.temperature_2m_max[i]),
        rain: d.daily.precipitation_probability_max[i] ?? 0,
      })),
    };
    await fs.writeFile(cacheFile, JSON.stringify({ at: Date.now(), geo, data }), 'utf8');
    return data;
  } catch (err) {
    // 抓不到就用旧缓存，总比看板空着强
    if (cached && cached.data) {
      console.log(`天气接口失败（${err.message}），用旧缓存`);
      return cached.data;
    }
    throw err;
  }
}

/* ==========================================================
   2. 日历（读一个 ICS 订阅链接）
   ========================================================== */
const fmtDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const fmtTime = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

async function getCalendar() {
  const empty = { today: [], tomorrow: [] };
  if (!cfg.calendarIcsUrl) return empty;
  try {
    const ev = await ical.async.fromURL(cfg.calendarIcsUrl);
    const now = NOW;
    const tmr = new Date(now.getTime() + 86400000);
    const today = [];
    const tomorrow = [];
    for (const k in ev) {
      const e = ev[k];
      if (e.type !== 'VEVENT' || !e.start) continue;
      const start = new Date(e.start);
      const end = e.end ? new Date(e.end) : new Date(start.getTime() + 1800000);
      if (end < now) continue;
      const allDay = !!e.datetype && e.datetype === 'date';
      const item = {
        time: allDay ? '全天' : fmtTime(start),
        title: String(e.summary || '（无标题）').slice(0, 24),
        allDay,
      };
      if (sameDay(start, now) || (allDay && sameDay(end, now))) today.push(item);
      else if (sameDay(start, tmr)) tomorrow.push(item);
    }
    const sortFn = (a, b) => (a.allDay === b.allDay ? a.time.localeCompare(b.time) : a.allDay ? -1 : 1);
    return { today: today.sort(sortFn).slice(0, 4), tomorrow: tomorrow.sort(sortFn).slice(0, 3) };
  } catch (err) {
    console.error('日历读取失败（不影响出图）：', err.message);
    return empty;
  }
}

/* ==========================================================
   3. 待办（两种来源：滴答清单等 ICS 订阅 / 本地 todo.txt）
   ========================================================== */
const shortDate = (d) => `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d = NOW) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

async function getTodos() {
  const today = startOfDay();
  const weekEnd = new Date(today.getTime() + 7 * 86400000);

  if (cfg.todoIcsUrl) {
    try {
      const src = cfg.todoIcsUrl;
      const ev = /^https?:/i.test(src)
        ? await ical.async.fromURL(src)
        : await ical.async.parseFile(path.isAbsolute(src) ? src : path.join(ROOT, src));
      const overdue = [], dueToday = [], week = [];
      let total = 0, done = 0;
      for (const k in ev) {
        const e = ev[k];
        if (e.type !== 'VEVENT' && e.type !== 'VTODO') continue;
        const raw = new Date(e.start || e.due || e.created);
        if (isNaN(raw.getTime())) continue;
        // 滴答清单在清单为空时会塞一条占位：SUMMARY:No task. —— 跳过它
        if (/^no task\.?$/i.test(String(e.summary || '').trim())) continue;
        const finished = String(e.status || '').toUpperCase() === 'COMPLETED'
          || /^[✓√]/.test(String(e.summary || ''));
        // 已完成的任务：只把"今天完成"的算进猫粮罐（订阅里会带最近3个月的已完成，
        // 不筛日期的话，上周的完成量会把罐子撑满，失去"今日完成率"的意义）
        if (finished) {
          const finRaw = new Date(e.completed || e.due || e.start);
          if (!isNaN(finRaw.getTime()) && startOfDay(finRaw).getTime() === today.getTime()) done++;
          continue;
        }
        const due = startOfDay(raw);
        const item = { title: String(e.summary || '（无标题）').slice(0, 30), due, short: shortDate(due) };
        total++;
        if (due < today) overdue.push(item);
        else if (due.getTime() === today.getTime()) dueToday.push(item);
        else if (due < weekEnd) week.push(item);
      }
      const byDate = (a, b) => a.due - b.due;
      return { overdue: overdue.sort(byDate), today: dueToday.sort(byDate), week: week.sort(byDate), total, done, source: 'ics' };
    } catch (err) {
      console.error('待办订阅读取失败（回退到 todo.txt）：', err.message);
    }
  }

  try {
    const raw = await fs.readFile(path.join(ROOT, cfg.todoFile || 'dashboard/todo.txt'), 'utf8');
    const items = raw.split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
      .map((s) => s.replace(/^[-*]\s*/, ''))
      .map((t) => ({ title: t.slice(0, 30), due: today, short: '' }));
    return { overdue: [], today: items, week: [], total: items.length, done: 0, source: 'txt' };
  } catch {
    return { overdue: [], today: [], week: [], total: 0, done: 0, source: 'txt' };
  }
}

/* ==========================================================
   4a. 猫咪场景（纯灰度 SVG，墨水屏友好）
   ========================================================== */
function catState(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 6) return { key: 'sleep', label: '呼呼大睡', bubble: ['Zzz……', '猫睡了，你也早点睡。'], pose: 'sleep' };
  if (h < 9) return { key: 'commute', label: '上班路上', bubble: ['马上到工位！', '今天也请多关照喵。'], pose: 'commute' };
  if (h < 12) return { key: 'work', label: '打工中', bubble: ['打工中，勿扰喵。', '（尾巴已经打结了）'], pose: 'work' };
  if (h < 14) return { key: 'lunch', label: '干饭中', bubble: ['干饭时间！', '天大的事吃完再说。'], pose: 'lunch' };
  if (h < 15) return { key: 'work', label: '打工中', bubble: ['下午第一场仗，', '咖啡已经续上了。'], pose: 'work' };
  if (h < 16) return { key: 'yawn', label: '犯困中', bubble: ['三点钟了……', '猫也扛不住这个点喵。'], pose: 'yawn' };
  if (h < 18) return { key: 'work', label: '收尾中', bubble: ['再撑一会儿，', '下班就在眼前了。'], pose: 'work' };
  if (h < 23) return { key: 'off', label: '下班啦', bubble: ['下班！', '猫生值得，明天见。'], pose: 'off' };
  return { key: 'sleep', label: '呼呼大睡', bubble: ['Zzz……', '猫睡了，你也早点睡。'], pose: 'sleep' };
}

/* 窗外天色：随一天的时刻变化（清晨 / 白天 / 黄昏 / 夜晚） */
function skyPhase(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5.5) return { key: 'night', sky: '#4a4a4a', far: '#2b2b2b', near: '#232323', lights: true, moon: true, stars: true, sun: -1, cloud: false };
  if (h < 7.5) return { key: 'dawn', sky: '#e8e8e8', far: '#cfcfcf', near: '#bcbcbc', lights: false, moon: false, stars: false, sun: 0.12, cloud: true };
  if (h < 17) return { key: 'day', sky: '#f7f7f7', far: '#d9d9d9', near: '#bfbfbf', lights: false, moon: false, stars: false, sun: 0.85, cloud: true };
  if (h < 19) return { key: 'dusk', sky: '#c9c9c9', far: '#a6a6a6', near: '#8e8e8e', lights: true, moon: false, stars: false, sun: 0.2, cloud: false };
  return { key: 'night', sky: '#4a4a4a', far: '#2b2b2b', near: '#232323', lights: true, moon: true, stars: true, sun: -1, cloud: false };
}

/* 天气码（WMO）→ 窗外表现分组 */
function weatherGroup(code) {
  if (code === null || code === undefined) return 'partly';
  const c = Number(code);
  if (!Number.isFinite(c)) return 'partly';
  if (c === 0) return 'clear';
  if (c === 1 || c === 2) return 'partly';
  if (c === 3) return 'overcast';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 51 && c <= 57) return 'drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'overcast';
}

/* 颜色混合：把 hex 往 target 方向靠 t（0~1） */
function hexMix(hex, target, t) {
  const parse = (h) => parseInt(h.slice(1), 16);
  const a = parse(hex), b = parse(target);
  const ch = (sh) => {
    const v = (((a >> sh) & 255) * (1 - t)) + (((b >> sh) & 255) * t);
    return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function windowScene(sky, wxCode) {
  const g = weatherGroup(wxCode);
  const night = sky.key === 'night';
  const cloudy = g === 'overcast' || g === 'rain' || g === 'drizzle' || g === 'storm' || g === 'snow';
  // 天色：阴雨天压暗，雾天发白
  const wash = { clear: 0, partly: 0.1, overcast: 0.34, fog: 0.42, drizzle: 0.26, rain: 0.42, snow: 0.16, storm: 0.52 }[g];
  const base = g === 'fog'
    ? hexMix(sky.sky, night ? '#6a6a6a' : '#ffffff', 0.5)
    : hexMix(sky.sky, night ? '#141414' : '#8a8a8a', wash);
  // 楼群跟着天色走，雾天几乎化进天里
  const fade = g === 'fog' ? 0.7 : wash * 0.55;
  const farFill = hexMix(sky.far, base, fade);
  const nearFill = hexMix(sky.near, base, fade);

  const STARS = [[598, 54, 2.4], [622, 96, 1.8], [648, 46, 2], [672, 118, 1.6], [700, 62, 2.6],
    [736, 104, 1.8], [764, 50, 2.2], [792, 92, 1.6], [820, 58, 2.4], [848, 112, 1.8],
    [872, 48, 2], [578, 132, 1.6], [714, 138, 1.6], [880, 138, 1.6]];
  // 只有晴天夜里才看得见星星
  const stars = sky.stars && g === 'clear'
    ? STARS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="0.9"/>`).join('')
    : '';
  // 月亮：阴雨天被云挡住
  const moon = sky.moon && (g === 'clear' || g === 'partly')
    ? `<circle cx="618" cy="70" r="21" fill="#ffffff"/>
       <circle cx="612" cy="64" r="5" fill="#c9c9c9"/><circle cx="625" cy="78" r="3.4" fill="#c9c9c9"/>`
    : '';
  const sunY = sky.sun < 0 ? 0 : 40 + (1 - sky.sun) * 130;
  // 太阳：只有晴/多云才露脸，阴雨天完全藏起来
  const sun = sky.sun < 0 || !(g === 'clear' || g === 'partly')
    ? ''
    : `<circle cx="${sky.key === 'dusk' ? 838 : 600}" cy="${sunY}" r="19" fill="#ffffff" stroke="#8f8f8f" stroke-width="2.5"
         opacity="${sky.key === 'day' ? 0.55 : 1}"/>`;

  const cf = night ? '#5c5c5c' : '#ffffff';
  const cs = night ? '#8c8c8c' : '#c2c2c2';
  // 云：晴=无，多云=两朵，阴/雨/雷=厚云压顶，雪=柔云
  let cloud = '';
  if (g === 'partly') {
    cloud = `<g fill="${cf}" stroke="${cs}" stroke-width="2">
         <ellipse cx="700" cy="104" rx="36" ry="13"/><ellipse cx="740" cy="94" rx="26" ry="10"/>
         <ellipse cx="838" cy="132" rx="28" ry="10"/>
       </g>`;
  } else if (cloudy) {
    const big = g === 'storm' || g === 'rain' || g === 'overcast';
    cloud = `<g fill="${cf}" stroke="${cs}" stroke-width="2">
         <ellipse cx="640" cy="72" rx="${big ? 62 : 48}" ry="${big ? 24 : 18}"/>
         <ellipse cx="712" cy="58" rx="${big ? 58 : 44}" ry="${big ? 26 : 20}"/>
         <ellipse cx="790" cy="76" rx="${big ? 66 : 50}" ry="${big ? 24 : 18}"/>
         <ellipse cx="852" cy="60" rx="${big ? 44 : 34}" ry="${big ? 20 : 16}"/>
         <ellipse cx="676" cy="98" rx="${big ? 50 : 40}" ry="${big ? 20 : 15}"/>
         <ellipse cx="826" cy="102" rx="${big ? 52 : 40}" ry="${big ? 18 : 14}"/>
       </g>`;
  }

  // 雨丝
  const rainN = g === 'drizzle' ? 16 : g === 'rain' ? 30 : g === 'storm' ? 38 : 0;
  const rain = rainN
    ? Array.from({ length: rainN }, (_, i) => {
      const x = 566 + ((i * 43) % 306);
      const y = 28 + ((i * 61) % 198);
      return `<line x1="${x}" y1="${y}" x2="${x - 7}" y2="${y + 17}"
        stroke="${night ? '#a8a8a8' : '#7d7d7d'}" stroke-width="${g === 'drizzle' ? 1.6 : 2.2}"
        opacity="0.85" stroke-linecap="round"/>`;
    }).join('')
    : '';
  // 雪
  const snow = g === 'snow'
    ? Array.from({ length: 26 }, (_, i) => {
      const x = 570 + ((i * 47) % 300);
      const y = 32 + ((i * 29) % 202);
      return `<circle cx="${x}" cy="${y}" r="${1.5 + (i % 3) * 0.6}" fill="${night ? '#dddddd' : '#ffffff'}"
        stroke="${night ? '#8a8a8a' : '#c4c4c4'}" stroke-width="0.9"/>`;
    }).join('')
    : '';
  // 雷：一道闪电
  const bolt = g === 'storm'
    ? `<path d="M722 40 l-28 78 l23 -5 l-16 62 l44 -80 l-23 5 l20 -60 z"
         fill="#ffffff" stroke="#111111" stroke-width="1.6" stroke-linejoin="round"/>`
    : '';
  // 雾：几条横着的雾带压在楼群上
  const haze = g === 'fog'
    ? `<g fill="${night ? '#6a6a6a' : '#ffffff'}" opacity="0.6">
        <rect x="560" y="150" width="330" height="26"/>
        <rect x="560" y="198" width="330" height="20"/>
        <rect x="560" y="234" width="330" height="14"/>
      </g>`
    : '';

  // 楼群：夜里是深色剪影，楼里亮着白色窗格
  const far = `<g fill="${farFill}">
      <rect x="578" y="196" width="34" height="70"/><rect x="618" y="176" width="26" height="90"/>
      <rect x="650" y="206" width="40" height="60"/><rect x="742" y="186" width="30" height="80"/>
      <rect x="778" y="200" width="44" height="66"/><rect x="828" y="170" width="24" height="96"/>
      <rect x="856" y="204" width="26" height="62"/>
    </g>`;
  const near = `<g fill="${nearFill}">
      <rect x="588" y="216" width="14" height="50"/><rect x="658" y="220" width="20" height="46"/>
      <rect x="786" y="214" width="24" height="52"/><rect x="832" y="184" width="12" height="82"/>
    </g>`;
  const lit = sky.lights
    ? `<g fill="#ffffff" opacity="0.92">
        <rect x="622" y="188" width="6" height="8"/><rect x="634" y="202" width="6" height="8"/>
        <rect x="622" y="222" width="6" height="8"/><rect x="748" y="198" width="6" height="8"/>
        <rect x="760" y="216" width="6" height="8"/><rect x="786" y="230" width="6" height="8"/>
        <rect x="834" y="196" width="5" height="8"/><rect x="834" y="220" width="5" height="8"/>
        <rect x="860" y="216" width="5" height="8"/><rect x="594" y="228" width="4" height="7"/>
      </g>`
    : '';
  return { ...sky, wx: g, skyColor: base, stars, moon, sun, cloud, far, near, lit, haze, rain, snow, bolt };
}

/* 原图三只猫的裁剪框（canvas 实测：猫 y 0–130，标签从 135 起，箭头在 349–365 和 556–637） */
const TRIO_FRAME = {
  work: { x: 36, y: 0, w: 276, h: 130 },
  lunch: { x: 362, y: 0, w: 198, h: 130 },
  commute: { x: 634, y: 0, w: 260, h: 130 },
};
const TRIO_BASE_W = 276;   // 缩放基准：三只猫保持同一比例

function photoCat(pose, cx, baseY, w) {
  if (!PHOTO.trio) return '';
  const f = TRIO_FRAME[pose] || TRIO_FRAME.work;
  const s = w / TRIO_BASE_W;
  const pw = f.w * s;
  const h = f.h * s;
  const x = cx - pw / 2;
  const y = baseY - h;
  return `<foreignObject x="${x}" y="${y}" width="${pw}" height="${h}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${pw}px;height:${h}px;
        background-image:url('${PHOTO.trio}');
        background-size:${922 * s}px ${318 * s}px;
        background-position:${-f.x * s}px ${-f.y * s}px;
        background-repeat:no-repeat;
        filter:grayscale(1) brightness(1.08) contrast(1.05);"></div>
    </foreignObject>`;
}

/* 大场景（原图：趴在桌上那只）——下班 / 睡觉时整幅显示 */
function bigSceneSvg(state, jar, now) {
  if (!PHOTO.desk) return catSceneSvg(state, jar, now, true);
  const W = 944, H = 560;
  const cropTop = 96;                 // 切掉原图顶部那几行标题字
  const cropH = 434 - cropTop;
  const s = (H - 52) / cropH;         // 底部留 52px 给统计行
  const iw = 458 * s;
  const ih = 434 * s;
  const ix = (W - iw) / 2;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
    <image x="${ix}" y="${-cropTop * s}" width="${iw}" height="${ih}" href="${PHOTO.desk}"/>
    ${
      state.pose === 'sleep'
        ? `<g fill="#666" font-family="Arial, sans-serif" font-weight="bold">
             <text x="628" y="150" font-size="28" opacity="0.45">Z</text>
             <text x="660" y="120" font-size="36" opacity="0.7">z</text>
             <text x="694" y="86" font-size="46" opacity="1">Z</text>
           </g>`
        : ''
    }
    <text x="${W / 2}" y="${H - 18}" text-anchor="middle" font-size="23" fill="#666"
      font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">今日完成 ${jar.empty ? '—' : `${jar.done} / ${jar.total}`}　·　猫粮罐 ${Math.round(jar.pct * 100)}%</text>
  </svg>`;
}

/* 桌面的杂物：书堆、散文件、笔筒、笔、便签、抽屉、线缆
   全部摆在 y=430 这条桌沿上，靠左（时钟下）和靠右（猫粮罐前）两块空地 */
function deskClutter() {
  return `
    <!-- 左边：一摞书（歪着的）+ 夹在书里的纸 + 一支笔 -->
    <g transform="rotate(-1.6 84 420)">
      <rect x="12" y="411" width="142" height="18" rx="2" fill="#ffffff" stroke="#111" stroke-width="3"/>
      <rect x="12" y="411" width="12" height="18" fill="#c9c9c9" stroke="#111" stroke-width="3"/>
      <line x1="30" y1="415" x2="148" y2="415" stroke="#e6e6e6" stroke-width="2"/>
    </g>
    <g transform="rotate(1.8 84 402)">
      <rect x="20" y="394" width="126" height="16" rx="2" fill="#f4f4f4" stroke="#111" stroke-width="3"/>
      <rect x="20" y="394" width="11" height="16" fill="#dedede" stroke="#111" stroke-width="3"/>
    </g>
    <g transform="rotate(-3.2 78 386)">
      <rect x="14" y="379" width="122" height="14" rx="2" fill="#ffffff" stroke="#111" stroke-width="3"/>
      <rect x="14" y="379" width="10" height="14" fill="#b8b8b8" stroke="#111" stroke-width="3"/>
    </g>
    <!-- 从书堆里探出的一张纸 -->
    <g transform="rotate(7 108 382)">
      <rect x="62" y="376" width="92" height="11" fill="#ffffff" stroke="#8a8a8a" stroke-width="2"/>
      <line x1="70" y1="380" x2="132" y2="380" stroke="#d5d5d5" stroke-width="1.6"/>
    </g>
    <!-- 笔躺在书堆前的桌面上 -->
    <g stroke="#111" stroke-width="3.2" fill="none" stroke-linecap="round">
      <line x1="24" y1="424" x2="124" y2="418"/>
      <line x1="38" y1="421" x2="50" y2="420.5"/>
    </g>
    <path d="M124 418 l14 -3 l-13 9 z" fill="#111"/>

    <!-- 右边：笔筒（在文件后面） -->
    <g>
      <path d="M620 374 h46 l-5 56 h-36 z" fill="#ffffff" stroke="#111" stroke-width="3.5"/>
      <path d="M620 374 h46" stroke="#111" stroke-width="3.5"/>
      <g stroke="#111" stroke-width="3" stroke-linecap="round">
        <line x1="630" y1="374" x2="622" y2="332"/>
        <line x1="643" y1="374" x2="646" y2="326"/>
        <line x1="655" y1="374" x2="666" y2="340"/>
      </g>
      <circle cx="646" cy="323" r="4" fill="#fff" stroke="#111" stroke-width="2.5"/>
      <path d="M666 340 l7 -5" stroke="#111" stroke-width="3"/>
      <line x1="624" y1="392" x2="662" y2="392" stroke="#e0e0e0" stroke-width="2"/>
      <line x1="623" y1="406" x2="661" y2="406" stroke="#e0e0e0" stroke-width="2"/>
    </g>

    <!-- 右边：散落的文件（几张叠着、角度都不一样） -->
    <g transform="rotate(-9 520 406)">
      <rect x="470" y="386" width="112" height="42" fill="#ffffff" stroke="#111" stroke-width="2.5"/>
    </g>
    <g transform="rotate(4 546 402)">
      <rect x="494" y="380" width="114" height="48" fill="#fafafa" stroke="#111" stroke-width="2.5"/>
      <line x1="504" y1="392" x2="592" y2="392" stroke="#cfcfcf" stroke-width="2"/>
      <line x1="504" y1="403" x2="580" y2="403" stroke="#cfcfcf" stroke-width="2"/>
    </g>
    <g transform="rotate(-3 566 400)">
      <rect x="512" y="372" width="112" height="56" fill="#ffffff" stroke="#111" stroke-width="2.5"/>
      <line x1="522" y1="386" x2="610" y2="386" stroke="#bdbdbd" stroke-width="2"/>
      <line x1="522" y1="397" x2="596" y2="397" stroke="#bdbdbd" stroke-width="2"/>
      <line x1="522" y1="408" x2="604" y2="408" stroke="#bdbdbd" stroke-width="2"/>
      <line x1="522" y1="419" x2="572" y2="419" stroke="#bdbdbd" stroke-width="2"/>
    </g>
    <g transform="rotate(8 596 412)">
      <rect x="566" y="398" width="86" height="32" fill="#ffffff" stroke="#111" stroke-width="2.5"/>
      <line x1="574" y1="408" x2="640" y2="408" stroke="#d0d0d0" stroke-width="2"/>
      <line x1="574" y1="418" x2="626" y2="418" stroke="#d0d0d0" stroke-width="2"/>
    </g>
    <!-- 文件堆上压着一支笔 -->
    <g stroke="#111" stroke-width="3.4" fill="none" stroke-linecap="round">
      <line x1="586" y1="438" x2="654" y2="418"/>
    </g>
    <path d="M654 418 l13 4 l-13 4 z" fill="#111"/>
    <!-- 揉皱的纸团 -->
    <path d="M486 424 q-4 -12 8 -14 q10 -6 16 2 q10 2 6 12 q-2 10 -12 9 q-12 2 -18 -9 z"
          fill="#f2f2f2" stroke="#111" stroke-width="2.5"/>
    <path d="M490 414 q8 4 6 12 M498 410 q4 8 2 16" stroke="#c4c4c4" stroke-width="1.8" fill="none"/>

    <!-- 桌沿：一张贴着的便签 + 从桌下压出来的一角纸 + 走线 -->
    <g transform="rotate(-4 100 506)">
      <rect x="64" y="468" width="74" height="74" fill="#f0f0f0" stroke="#111" stroke-width="2.8"/>
      <g stroke="#8f8f8f" stroke-width="2.2" stroke-linecap="round">
        <line x1="74" y1="486" x2="126" y2="486"/>
        <line x1="74" y1="496" x2="118" y2="496"/>
        <line x1="74" y1="506" x2="124" y2="506"/>
        <line x1="74" y1="516" x2="100" y2="516"/>
      </g>
    </g>
    <path d="M470 444 l34 0 l-6 18 l-34 0 z" fill="#ffffff" stroke="#111" stroke-width="2.5"/>
    <path d="M262 446 q-6 48 6 62 q12 14 34 12" fill="none" stroke="#111" stroke-width="3"/>
    <rect x="300" y="516" width="22" height="14" rx="3" fill="#ffffff" stroke="#111" stroke-width="2.5"/>

    <!-- 抽屉 -->
    <rect x="700" y="482" width="212" height="64" rx="4" fill="#f7f7f7" stroke="#111" stroke-width="3"/>
    <line x1="766" y1="514" x2="846" y2="514" stroke="#111" stroke-width="5" stroke-linecap="round"/>
  `;
}

function catSceneSvg(state, jar, now, noBig, weekLeft = 0, wxCode = null) {
  // 下班 / 睡觉：整幅换成大场景
  if (!noBig && (state.pose === 'off' || state.pose === 'sleep')) return bigSceneSvg(state, jar, now);
  const steam = state.pose === 'work';
  const zzz = state.pose === 'sleep';
  const yawn = state.pose === 'yawn';
  const eyesOpen = state.pose !== 'sleep' && state.pose !== 'lunch' && !yawn;
  const sky = windowScene(skyPhase(now), wxCode);

  // 猫粮罐（今日待办完成率）：小号，只占桌面右下角一点
  const jarFillH = Math.round(80 * jar.pct);
  const jarPctText = `${Math.round(jar.pct * 100)}%`;
  const jarTop = 428 - jarFillH;           // 粮面高度
  const jarFull = jar.pct >= 0.999;        // 满罐：浮一条小鱼干当奖励
  // 猫粮颗粒（只在粮面以下显示，位置固定，不随刷新跳动）
  const pellets = [];
  for (let i = 0; i < 26; i++) {
    const px = 697 + ((i * 17) % 48) + (i % 2) * 3;
    const py = 424 - ((i * 13) % 74);
    if (py > jarTop + 4) pellets.push(`<circle cx="${px}" cy="${py}" r="${i % 3 === 0 ? 2.6 : 2}" fill="#9e9e9e"/>`);
  }
  const jarLabel = jar.empty
    ? '今日无待办'
    : (jarFull ? '满罐！小鱼干到手' : `还差 ${jar.left} 条收工`);

  return `<svg viewBox="0 0 944 560" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
    <!-- 墙面 -->
    <rect x="0" y="0" width="944" height="560" fill="#ffffff"/>
    <rect x="0" y="0" width="944" height="430" fill="#fafafa"/>

    <!-- 窗户与城市（天色随时刻变化） -->
    <defs><clipPath id="winClip"><rect x="563" y="29" width="324" height="234"/></clipPath></defs>
    <rect x="560" y="26" width="330" height="240" fill="#ffffff" stroke="#111" stroke-width="6"/>
    <g clip-path="url(#winClip)">
      <rect x="563" y="29" width="324" height="234" fill="${sky.skyColor}"/>
      ${sky.stars}
      ${sky.moon}
      ${sky.sun}
      ${sky.cloud}
      ${sky.far}
      ${sky.near}
      ${sky.lit}
      ${sky.haze}
      ${sky.rain}
      ${sky.snow}
      ${sky.bolt}
    </g>
    <line x1="725" y1="26" x2="725" y2="266" stroke="#111" stroke-width="4"/>
    <line x1="560" y1="146" x2="890" y2="146" stroke="#111" stroke-width="4"/>
    <rect x="560" y="26" width="330" height="240" fill="none" stroke="#111" stroke-width="6"/>

    <!-- 窗台绿植 -->
    <g stroke="#111" stroke-width="3" fill="#e9e9e9">
      <path d="M545 262 q-8 -40 12 -66"/>
      <path d="M552 262 q14 -34 40 -44"/>
      <path d="M540 262 q-26 -22 -44 -20"/>
    </g>
    <g fill="#cfcfcf" stroke="#111" stroke-width="2.5">
      <ellipse cx="558" cy="192" rx="10" ry="16" transform="rotate(-18 558 192)"/>
      <ellipse cx="594" cy="214" rx="9" ry="14" transform="rotate(24 594 214)"/>
      <ellipse cx="494" cy="240" rx="9" ry="14" transform="rotate(-40 494 240)"/>
    </g>
    <path d="M528 262 h56 l-8 34 h-40 z" fill="#ffffff" stroke="#111" stroke-width="3.5"/>
    <line x1="500" y1="266" x2="890" y2="266" stroke="#111" stroke-width="5"/>

    <!-- 对话气泡 -->
    <g>
      <rect x="52" y="96" width="316" height="104" rx="20" fill="#ffffff" stroke="#111" stroke-width="4"/>
      <path d="M180 200 l26 34 l14 -34 z" fill="#ffffff" stroke="#111" stroke-width="4"/>
      <rect x="172" y="192" width="52" height="16" fill="#ffffff"/>
      <text x="210" y="136" text-anchor="middle" font-size="27" font-weight="600" fill="#111" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${state.bubble[0]}</text>
      <text x="210" y="176" text-anchor="middle" font-size="22" fill="#555" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${state.bubble[1]}</text>
    </g>

    <!-- 桌子 -->
    <rect x="0" y="430" width="944" height="14" fill="#ffffff" stroke="#111" stroke-width="5"/>
    <rect x="0" y="444" width="944" height="116" fill="#f1f1f1"/>

    <!-- 桌面上的杂物（先把东西摆上，猫再坐进来） -->
    ${deskClutter()}

    <!-- 原图猫：直接从素材裁切，电脑 / 饭碗 / 提包都自带 -->
    ${photoCat(state.pose, 322, 434, 322)}

    ${
      zzz
        ? `<!-- Zzz -->
      <g fill="#777" font-family="Arial, sans-serif" font-weight="bold">
        <text x="400" y="270" font-size="30" opacity="0.5">Z</text>
        <text x="432" y="240" font-size="38" opacity="0.75">z</text>
        <text x="466" y="206" font-size="48" opacity="1">Z</text>
      </g>`
        : ''
    }

    <!-- 猫粮罐（今日待办完成率）：小号，放在桌角 -->
    ${
      cfg.showJar === false
        ? ''
        : `<g>
      <defs><clipPath id="jarClip"><rect x="692" y="346" width="64" height="82" rx="12"/></clipPath></defs>
      <rect x="702" y="330" width="44" height="15" rx="5" fill="#111"/>
      <rect x="690" y="344" width="68" height="86" rx="14" fill="#ffffff" stroke="#111" stroke-width="4"/>
      <!-- 猫粮：高度=完成率，颗粒铺在粮面以下 -->
      <g clip-path="url(#jarClip)">
        <rect x="690" y="${jarTop}" width="68" height="${jarFillH}" fill="#cfcfcf"/>
        ${pellets.join('')}
        <path d="M690 ${jarTop} q8 -5 16 0 q8 5 16 0 q8 -5 16 0 q8 5 16 0" fill="none" stroke="#8f8f8f" stroke-width="2"/>
      </g>
      <!-- 刻度：25% / 50% / 75% -->
      <g stroke="#c0c0c0" stroke-width="2">
        <line x1="680" y1="408" x2="690" y2="408"/><line x1="758" y1="408" x2="768" y2="408"/>
        <line x1="680" y1="388" x2="690" y2="388"/><line x1="758" y1="388" x2="768" y2="388"/>
        <line x1="680" y1="368" x2="690" y2="368"/><line x1="758" y1="368" x2="768" y2="368"/>
      </g>
      ${jarFull
        ? `<g>
        <ellipse cx="724" cy="364" rx="11" ry="6" fill="#ffffff" stroke="#111" stroke-width="2.2"/>
        <path d="M735 364 l9 -7 l0 14 z" fill="#111"/>
        <circle cx="719" cy="362" r="1.5" fill="#111"/>
      </g>`
        : ''}
      <rect x="690" y="344" width="68" height="86" rx="14" fill="none" stroke="#111" stroke-width="4"/>
      <text x="724" y="402" text-anchor="middle" font-size="26" font-weight="700" fill="#111" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${jarPctText}</text>
      <text x="780" y="382" font-size="20" fill="#777" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">今日完成</text>
      <text x="780" y="418" font-size="30" font-weight="700" fill="#111" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${jar.empty ? '—' : `${jar.done} / ${jar.total}`}</text>
      <text x="780" y="466" font-size="15" fill="#8a8a8a" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${jarLabel}</text>
    </g>`
    }

    <!-- 墙上软木便签板（替代原来的贴纸钟，时间统一看右上角大钟） -->
    <g>
      <rect x="16" y="214" width="140" height="142" rx="6" fill="#f3f3f3" stroke="#111" stroke-width="3.5"/>
      <g fill="#d2d2d2">
        <circle cx="36" cy="232" r="1.7"/><circle cx="120" cy="240" r="1.7"/>
        <circle cx="52" cy="330" r="1.7"/><circle cx="138" cy="318" r="1.7"/>
        <circle cx="96" cy="346" r="1.5"/><circle cx="28" cy="282" r="1.5"/>
      </g>
      <!-- 本周待办便签 -->
      <g transform="rotate(-3.5 82 256)">
        <rect x="30" y="228" width="104" height="60" fill="#ffffff" stroke="#111" stroke-width="2.5"/>
        <circle cx="82" cy="236" r="4" fill="#111"/>
        <text x="82" y="252" text-anchor="middle" font-size="14" fill="#7a7a7a" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">本周待办</text>
        <text x="82" y="279" text-anchor="middle" font-size="30" font-weight="700" fill="#111" font-family="'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${weekLeft}</text>
      </g>
      <!-- 一张随手记的小纸条 -->
      <g transform="rotate(5 108 318)">
        <rect x="72" y="298" width="70" height="46" fill="#e8e8e8" stroke="#111" stroke-width="2.5"/>
        <circle cx="107" cy="303" r="3" fill="#111"/>
        <g stroke="#8c8c8c" stroke-width="2" stroke-linecap="round">
          <line x1="80" y1="314" x2="134" y2="314"/>
          <line x1="80" y1="324" x2="126" y2="324"/>
          <line x1="80" y1="334" x2="118" y2="334"/>
        </g>
      </g>
    </g>
  </svg>`;
}

/* ==========================================================
   4b. 拼 HTML
   ========================================================== */
function buildHtml({ weather, calendar, todos }) {
  // 调试用：设环境变量 CAT_HOUR=10 或 CAT_HOUR=15.5 可强制指定小屋时间，看不同状态下的猫
  const hourOverride = process.env.CAT_HOUR ? parseFloat(process.env.CAT_HOUR) : null;
  const now = hourOverride !== null && !isNaN(hourOverride)
    ? new Date(new Date(NOW).setHours(0, 0, 0, 0) + hourOverride * 3600000)
    : NOW;
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];
  const bigDate = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const shopTitle = cfg.shopTitle || '猫的打工小屋';
  const land = cfg.width > cfg.height;   // 横屏布局开关（改 config 的 width/height 即可）

  const dayName = (s) => {
    const d = new Date(s + 'T00:00:00');
    const n = NOW;
    if (sameDay(d, n)) return '今天';
    if (sameDay(d, new Date(n.getTime() + 86400000))) return '明天';
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  };

  // 猫粮罐：今日完成率 = 已完成 / (已完成 + 今天到期未完成)
  const todayDue = todos.today.length + todos.overdue.length;
  const jarDone = todos.done || 0;
  const jarTotal = jarDone + todayDue;
  const jar = todayDue === 0
    ? { pct: 1, empty: true, left: 0, done: jarDone, total: jarDone }
    : { pct: jarDone / jarTotal, empty: false, left: todayDue, done: jarDone, total: jarTotal };

  const state = catState(now);

  // 调试用：WX_DEBUG=61 可强制指定天气码，查看雨/雪/雾/雷等窗外效果
  const wxCode = process.env.WX_DEBUG !== undefined ? Number(process.env.WX_DEBUG) : weather.code;

  // 调试用：JAR_DEBUG=0.6 可强制猫粮罐填充比例，用来查看不同满度/满罐小鱼干
  if (process.env.JAR_DEBUG) {
    jar.pct = Math.min(1, Math.max(0, parseFloat(process.env.JAR_DEBUG)));
  }

  const evRow = (e) => `<div class="ev"><span class="evt">${e.time}</span><span class="evn">${e.title}</span></div>`;
  const blank = (t) => `<div class="blank">${t}</div>`;

  const todoRow = (t) => `<div class="todo"><span class="box"></span><span class="tt">${t.title}</span>${t.short ? `<span class="td">${t.short}</span>` : ''}</div>`;
  const group = (label, items, max) => (items.length
    ? `<div class="grp">${label} · ${items.length}</div>${items.slice(0, max).map(todoRow).join('')}${items.length > max ? `<div class="more">还有 ${items.length - max} 条</div>` : ''}`
    : '');
  const todoBody = group('逾期', todos.overdue, 2) + group('今天', todos.today, 3) + group('本周', todos.week, 2);
  const todoEmpty = todos.total === 0
    ? blank(todos.source === 'ics' ? '订阅里没有带日期的任务' : '在 todo.txt 里写下来')
    : '';
  const todoCount = todos.total > 0
    ? `<div class="tfoot">共 ${todos.total} 条未完成${jarDone ? `　今日已完成 ${jarDone} 条` : ''}</div>`
    : '';

  const miniDay = (d) => `<div class="mday">
      <div class="mdn">${dayName(d.date)}</div>
      <div class="mdt">${d.text}</div>
      <div class="mdr"><b>${d.max}°</b>/${d.min}°</div>
    </div>`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      width:${cfg.width}px; height:${cfg.height}px; overflow:hidden;
      background:#fff; color:#000;
      font-family:"Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",sans-serif;
      padding:46px 60px 40px; display:flex; flex-direction:column;
    }
    .top { display:flex; align-items:flex-end; justify-content:space-between; }
    .shop { font-size:46px; font-weight:700; letter-spacing:2px; }
    .sub { font-size:21px; color:#777; margin-top:6px; }
    .quip { font-size:22px; color:#444; margin-top:12px; letter-spacing:0.5px; }
    .clock { text-align:right; }
    .clock .t { font-size:58px; font-weight:600; line-height:1; letter-spacing:1px; }
    .clock .d { font-size:22px; color:#777; margin-top:8px; }
    .clock .d b { color:#111; }

    .scene { margin-top:20px; }

    .wx { display:flex; align-items:center; gap:22px; border-top:3px solid #111; border-bottom:3px solid #111;
          padding:18px 4px; margin-top:18px; }
    .temp { font-size:92px; font-weight:600; line-height:0.95; letter-spacing:-3px; flex:none; }
    .temp span { font-size:42px; vertical-align:super; }
    .wmeta { flex:none; }
    .wmeta .wt { font-size:29px; font-weight:600; margin-bottom:8px; white-space:nowrap; }
    .wmeta .wd { font-size:20px; color:#555; line-height:1.6; white-space:nowrap; }
    .mdays { display:flex; flex:1; justify-content:flex-end; min-width:0; }
    .mday { text-align:center; padding:0 14px; border-left:1.5px solid #ddd; }
    .mday:first-child { border-left:0; }
    .mdn { font-size:19px; color:#777; margin-bottom:6px; }
    .mdt { font-size:24px; margin-bottom:6px; }
    .mdr { font-size:20px; color:#555; white-space:nowrap; }
    .mdr b { font-size:24px; color:#111; }

    .cols { display:flex; gap:48px; flex:1; padding-top:26px; min-height:0; }
    .col { flex:1; min-width:0; }
    .h { font-size:32px; font-weight:700; border-bottom:2.5px solid #111; padding-bottom:10px; margin-bottom:4px;
         display:flex; justify-content:space-between; }
    .h em { font-style:normal; font-size:20px; color:#888; font-weight:400; }
    .grp { font-size:22px; color:#555; margin:12px 0 0; letter-spacing:1px; }
    .ev { display:flex; gap:14px; padding:11px 0; border-bottom:1.5px solid #ededed; font-size:26px; }
    .evt { color:#555; width:78px; flex:none; }
    .evn { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .todo { display:flex; gap:14px; align-items:flex-start; padding:11px 0; border-bottom:1.5px solid #ededed; font-size:26px; }
    .box { width:20px; height:20px; border:2.5px solid #333; flex:none; margin-top:7px; }
    .tt { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .td { font-size:20px; color:#888; flex:none; padding-top:5px; }
    .more { font-size:20px; color:#aaa; padding:6px 0 0; }
    .tfoot { font-size:20px; color:#888; padding-top:12px; }
    .blank { font-size:24px; color:#aaa; padding:14px 0; }
    .foot { font-size:19px; color:#aaa; display:flex; justify-content:space-between; padding-top:12px; }

    ${land ? `
    /* ===== 横屏版（1448×1072）：左猫右清单 ===== */
    body {
      display:grid; grid-template-columns:1.3fr 1fr; grid-template-rows:auto 1fr auto auto;
      column-gap:46px; padding:36px 48px 24px;
    }
    .top { grid-column:1 / -1; grid-row:1; }
    .scene { grid-column:1; grid-row:2; margin-top:18px; min-height:0;
             display:flex; align-items:center; justify-content:center; }
    .wx { grid-column:1; grid-row:3; margin-top:16px; gap:16px; padding:14px 4px; }
    .cols { grid-column:2; grid-row:2 / 4; flex-direction:column; gap:18px; padding-top:24px; }
    .foot { grid-column:1 / -1; grid-row:4; }
    .shop { font-size:42px; }
    .clock .t { font-size:54px; }
    .temp { font-size:80px; }
    .temp span { font-size:36px; }
    .wmeta .wt { font-size:25px; }
    .wmeta .wd { font-size:18px; }
    .mday { padding:0 10px; }
    .mdn { font-size:18px; }
    .mdt { font-size:22px; }
    .mdr { font-size:18px; }
    .mdr b { font-size:22px; }
    .h { font-size:28px; }
    .col { display:flex; flex-direction:column; min-height:0; overflow:hidden; }
    .col:first-child { flex:0 0 auto; }
    .col:last-child { flex:1; }
    .ev, .todo { font-size:26px; padding:12px 0; }
    .grp { font-size:21px; }
    ` : ''}
  </style></head><body>
    <div class="top">
      <div>
        <div class="shop">${shopTitle}</div>
        <div class="sub">店长：一只猫 · 当前状态 <b>${state.label}</b></div>
        <div class="quip">「${dailyQuip(now)}」</div>
      </div>
      <div class="clock">
        <div class="t">${fmtTime(now)}</div>
        <div class="d"><b>${bigDate}</b> ${week} · ${cfg.city}</div>
      </div>
    </div>

    <div class="scene">${catSceneSvg(state, jar, now, false, todos.week.length, wxCode)}</div>

    <div class="wx">
      <div class="temp">${weather.now}<span>°</span></div>
      <div class="wmeta">
        <div class="wt">${weather.text} · 体感 ${weather.feels}°</div>
        <div class="wd">湿度 ${weather.humidity}%　今日 ${weather.days[0].min}°~${weather.days[0].max}°　降水 ${weather.days[0].rain}%</div>
      </div>
      <div class="mdays">${weather.days.map(miniDay).join('')}</div>
    </div>

    <div class="cols">
      <div class="col">
        <div class="h">今日日程 <em>${calendar.today.length} 项</em></div>
        ${calendar.today.length ? calendar.today.map(evRow).join('') : blank('今天没有安排')}
        <div class="grp">明天</div>
        ${calendar.tomorrow.length ? calendar.tomorrow.map(evRow).join('') : blank('明天是空的')}
      </div>
      <div class="col">
        <div class="h">待办 <em>${todos.total} 条</em></div>
        ${todoBody}${todoEmpty}${todoCount}
      </div>
    </div>

    <div class="foot">
      <span>${shopTitle} · ${state.label}</span>
      <span>更新于 ${fmtDay(now)} ${fmtTime(now)}</span>
    </div>
  </body></html>`;
}

/* ==========================================================
   5. 截图
   ========================================================== */
const weather = await getWeather();
const calendar = await getCalendar();
const todos = await getTodos();
const html = buildHtml({ weather, calendar, todos });

const outDir = path.join(ROOT, 'out');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'preview.html'), html, 'utf8');

// 只出 HTML 不出图（调试排版时用：node dashboard/render.mjs --html-only）
if (process.argv.includes('--html-only')) {
  console.log('完成：out/preview.html（用浏览器打开看看）');
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge' });   // Windows 上直接用系统自带的 Edge，不用额外下载
} catch {
  browser = await chromium.launch();                        // GitHub Actions 等环境走内置 Chromium
}
const page = await browser.newPage({
  viewport: { width: cfg.width, height: cfg.height },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: 'networkidle' });
// 等所有字体和图片真正就绪再截图，防止云端偶发出一张半成品
await page.evaluate(() => Promise.all([
  document.fonts ? document.fonts.ready : Promise.resolve(),
  ...Array.from(document.images).map(img => img.decode().catch(() => {})),
]));
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(outDir, 'dashboard.png'), type: 'png' });
await browser.close();

console.log(`完成：out/dashboard.png（${cfg.width}×${cfg.height}）`);
