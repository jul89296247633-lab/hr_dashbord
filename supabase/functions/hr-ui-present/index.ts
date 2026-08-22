import { createClient } from "npm:@supabase/supabase-js@2";

function requireEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(name + " is required");
  return value;
}

/* hr-ui-present — экран презентации кандидатов. Серверный рендер, действия — формы.
   Данные из hr-present. Деплоить только с verify_jwt = false.
   v2: общая навигация.
   v3: в подборке кандидаты сгруппированы по HR-менеджерам, и у тех, кто опознан
       по табельному номеру, показываются цифры за месяц.
   v4: подпись «HR: Фамилия» стоит на каждой карточке внутренних экранов — и в общем
       списке кандидатов, и внутри подборки. Имя берётся живьём из белого списка
       бота по author_tg, а не из копии в карточке: исправили имя в одном месте —
       поменялось везде, включая старые карточки. Записанное hr_manager — запасной
       вариант для тех, кого заводили не через бота (например, импорт из PPTX).

       ВАЖНО: цифры и имя HR есть ТОЛЬКО на внутренних страницах.
       В публичной ссылке /p/<токен> их нет и быть не должно — спека прямо запрещает
       показывать снаружи цифры из Borboza и внутренние заметки. */

const CODE = requireEnv("HH_UI_CODE");
const BASE = "https://twfmfmkqfhclzvdogvix.supabase.co/functions/v1/";
const supa = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

let cssCache = "";
async function css() {
  if (cssCache) return cssCache;
  const { data } = await supa.from("podbor_settings").select("value").eq("key", "ui_css").maybeSingle();
  cssCache = (data && data.value) || "";
  return cssCache;
}

/* ВНИМАНИЕ: список продублирован в hr-ui-najm, hr-ui-present и hr-rookies. Менять во всех трёх. */
const SCREENS = [
  { id: "podbor",  href: "/",        label: "Подбор резюме" },
  { id: "najm",    href: "/najm",    label: "Найм" },
  { id: "present", href: "/present", label: "Презентация" },
  { id: "rookies", href: "/rookies", label: "Новички" },
];
function navTabs(self) {
  return SCREENS.filter(function (t) { return t.id !== self; })
    .map(function (t) { return '<a class="tab" href="' + t.href + '">' + t.label + '</a>'; }).join("");
}

async function api(body) {
  const r = await fetch(BASE + "hr-present", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ code: CODE }, body)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(String(j.error || "hr-present: " + r.status));
  return j;
}

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
function fmtDate(v) {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? m[3] + "." + m[2] + "." + m[1] : String(v);
}
function fmtWhen(v) {
  if (!v) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(v));
  } catch (_e) { return String(v); }
}
function today() { return fmtWhen(new Date().toISOString()).split(",")[0]; }
function plural(n, a, b, c) {
  const d = n % 100; if (d > 10 && d < 20) return c;
  const u = n % 10; if (u === 1) return a; if (u >= 2 && u <= 4) return b; return c;
}
function spaced(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function money(kop) {
  if (kop === null || kop === undefined) return "—";
  return spaced(String(Math.round(Number(kop) / 100))) + " ₽";
}
function plainNum(v, suffix) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  return spaced(s) + (suffix || "");
}
function initials(name) {
  const p = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((p[0] ? p[0][0] : "") + (p[1] ? p[1][0] : "")).toUpperCase() || "?";
}

const NO_HR = "Без HR-менеджера";

/* Живой справочник имён HR по telegram_id. Почему не берём только hr_manager из карточки:
   там лежит копия имени на момент создания, и если HR в белом списке была записан
   именем из Telegram («Васенька»), то так оно и осталось бы навсегда. */
async function hrDirectory() {
  const dir = {};
  try {
    const r = await api({ action: "hr_names" });
    (r.items || []).forEach(function (u) { dir[String(u.telegram_id)] = (u.full_name || "").trim(); });
  } catch (_e) { /* справочник необязателен — без него останется запись из карточки */ }
  return dir;
}
function hrName(dir, author_tg, stored) {
  const live = author_tg ? (dir[String(author_tg)] || "") : "";
  return (live || (stored || "").trim() || "").trim();
}

