import { createClient } from "npm:@supabase/supabase-js@2";

function requireEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(name + " is required");
  return value;
}
import { findUniquePhotoMatch } from "./photo-match.ts";

/* hr-rookies — экран новичков, вставка таблицы Borboza и сборка подборки новичков.
   Ключ человека — табельный номер из «Яна Нохрина [#887]». Деньги в копейках.
   Функция с собственной авторизацией по коду — деплоить только с verify_jwt = false.
   v5: переключатель «работают / уволены». v6: общая навигация. v7: убран столбец «Разница».
   v8: новичка можно отметить и собрать из отмеченных подборку.
       Отмечать можно любого из отчёта, а не только тех, кого HR завела в боте:
       карточка под табельным номером заводится сама (podbor_person_from_rookie).
       Подборка ссылается на человека, а не на снимок данных — появится фото от HR,
       подтянется само. */

const CODE = requireEnv("HH_UI_CODE");
const supa = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));

function publicPhotoUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(String(path))) return String(path);
  return "/api/photo?path=" + encodeURIComponent(String(path));
}

let cssCache = "";
async function css() {
  if (cssCache) return cssCache;
  const { data } = await supa.from("podbor_settings").select("value").eq("key", "ui_css").maybeSingle();
  cssCache = (data && data.value) || "";
  return cssCache;
}

/* ---------- навигация между экранами ----------
   ВНИМАНИЕ: список продублирован в hr-ui-najm, hr-ui-present и hr-rookies. Менять во всех трёх. */
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
function empty(t) { return '<div class="empty">' + esc(t) + '</div>'; }

function normStatus(s) { return String(s || "") === "dismissed" ? "dismissed" : "active"; }
function statusLabel(s) { return s === "dismissed" ? "Уволены" : "Работают"; }