/* Блок цифр — только для внутренней страницы. */
function metricsBlock(k) {
  if (!k) return "";
  return '<table class="tbl" style="margin-top:10px"><thead><tr><th></th>' +
    '<th class="num">Среднее</th><th class="num">' + esc(k.period) + '</th></tr></thead><tbody>' +
    '<tr><td class="key">Выручка</td><td class="num">' + money(k.avg_revenue) + '</td><td class="num">' + money(k.last_revenue) + '</td></tr>' +
    '<tr><td class="key">Штуки</td><td class="num">' + plainNum(k.avg_units) + '</td><td class="num">' + plainNum(k.last_units) + '</td></tr>' +
    '<tr><td class="key">Кросс</td><td class="num">' + plainNum(k.avg_cross_pct, "%") + '</td><td class="num">' + plainNum(k.last_cross_pct, "%") + '</td></tr>' +
    '</tbody></table>' +
    '<div class="note">Табельный ' + esc(k.external_id) +
    (k.tenure_months !== null && k.tenure_months !== undefined ? ' &middot; стаж ' + k.tenure_months + ' мес' : '') + '</div>';
}

/* Подпись HR. Видна только внутри: в publicPage сюда всегда приходит пусто. */
function hrLine(name) {
  if (!name) {
    return '<div class="chr" style="margin-top:8px;font-size:12px;font-weight:600;color:#B0A3A1">HR: не указан</div>';
  }
  return '<div class="chr" style="margin-top:8px;font-size:12px;font-weight:600;color:#E41B12">HR: ' + esc(name) + '</div>';
}

function card(p, tools, kpi, hr) {
  const meta = [p.age ? p.age + " лет" : "", p.city || ""].filter(Boolean).join(" &middot; ");
  const photo = p.photo_url
    ? '<img class="ph" src="' + esc(p.photo_url) + '" alt="">'
    : '<div class="ph none">' + esc(initials(p.full_name)) + '</div>';
  return '<div class="card">' + photo + '<div class="cbody"><div class="cname">' + esc(p.full_name) + '</div>' +
    (meta ? '<div class="cmeta">' + meta + '</div>' : '') +
    (p.internship_on ? '<div class="cdate">Стажировка с ' + esc(fmtDate(p.internship_on)) + '</div>' : '') +
    (p.description ? '<div class="cdesc">' + esc(p.description) + '</div>' : '') +
    (kpi ? metricsBlock(kpi) : '') +
    (hr === null ? '' : hrLine(hr)) +
    '</div>' + (tools || '') + '</div>';
}
function empty(t) { return '<div class="empty">' + esc(t) + '</div>'; }

async function page(o) {
  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">' +
    '<title>' + esc(o.title) + '</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' + (await css()) + '</style></head><body><div class="wrap"><div class="head"><div class="grow"><h1>' + o.h1 + '</h1>' +
    (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div>' +
    (o.actions ? '<div class="row noprint">' + o.actions + '</div>' : '') + '</div>' + o.body +
    '<div class="foot"><span>YAMAGUCHI &middot; Подбор &middot; 2026</span><span>' + esc(o.footer || o.title) + '</span></div></div></body></html>';
}

function msg(q) {
  return (q.ok ? '<div class="ok">' + esc(q.ok) + '</div>' : '') + (q.err ? '<div class="err">' + esc(q.err) + '</div>' : '');
}
function btn(act, fields, label, cls, disabled, confirmText) {
  let h = '<form method="post" action="/present" style="display:inline"' +
    (confirmText ? ' onsubmit="return confirm(&quot;' + esc(confirmText) + '&quot;)"' : '') +
    '><input type="hidden" name="do" value="' + esc(act) + '">';
  for (const k in fields) h += '<input type="hidden" name="' + esc(k) + '" value="' + esc(fields[k]) + '">';
  return h + '<button class="' + (cls || 'btn sm') + '" type="submit"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button></form>';
}

async function indexPage(q) {
  const pp = await api({ action: "people" });
  const ss = await api({ action: "sets" });
  const dir = await hrDirectory();
  const people = pp.items || [];
  const sets = ss.items || [];

  const setCards = sets.length
    ? '<div class="sets">' + sets.map(function (s) {
        const meta = [s.vacancy_name, s.area].filter(Boolean).map(esc).join(" &middot; ");
        const n = s.items_count || 0;
        return '<a class="set" href="/present?set=' + esc(s.id) + '"><h3>' + esc(s.title) + '</h3>' +
          (meta ? '<div class="m">' + meta + '</div>' : '') +
          '<div class="m">' + n + ' ' + plural(n, "кандидат", "кандидата", "кандидатов") + ' &middot; создана ' + esc(fmtWhen(s.created_at)) + '</div>' +
          (s.public_token ? '<span class="tag">Опубликована</span>' : '<span class="tag off">Черновик</span>') + '</a>';
      }).join("") + '</div>'
    : empty("Подборок пока нет. Отметьте кандидатов ниже и соберите первую.");

  const peopleCards = people.length
    ? '<div class="grid">' + people.map(function (p) {
        const pick = '<div class="pick noprint"><input form="add-people" type="checkbox" name="person_ids" value="' + esc(p.id) + '" id="c' + esc(p.id) + '">' +
          '<label for="c' + esc(p.id) + '" style="margin:0;text-transform:none;letter-spacing:0;font-size:12px">выбрать</label></div>';
        const earlyExit = p.external_id ? '' : '<div class="noprint" style="padding:0 16px 16px">' +
          btn("archive_person", { person_id: p.id }, "Сошла с дистанции досрочно", "btn sm", false,
            "Убрать кандидата из активного списка? Фото, описание и история сохранятся.") + '</div>';
        return card(p, pick + earlyExit, null, hrName(dir, p.author_tg, p.hr_manager));
      }).join("") + '</div>'
    : empty("Карточек ещё нет. HR отправляет фото с описанием в @yamahrbot — карточка появится здесь.");

  const opts = sets.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.title) + '</option>'; }).join("");

  const bezHr = people.filter(function (p) { return !hrName(dir, p.author_tg, p.hr_manager); }).length;

  const body = msg(q) +
    '<div class="tabs noprint"><span class="tab on">Презентация</span>' + navTabs("present") + '</div>' +
    '<h2 style="font-size:15px;font-weight:700;color:#E41B12;margin:0 0 12px">Подборки</h2>' + setCards +
    '<h2 style="font-size:15px;font-weight:700;color:#E41B12;margin:32px 0 12px">Кандидаты</h2>' +
    (bezHr ? '<div class="note" style="margin:-6px 0 12px">Без подписи HR: ' + bezHr + ' ' +
      plural(bezHr, "карточка", "карточки", "карточек") + '. Подпись берётся из белого списка бота по тому, кто прислал карточку.</div>' : '') +
    peopleCards +
    (people.length
      ? '<form id="add-people" method="post" action="/present"><input type="hidden" name="do" value="add">' +
        '<div class="panel noprint" style="margin-top:24px"><h2>Собрать презентацию</h2>' +
        '<div class="note">Отметьте кандидатов выше и добавьте в существующую подборку или создайте новую.</div>' +
        '<div class="f3"><div><label>В существующую</label><select name="set_id"><option value="">— новая подборка —</option>' + opts + '</select></div>' +
        '<div><label>Название новой</label><input name="title" placeholder="Менеджеры, Казань"></div>' +
        '<div><label>Вакансия</label><input name="vacancy_name" placeholder="Менеджер по продажам"></div></div>' +
        '<div class="f3"><div><label>Город</label><input name="area" placeholder="Казань"></div></div>' +
        '<div class="row" style="margin-top:18px"><button class="btn p" type="submit">Добавить в подборку</button></div></div></form>'
      : '');

  return await page({
    title: "Презентация кандидатов — YAMAGUCHI",
    h1: "Презентация кандидатов",
    sub: "Карточки заводит HR через @yamahrbot &middot; всего " + people.length + " " + plural(people.length, "карточка", "карточки", "карточек") + " &middot; на " + today(),
    body: body,
    footer: "Презентация кандидатов",
  });
}

/* Цифры по табельному номеру. Сверять по ФИО нельзя: тёзки встречаются. */
async function kpiByExt(exts) {
  const out = {};
  const list = exts.filter(Boolean);
  if (!list.length) return out;
  const { data: kp } = await supa.from("kpi_monthly")
    .select("external_id, period, tenure_months, avg_revenue, avg_units, avg_cross_pct, last_revenue, last_units, last_cross_pct")
    .in("external_id", list).order("period", { ascending: false });
  (kp || []).forEach(function (k) {
    if (!out[k.external_id]) out[k.external_id] = k;  // самый свежий период
  });
  return out;
}