/* ---------- трансформеры ---------- */
function intOrNull(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/ /g, " ").trim();
  if (!t || t === "?" || t === "—" || t === "-") return null;
  const m = t.replace(/\s/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : null;
}
function moneyToKopecks(s) {
  const n = intOrNull(s);
  return n === null ? null : n * 100;
}
function percentToNum(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace("%", "").replace(",", ".").trim();
  if (!t || t === "?" || t === "—") return null;
  const m = t.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function splitId(s) {
  const t = String(s || "");
  const m = t.match(/\[#(\d+)\]/);
  return { full_name: t.replace(/\[#\d+\]/, "").trim(), external_id: m ? m[1] : null };
}
function splitCells(line) {
  if (line.indexOf("\t") >= 0) return line.split("\t");
  return line.split(/ {2,}|;/);
}
function norm(s) { return String(s || "").toLowerCase().trim(); }

/* ---------- разбор вставленной таблицы ---------- */
function parseTable(raw) {
  const lines = String(raw || "").split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  if (!lines.length) throw new Error("Пустая вставка");

  let firstData = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\[#\d+\]/.test(lines[i])) { firstData = i; break; }
  }
  if (firstData < 0) throw new Error("Не нашла ни одной строки с табельным номером вида [#887]. Скопируйте таблицу целиком вместе с шапкой.");

  const head = lines.slice(0, firstData);
  let r1 = -1;
  for (let i = 0; i < head.length; i++) {
    if (/сотрудник/i.test(head[i])) { r1 = i; break; }
  }
  if (r1 < 0) throw new Error("HEADER_NOT_FOUND: в шапке нет строки с колонкой «Сотрудник»");

  const row1 = splitCells(head[r1]).map(function (s) { return String(s).trim(); });
  const row2raw = r1 + 1 < head.length ? splitCells(head[r1 + 1]).map(function (s) { return String(s).trim(); }) : [];
  const row2 = row2raw.filter(function (s) { return s.length > 0; });

  let month = null;
  for (let i = 0; i < row1.length; i++) {
    if (/^\d{4}-\d{2}$/.test(row1[i])) month = row1[i];
  }

  let lead = row1.length;
  for (let i = 0; i < row1.length; i++) {
    if (/^период$/i.test(row1[i])) { lead = i; break; }
  }

  function findLead(word) {
    for (let i = 0; i < lead; i++) {
      if (norm(row1[i]).indexOf(word) >= 0) return i;
    }
    return -1;
  }

  const col = {
    employee: findLead("сотрудник"),
    city: findLead("отдел"),
    job: findLead("должность"),
    staff: findLead("штат"),
    age: findLead("возраст"),
    stars: findLead("звезд"),
    tenure: findLead("стаж"),
    months: findLead("месяцы"),
  };
  if (col.employee < 0) throw new Error("HEADER_NOT_FOUND: колонка «Сотрудник» не найдена");

  const sub = {};
  let periodFrom = -1, periodTo = -1;
  const rubAt = [];
  for (let k = 0; k < row2.length; k++) {
    const h = norm(row2[k]);
    if (h === "с" && periodFrom < 0) periodFrom = lead + k;
    else if (h === "по" && periodTo < 0) periodTo = lead + k;
    else if (h.indexOf("руб") >= 0) rubAt.push(k);
  }
  if (rubAt.length < 2) {
    throw new Error("HEADER_NOT_FOUND: в нижней строке шапки нет двух колонок «руб» (среднее и текущий месяц). Скопируйте таблицу вместе с обеими строками заголовков.");
  }

  function mapGroup(fromK, toK) {
    const g = { rub: -1, units: -1, cross: -1, chairs: -1 };
    for (let k = fromK; k < toK; k++) {
      const h = norm(row2[k]);
      if (h.indexOf("руб") >= 0) g.rub = lead + k;
      else if (h.indexOf("шт") >= 0) g.units = lead + k;
      else if (h.indexOf("кросс") >= 0) g.cross = lead + k;
      else if (h.indexOf("кресел") >= 0) g.chairs = lead + k;
    }
    return g;
  }
  const avg = mapGroup(rubAt[0], rubAt[1]);
  const last = mapGroup(rubAt[1], row2.length);
  sub.avg = avg; sub.last = last;

  function cell(c, idx) { return idx >= 0 ? c[idx] : null; }

  const rows = [];
  for (let i = firstData; i < lines.length; i++) {
    const c = splitCells(lines[i]);
    const rawName = cell(c, col.employee);
    if (!rawName || !/\[#\d+\]/.test(rawName)) continue;
    const who = splitId(rawName);
    if (!who.external_id) continue;
    rows.push({
      external_id: who.external_id,
      full_name: who.full_name,
      city: (cell(c, col.city) || "").trim() || null,
      job_title: (cell(c, col.job) || "").trim() || null,
      staff_type: (cell(c, col.staff) || "").trim() || null,
      age: intOrNull(cell(c, col.age)),
      stars: intOrNull(cell(c, col.stars)),
      tenure_months: intOrNull(cell(c, col.tenure)),
      months_counted: intOrNull(cell(c, col.months)),
      period_from: (cell(c, periodFrom) || "").trim() || null,
      period_to: (cell(c, periodTo) || "").trim() || null,
      avg_revenue: moneyToKopecks(cell(c, avg.rub)),
      avg_units: intOrNull(cell(c, avg.units)),
      avg_cross_pct: percentToNum(cell(c, avg.cross)),
      avg_chairs: intOrNull(cell(c, avg.chairs)),
      last_revenue: moneyToKopecks(cell(c, last.rub)),
      last_units: intOrNull(cell(c, last.units)),
      last_cross_pct: percentToNum(cell(c, last.cross)),
      last_chairs: intOrNull(cell(c, last.chairs)),
    });
  }
  if (!rows.length) throw new Error("Строки не разобрались. Скопируйте таблицу из браузера целиком.");

  const guessed = month || (rows[0].period_to || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(guessed)) {
    throw new Error("Не поняла, за какой месяц данные. Укажите месяц вручную в поле над вставкой.");
  }
  return { period: guessed, rows: rows };
}

/* ---------- сохранение ---------- */
async function saveRows(period, rows, author, status) {
  const { count: prev } = await supa.from("kpi_monthly")
    .select("id", { count: "exact", head: true }).eq("period", period).eq("employment_status", status);
  if (prev && rows.length < prev / 2) {
    await supa.from("kpi_imports").insert({
      period: period, rows_total: rows.length, blocked: true, author: author,
      employment_status: status,
      note: "Строк вдвое меньше прошлого сбора по статусу «" + statusLabel(status) + "» (" + rows.length + " против " + prev + ")",
    });
    throw new Error("Похоже, таблица скопировалась не целиком: " + rows.length + " строк против " + prev + " в прошлый раз для статуса «" + statusLabel(status) + "». Запись отменена.");
  }

  const ids = rows.map(function (r) { return r.external_id; });
  const byExt = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data: people } = await supa.from("podbor_people")
      .select("id,external_id").in("external_id", ids.slice(i, i + 200));
    (people || []).forEach(function (p) { if (p.external_id) byExt[p.external_id] = p.id; });
  }

  const payload = rows.map(function (r) {
    const pid = byExt[r.external_id] || null;
    return Object.assign({}, r, {
      period: period, person_id: pid, unmatched: !pid,
      source: "paste", employment_status: status,
      collected_at: new Date().toISOString(),
    });
  });

  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supa.from("kpi_monthly")
      .upsert(payload.slice(i, i + 200), { onConflict: "external_id,period" });
    if (error) throw new Error(error.message);
  }

  const matched = payload.filter(function (r) { return !r.unmatched; }).length;
  await supa.from("kpi_imports").insert({
    period: period, rows_total: payload.length,
    rows_matched: matched, rows_unmatched: payload.length - matched,
    author: author, source: "paste", employment_status: status,
  });
  return { period: period, total: payload.length, matched: matched, unmatched: payload.length - matched, status: status };
}

/* ---------- страницы ---------- */
async function page(o) {
  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">' +
    '<title>' + esc(o.title) + '</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;900&display=swap" rel="stylesheet">' +
    '<style>' + (await css()) + '</style></head><body><div class="wrap"><div class="head"><div class="grow"><h1>' + o.h1 + '</h1>' +
    (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div>' +
    (o.actions ? '<div class="row noprint">' + o.actions + '</div>' : '') + '</div>' + o.body +
    '<div class="foot"><span>YAMAGUCHI &middot; Подбор &middot; 2026</span><span>Новички</span></div></div></body></html>';
}

function msg(q) {
  return (q.ok ? '<div class="ok">' + esc(q.ok) + '</div>' : '') + (q.err ? '<div class="err">' + esc(q.err) + '</div>' : '');
}

function tabsRow(active) {
  return '<div class="tabs noprint">' +
    (active === "list" ? '<span class="tab on">Новички</span>' : '<a class="tab" href="/rookies">Новички</a>') +
    (active === "import" ? '<span class="tab on">Вставить таблицу</span>' : '<a class="tab" href="/rookies?import=1">Вставить таблицу</a>') +
    navTabs("rookies") + '</div>';
}

function metricRow(label, aFmt, nFmt) {
  return '<tr><td class="key">' + esc(label) + '</td><td class="num">' + aFmt + '</td><td class="num">' + nFmt + '</td></tr>';
}

async function listPage(q) {
  const limit = Math.min(parseInt(q.limit || "120", 10) || 120, 400);
  const { data: rows, error } = await supa.from("rookies_view").select("*").limit(limit);
  if (error) throw new Error(error.message);
  const items = rows || [];

  let photoMatches = 0;
  if (items.some(function (r) { return !r.photo_path; })) {
    const { data: photoPeople, error: photoError } = await supa.from("podbor_people")
      .select("id,full_name,city,photo_path,internship_on")
      .eq("archived", false).not("photo_path", "is", null).limit(500);
    if (photoError) throw new Error(photoError.message);

    items.forEach(function (r) {
      if (r.photo_path) return;
      const matched = findUniquePhotoMatch(r, photoPeople || []);
      if (!matched) return;
      r.photo_path = matched.photo_path;
      if (!r.internship_on && matched.internship_on) r.internship_on = matched.internship_on;
      r.has_card = true;
      photoMatches++;
    });
  }

  for (const r of items) {
    if (r.photo_path) {
      r.photo_url = publicPhotoUrl(r.photo_path);
    }
  }

  const { data: imp } = await supa.from("kpi_imports")
    .select("created_at,period,rows_total,rows_matched,rows_unmatched,employment_status")
    .eq("blocked", false).order("id", { ascending: false }).limit(1);
  const last = imp && imp[0];

  const fresh = last
    ? '<div class="fresh">Данные за ' + esc(last.period) + ', вставлены ' + esc(fmtWhen(last.created_at)) +
      ' · всего строк ' + last.rows_total + ', наших карточек нашла ' + last.rows_matched +
      (photoMatches ? ' · фото сопоставлено: ' + photoMatches : '') +
      ' · последний проход: ' + esc(statusLabel(last.employment_status)) + '</div>'
    : '<div class="fresh warn">Таблица результатов ещё не вставлялась</div>';

  if (!items.length) {
    return await page({
      title: "Новички — YAMAGUCHI", h1: "Новички",
      sub: "Стаж до 12 месяцев по отчёту Borboza &middot; на " + today(),
      body: msg(q) + tabsRow("list") + fresh + empty("Пока пусто. Вставьте таблицу результатов — новички отберутся по стажу сами."),
    });
  }

  const cards = items.map(function (r) {
    const hasPhoto = !!r.photo_url;
    const photo = hasPhoto ? '<img class="ph" src="' + esc(r.photo_url) + '" alt="">' : '';
    const av = hasPhoto ? '' : '<div class="av">' + esc(initials(r.full_name)) + '</div>';
    const meta = [r.city || "", (r.tenure_months !== null && r.tenure_months !== undefined) ? "стаж " + r.tenure_months + " мес" : ""].filter(Boolean).join(" &middot; ");
    const shortAvg = (r.months_counted !== null && r.months_counted !== undefined && r.months_counted < 3);
    const table = '<table class="tbl" style="margin-top:10px"><thead><tr><th></th><th class="num">Среднее' + (shortAvg ? '*' : '') +
      '</th><th class="num">' + esc(r.period) + '</th></tr></thead><tbody>' +
      metricRow("Выручка", money(r.avg_revenue), money(r.last_revenue)) +
      metricRow("Штуки", plainNum(r.avg_units), plainNum(r.last_units)) +
      metricRow("Кросс", plainNum(r.avg_cross_pct, "%"), plainNum(r.last_cross_pct, "%")) +
      metricRow("Кресла", plainNum(r.avg_chairs), plainNum(r.last_chairs)) +
      '<tr><td class="key">Звёзды</td><td class="num">—</td><td class="num">' + plainNum(r.stars) + '</td></tr>' +
      '</tbody></table>' +
      (shortAvg ? '<div class="note">* среднее считано менее чем за три месяца — сравнение слабое</div>' : '') +
      (r.has_card ? '' : '<div class="note">Карточки от HR нет — только данные из отчёта</div>');

    const pick = '<div class="pick noprint"><input type="checkbox" name="ext_ids" value="' + esc(r.external_id) +
      '" id="k' + esc(r.external_id) + '">' +
      '<label for="k' + esc(r.external_id) + '" style="margin:0;text-transform:none;letter-spacing:0;font-size:12px">в подборку</label></div>';

    return '<div class="card' + (hasPhoto ? '' : ' nophoto') + '">' + photo + '<div class="cbody">' +
      '<div class="chead">' + av + '<div class="cid">' +
      '<div class="cname">' + esc(r.full_name) + '</div>' +
      (meta ? '<div class="cmeta">' + meta + '</div>' : '') +
      '</div></div>' +
      (r.internship_on ? '<div class="cdate">Стажировка с ' + esc(fmtDate(r.internship_on)) + '</div>' : '') +
      table + '</div>' + pick + '</div>';
  }).join("");

  const sbor = '<div class="panel noprint" style="margin-top:24px"><h2>Собрать подборку новичков</h2>' +
    '<div class="note">Отметьте нужных выше. В подборке будет фото, описание и цифры за месяц. ' +
    'У кого ещё нет карточки от HR — вместо фото будут инициалы; когда HR заведёт карточку и свяжет её ' +
    'с табельным номером, фото появится в подборке само — подборка ссылается на человека, а не на снимок данных.</div>' +
    '<div class="f3"><div><label>Название</label><input name="title" placeholder="Новички, август"></div>' +
    '<div><label>Город (необязательно)</label><input name="area" placeholder="Казань"></div></div>' +
    '<label>Комментарий</label><textarea name="comment" rows="2"></textarea>' +
    '<div class="row" style="margin-top:16px"><button class="btn p" type="submit">Собрать подборку</button></div></div>';

  return await page({
    title: "Новички — YAMAGUCHI", h1: "Новички",
    sub: "Стаж до 12 месяцев по отчёту Borboza &middot; на экране " + items.length + " &middot; " + today(),
    actions: '<button class="btn" onclick="window.print()">Печать</button>',
    body: msg(q) + tabsRow("list") + fresh +
      '<form method="post" action="/rookies"><input type="hidden" name="do" value="set_rookies">' +
      '<div class="grid">' + cards + '</div>' + sbor + '</form>',
  });
}

async function importPage(q) {
  const { data: sug } = await supa.from("podbor_match_suggestions").select("*").limit(30);
  const { data: un } = await supa.from("kpi_monthly")
    .select("external_id,full_name,city,tenure_months,employment_status").eq("unmatched", true)
    .lte("tenure_months", 12)
    .order("collected_at", { ascending: false }).limit(40);
  const { data: people } = await supa.from("podbor_people")
    .select("id,full_name,city").eq("archived", false).order("full_name");

  const opts = (people || []).map(function (p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.full_name) + (p.city ? " — " + esc(p.city) : "") + '</option>';
  }).join("");

  const podskazki = (sug || []).length
    ? '<div class="panel"><h2>Похоже, это одни и те же люди</h2>' +
      '<div class="note">Borboza пишет «Имя Фамилия», HR — «Фамилия Имя», поэтому сами они не сошлись. ' +
      'Совпадение ищется по словам имени в любом порядке и по городу. Автоматически ничего не связывается: ' +
      'однофамильцы одного возраста в одном городе встречаются — проверьте и подтвердите.</div>' +
      '<table class="tbl"><thead><tr><th>Карточка HR</th><th>Строка отчёта</th><th></th></tr></thead><tbody>' +
      (sug || []).map(function (s) {
        return '<tr><td class="key">' + esc(s.kartochka) +
          '<div class="note" style="margin:2px 0 0">' + esc(s.gorod_kartochki || "город не указан") + '</div></td>' +
          '<td>' + esc(s.v_otchete) + ' [#' + esc(s.external_id) + ']' +
          '<div class="note" style="margin:2px 0 0">' + esc(s.otdel) + ' &middot; стаж ' + esc(s.tenure_months) + ' мес' +
          (s.gorod_sovpal ? ' &middot; город совпал' : ' &middot; <b>город разный</b>') + '</div></td>' +
          '<td><form method="post" action="/rookies">' +
          '<input type="hidden" name="do" value="match">' +
          '<input type="hidden" name="external_id" value="' + esc(s.external_id) + '">' +
          '<input type="hidden" name="person_id" value="' + esc(s.person_id) + '">' +
          '<button class="btn sm p" type="submit">Это она</button></form></td></tr>';
      }).join("") + '</tbody></table></div>'
    : '';

  const unmatched = (un || []).length
    ? '<div class="panel"><h2>Новички без карточки</h2>' +
      '<div class="note">Цифры уже сохранены и видны на экране. Свяжите с карточкой от HR, чтобы появилось фото и дата выхода на стажировку.</div>' +
      '<table class="tbl"><thead><tr><th>Из отчёта</th><th>Наша карточка</th></tr></thead><tbody>' +
      (un || []).map(function (r) {
        return '<tr><td class="key">' + esc(r.full_name) + ' [#' + esc(r.external_id) + ']' +
          ' &middot; <span class="note" style="display:inline">' + esc(statusLabel(r.employment_status)) + '</span>' +
          '<div class="note" style="margin:2px 0 0">' + esc(r.city) + ' &middot; стаж ' + esc(r.tenure_months) + ' мес</div></td>' +
          '<td><form method="post" action="/rookies" class="row">' +
          '<input type="hidden" name="do" value="match">' +
          '<input type="hidden" name="external_id" value="' + esc(r.external_id) + '">' +
          '<select name="person_id" required><option value="">— выберите —</option>' + opts + '</select>' +
          '<button class="btn sm p" type="submit">Связать</button></form></td></tr>';
      }).join("") + '</tbody></table></div>'
    : '';

  const body = msg(q) + tabsRow("import") +
    '<div class="panel"><h2>Вставить таблицу из Borboza</h2>' +
    '<div class="note">Отчёт <b>retail-kpi → Результаты сотрудников</b>. Портал отдаёт работающих и уволенных отдельными списками —' +
    ' вставляйте их по очереди: сначала список с фильтром «работают» при переключателе «Работают», сохраните,' +
    ' затем переключите на «Уволены», откройте в Borboza тот же отчёт с фильтром «уволены» и вставьте второй раз.' +
    ' Выделяйте таблицу целиком вместе с обеими строками шапки (Ctrl+A, Ctrl+C).</div>' +
    '<form method="post" action="/rookies"><input type="hidden" name="do" value="paste">' +
    '<label>Статус в отчёте</label><div class="row" style="gap:20px;margin:4px 0 14px">' +
    '<label style="font-weight:400;display:flex;align-items:center;gap:6px">' +
    '<input type="radio" name="employment_status" value="active" checked> Работают</label>' +
    '<label style="font-weight:400;display:flex;align-items:center;gap:6px">' +
    '<input type="radio" name="employment_status" value="dismissed"> Уволены</label></div>' +
    '<label>Месяц (если не распознается сам)</label><input class="auto" name="period" placeholder="2026-07" style="width:140px">' +
    '<label>Таблица</label><div class="qbox"><textarea name="raw" rows="14" placeholder="Вставьте сюда (Ctrl+V)" required></textarea></div>' +
    '<div class="row" style="margin-top:16px"><button class="btn p" type="submit">Разобрать и сохранить</button></div></form></div>' +
    podskazki + unmatched;

  return await page({
    title: "Вставка результатов — YAMAGUCHI",
    h1: "Вставка результатов",
    sub: "Отчёт Borboza &middot; на " + today(),
    body: body,
  });
}

async function submit(f) {
  const act = String(f["do"] || "");
  try {
    if (act === "paste") {
      const status = normStatus(f.employment_status);
      const parsed = parseTable(f.raw);
      const period = String(f.period || "").trim() || parsed.period;
      const res = await saveRows(period, parsed.rows, String(f.author || "") || null, status);
      return { redirect: "/rookies?ok=" + encodeURIComponent(
        "Распознано " + res.total + " строк (" + statusLabel(status) + ") за " + res.period + ", наших карточек нашла " + res.matched) };
    }

    if (act === "set_rookies") {
      const ids = [].concat(f.ext_ids || []).filter(Boolean);
      if (!ids.length) return { redirect: "/rookies?err=" + encodeURIComponent("Никто не отмечен — поставьте галочки у нужных новичков") };
      const personIds = [];
      for (const ext of ids) {
        const { data, error } = await supa.rpc("podbor_person_from_rookie", { p_external_id: String(ext) });
        if (error) throw new Error("табельный " + ext + ": " + error.message);
        if (data) personIds.push(data);
      }
      if (!personIds.length) throw new Error("Не удалось собрать карточки");
      const title = String(f.title || "").trim() || ("Новички на " + today());
      const { data: st, error: e1 } = await supa.from("podbor_present_sets")
        .insert({ title: title,
                  area: String(f.area || "").trim() || null,
                  comment: String(f.comment || "").trim() || null })
        .select("id").single();
      if (e1) throw new Error(e1.message);
      const rows = personIds.map(function (pid, i) { return { set_id: st.id, person_id: pid, position: i }; });
      const { error: e2 } = await supa.from("podbor_present_items").insert(rows);
      if (e2) throw new Error(e2.message);
      return { redirect: "/present?set=" + st.id + "&ok=" +
        encodeURIComponent("Подборка собрана: " + rows.length) };
    }

    if (act === "match") {
      const ext = String(f.external_id || "");
      const pid = String(f.person_id || "");
      if (!ext || !pid) throw new Error("Нужны табельный номер и карточка");
      const e1 = await supa.from("podbor_people").update({
        external_id: ext, matched_by: "manual", matched_at: new Date().toISOString(),
      }).eq("id", pid);
      if (e1.error) throw new Error(e1.error.message);
      const e2 = await supa.from("kpi_monthly").update({ person_id: pid, unmatched: false }).eq("external_id", ext);
      if (e2.error) throw new Error(e2.error.message);
      return { redirect: "/rookies?import=1&ok=" + encodeURIComponent("Связано. Дальше этот человек будет находиться сам") };
    }
    return { redirect: "/rookies?err=" + encodeURIComponent("Неизвестное действие") };
  } catch (e) {
    const back = act === "set_rookies" ? "/rookies?err=" : "/rookies?import=1&err=";
    return { redirect: back + encodeURIComponent(String((e && e.message) || e)) };
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("hr-rookies жив", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  let b = {};
  try { b = await req.json(); } catch (_e) { b = {}; }
  if ((b.code || "") !== CODE) return Response.json({ error: "Неверный код доступа" }, { status: 403, headers: CORS });
  const q = b.qs || {};
  try {
    if (b.form) return Response.json(await submit(b.form), { headers: CORS });
    if (q.import) return Response.json({ html: await importPage(q) }, { headers: CORS });
    return Response.json({ html: await listPage(q) }, { headers: CORS });
  } catch (e) {
    const h = await page({ title: "Ошибка — YAMAGUCHI", h1: "Не удалось загрузить экран", body: '<div class="err">' + esc(String((e && e.message) || e)) + '</div><a class="btn" href="/rookies">Обновить</a>' });
    return Response.json({ html: h }, { headers: CORS });
  }
});