async function setPage(q) {
  const r = await api({ action: "set", set_id: q.set });
  const s = r.set;
  const items = r.items || [];
  if (!s) {
    return await page({ title: "Подборка не найдена", h1: "Подборка не найдена", body: empty("Возможно, её удалили.") + '<a class="btn" href="/present">К списку</a>' });
  }

  const dir = await hrDirectory();
  const kpi = await kpiByExt(items.map(function (p) { return p.external_id; }));

  // группируем по HR-менеджеру, порядок внутри группы сохраняем
  const groups = [];
  const idx = {};
  items.forEach(function (p, i) {
    const hr = hrName(dir, p.author_tg, p.hr_manager);
    const key = hr || NO_HR;
    if (!(key in idx)) { idx[key] = groups.length; groups.push({ hr: key, list: [] }); }
    groups[idx[key]].list.push({ p: p, i: i, hr: hr });
  });

  const blocks = items.length
    ? groups.map(function (g) {
        const cards = g.list.map(function (o) {
          const k = o.p.external_id ? kpi[o.p.external_id] : null;
          const tools = '<div class="ctools noprint">' +
            btn("up", { set_id: s.id, item_id: o.p.item_id }, "Вверх", "btn sm", o.i === 0) +
            btn("down", { set_id: s.id, item_id: o.p.item_id }, "Вниз", "btn sm", o.i === items.length - 1) +
            btn("remove", { set_id: s.id, item_id: o.p.item_id }, "Убрать", "btn sm", false) + '</div>';
          return card(o.p, tools, k, o.hr);
        }).join("");
        const n = g.list.length;
        return '<h2 style="font-size:15px;font-weight:700;color:#E41B12;margin:26px 0 12px">' +
          esc(g.hr) + ' <span style="font-weight:400;color:#595959">&middot; ' + n + ' ' +
          plural(n, "кандидат", "кандидата", "кандидатов") + '</span></h2>' +
          '<div class="grid">' + cards + '</div>';
      }).join("")
    : empty("В подборке пока никого. Вернитесь к списку кандидатов и отметьте нужных.");

  const pub = s.public_token
    ? '<div class="pubbox noprint">Публичная ссылка (открывается без входа):<br>' +
      '<a class="link" href="/p/' + esc(s.public_token) + '">/p/' + esc(s.public_token) + '</a>' +
      '<div class="note">Опубликована ' + esc(fmtWhen(s.published_at)) +
      '. Снаружи видны только фото, имя, возраст, город и описание — цифры и имя HR туда не попадают.</div>' +
      btn("unpublish", { set_id: s.id }, "Снять публикацию", "btn", false) + '</div>'
    : '<div class="pubbox noprint">Подборка не опубликована — ссылку показать нельзя.' +
      btn("publish", { set_id: s.id }, "Опубликовать", "btn", false) + '</div>';

  const meta = [s.vacancy_name, s.area].filter(Boolean).map(esc).join(" &middot; ");
  const body = msg(q) + '<div class="tabs noprint"><a class="tab" href="/present">← Все подборки</a>' + navTabs("present") + '</div>' +
    blocks + pub +
    '<div class="panel noprint" style="margin-top:26px"><h2>Название и подписи</h2>' +
    '<form method="post" action="/present"><input type="hidden" name="do" value="update_set"><input type="hidden" name="set_id" value="' + esc(s.id) + '">' +
    '<div class="f3"><div><label>Название</label><input name="title" value="' + esc(s.title) + '"></div>' +
    '<div><label>Вакансия</label><input name="vacancy_name" value="' + esc(s.vacancy_name) + '"></div>' +
    '<div><label>Город</label><input name="area" value="' + esc(s.area) + '"></div></div>' +
    '<label>Комментарий</label><textarea name="comment" rows="2">' + esc(s.comment) + '</textarea>' +
    '<div class="row" style="margin-top:16px"><button class="btn p" type="submit">Сохранить</button></div></form></div>' +
    '<div class="row noprint">' + btn("delete_set", { set_id: s.id }, "Удалить подборку", "btn", false) + '</div>';

  return await page({
    title: s.title + " — YAMAGUCHI",
    h1: esc(s.title),
    sub: (meta ? meta + " &middot; " : "") + items.length + " " + plural(items.length, "кандидат", "кандидата", "кандидатов") +
         " &middot; групп по HR: " + groups.length + " &middot; на " + today(),
    actions: '<button class="btn" onclick="window.print()">Печать</button>' +
      (s.public_token ? '<a class="btn" href="/p/' + esc(s.public_token) + '" target="_blank">Публичная</a>' : ''),
    body: body,
    footer: s.title,
  });
}

/* Публичная страница — без цифр и без имён HR.
   Сюда намеренно не передаётся ни справочник HR, ни цифры: card(..., null, null). */
async function publicPage(token) {
  let s = null;
  let items = [];
  try {
    const r = await api({ action: "public_set", token: token });
    s = r.set; items = r.items || [];
  } catch (_e) { s = null; }
  if (!s || !s.public_token) {
    return await page({ title: "Ссылка недействительна — YAMAGUCHI", h1: "Ссылка недействительна", body: empty("Подборка не найдена или публикация снята."), footer: "Подбор" });
  }
  const meta = [s.vacancy_name, s.area].filter(Boolean).map(esc).join(" &middot; ");
  const body = (s.comment ? '<div class="panel">' + esc(s.comment) + '</div>' : '') +
    (items.length ? '<div class="grid">' + items.map(function (p) { return card(p, '', null, null); }).join("") + '</div>' : empty("В подборке пока никого."));
  return await page({
    title: s.title + " — YAMAGUCHI",
    h1: esc(s.title),
    sub: (meta ? meta + " &middot; " : "") + "кандидатов: " + items.length + " &middot; на " + today(),
    actions: '<button class="btn" onclick="window.print()">Печать</button>',
    body: body,
    footer: s.title,
  });
}

async function submit(f) {
  const act = String(f["do"] || "");
  const setId = String(f.set_id || "");
  const S = function (k) { return String(f[k] || "").trim(); };
  try {
    if (act === "add") {
      const ids = [].concat(f.person_ids || []).filter(Boolean);
      if (!ids.length) return { redirect: "/present?err=" + encodeURIComponent("Никто не отмечен") };
      let target = setId;
      if (!target) {
        const c = await api({ action: "create_set", title: S("title") || "Новая подборка", vacancy_name: S("vacancy_name") || null, area: S("area") || null });
        target = c.set.id;
      }
      await api({ action: "add", set_id: target, person_ids: ids });
      return { redirect: "/present?set=" + target + "&ok=" + encodeURIComponent("Добавлено: " + ids.length) };
    }
    if (act === "remove") {
      await api({ action: "remove", item_id: S("item_id") });
      return { redirect: "/present?set=" + setId + "&ok=" + encodeURIComponent("Кандидат убран") };
    }
    if (act === "archive_person") {
      await api({ action: "archive_person", person_id: S("person_id") });
      return { redirect: "/present?ok=" + encodeURIComponent("Карточка убрана из активного списка") };
    }
    if (act === "up" || act === "down") {
      const r = await api({ action: "set", set_id: setId });
      const ids = (r.items || []).map(function (i) { return i.item_id; });
      const at = ids.indexOf(S("item_id"));
      const to = act === "up" ? at - 1 : at + 1;
      if (at >= 0 && to >= 0 && to < ids.length) {
        const t = ids[at]; ids[at] = ids[to]; ids[to] = t;
        await api({ action: "reorder", set_id: setId, item_ids: ids });
      }
      return { redirect: "/present?set=" + setId };
    }
    if (act === "publish") {
      await api({ action: "publish", set_id: setId });
      return { redirect: "/present?set=" + setId + "&ok=" + encodeURIComponent("Подборка опубликована") };
    }
    if (act === "unpublish") {
      await api({ action: "unpublish", set_id: setId });
      return { redirect: "/present?set=" + setId + "&ok=" + encodeURIComponent("Публикация снята") };
    }
    if (act === "delete_set") {
      await api({ action: "delete_set", set_id: setId });
      return { redirect: "/present?ok=" + encodeURIComponent("Подборка удалена") };
    }
    if (act === "update_set") {
      await api({ action: "update_set", set_id: setId, title: S("title"), vacancy_name: S("vacancy_name") || null, area: S("area") || null, comment: S("comment") || null });
      return { redirect: "/present?set=" + setId + "&ok=" + encodeURIComponent("Сохранено") };
    }
    return { redirect: "/present?err=" + encodeURIComponent("Неизвестное действие") };
  } catch (e) {
    const where = setId ? "/present?set=" + setId + "&err=" : "/present?err=";
    return { redirect: where + encodeURIComponent(String((e && e.message) || e)) };
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("hr-ui-present жив", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  let b = {};
  try { b = await req.json(); } catch (_e) { b = {}; }
  if ((b.code || "") !== CODE) return Response.json({ error: "Неверный код доступа" }, { status: 403, headers: CORS });
  const q = b.qs || {};
  try {
    if (b.form) return Response.json(await submit(b.form), { headers: CORS });
    if (b.path === "public") return Response.json({ html: await publicPage(String(b.token || "")) }, { headers: CORS });
    if (q.set) return Response.json({ html: await setPage(q) }, { headers: CORS });
    return Response.json({ html: await indexPage(q) }, { headers: CORS });
  } catch (e) {
    const h = await page({ title: "Ошибка — YAMAGUCHI", h1: "Не удалось загрузить данные", body: '<div class="err">' + esc(String((e && e.message) || e)) + '</div><a class="btn" href="/present">Обновить</a>', footer: "Презентация" });
    return Response.json({ html: h }, { headers: CORS });
  }
});
