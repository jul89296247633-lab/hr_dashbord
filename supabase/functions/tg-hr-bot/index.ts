import { createClient } from "npm:@supabase/supabase-js@2";

function requireEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(name + " is required");
  return value;
}

/* tg-hr-bot — бот для HR: фото + описание кандидата → карточка в базе.
   Это webhook Telegram — деплоить только с verify_jwt = false, иначе Telegram получит 401
   и бот замолчит целиком.

   v2: только личная переписка — в группах бот молчит и ничего не пишет в базу.
   v3: регистрация по отдельному коду из podbor_settings.bot_invite_code.
   v4: карточка подписывается HR-менеджером — тем, кто её прислал.
   v5: команда /имя — HR сам задаёт свою подпись, без администратора.
   v6: webhook защищён секретом.

       До v6 функция принимала POST от кого угодно: любой, кто знает адрес, мог
       прислать поддельный апдейт от имени любого telegram_id из белого списка
       и завести карточку или переименовать HR. Теперь Telegram присылает заголовок
       X-Telegram-Bot-Api-Secret-Token, и без него апдейт не разбирается.
       Секрет лежит в podbor_settings.tg_webhook_secret и нигде больше не появляется.

       Регистрация webhook делается самой функцией, чтобы секрет не выходил наружу:
         POST {"code":"<код доступа>","admin":"setup_webhook"}
       Ответ показывает состояние webhook без самого секрета.
       Если бот вдруг замолчал после деплоя — просто повторить этот запрос. */

const ACCESS_CODE = requireEnv("HH_UI_CODE");
const SELF_URL = "https://twfmfmkqfhclzvdogvix.supabase.co/functions/v1/tg-hr-bot";

const supa = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

async function setting(key) {
  const { data } = await supa.from("podbor_settings").select("value").eq("key", key).maybeSingle();
  return data && data.value;
}

async function inviteCode() {
  const v = await setting("bot_invite_code");
  return (v && String(v).trim()) || ACCESS_CODE;
}

async function webhookSecret() {
  const v = await setting("tg_webhook_secret");
  return v ? String(v).trim() : "";
}

let TOKEN = null;
async function tg(method, payload) {
  if (!TOKEN) TOKEN = await setting("telegram_bot_token");
  const r = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await r.json().catch(() => ({}));
}

async function say(chat_id, text, extra) {
  return await tg("sendMessage", Object.assign({ chat_id, text, parse_mode: "HTML" }, extra || {}));
}

function isPrivate(chat) {
  return !!chat && chat.type === "private";
}

/* ---------- доступ ---------- */

async function getUser(tgUser) {
  const { data } = await supa.from("podbor_bot_users")
    .select("*").eq("telegram_id", tgUser.id).maybeSingle();
  return data;
}

async function addUser(tgUser) {
  const { count } = await supa.from("podbor_bot_users")
    .select("telegram_id", { count: "exact", head: true });
  const first = (count || 0) === 0;
  const row = {
    telegram_id: tgUser.id,
    full_name: fromTelegram(tgUser) || "HR (имя уточнить)",
    username: tgUser.username || null,
    is_admin: first,
    is_active: true,
    added_by: first ? "self (первый вход)" : "сам по коду приглашения",
  };
  await supa.from("podbor_bot_users").upsert(row, { onConflict: "telegram_id" });
  return row;
}

/* Подпись HR под карточкой. */
function looksLikePlaceholder(name) {
  const s = String(name || "").trim();
  return !s || /уточнить|^HR\b|^Тест/i.test(s);
}

/* Из профиля Telegram — только полное имя, и сразу в принятом порядке «Фамилия Имя».
   Если фамилии в профиле нет — возвращаем пустоту, чтобы заглушка осталась видной. */
function fromTelegram(tgUser) {
  const first = String((tgUser && tgUser.first_name) || "").trim();
  const last = String((tgUser && tgUser.last_name) || "").trim();
  if (!first || !last) return "";
  return last + " " + first;
}

async function hrSignature(user, tgUser) {
  if (!looksLikePlaceholder(user && user.full_name)) return String(user.full_name).trim();
  const guess = fromTelegram(tgUser);
  if (guess) {
    await supa.from("podbor_bot_users")
      .update({ full_name: guess, username: (tgUser && tgUser.username) || null })
      .eq("telegram_id", user.telegram_id);
    return guess;
  }
  return null;
}

/* Команда /имя. Проверки намеренно строгие: это имя уйдёт в презентацию для руководства. */
function validName(s) {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  if (v.length < 4 || v.length > 60) return null;
  if (!/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\-’' ]+$/.test(v)) return null;
  if (v.split(" ").filter(Boolean).length < 2) return null;
  return v;
}

/* ---------- черновики ---------- */

async function getDraft(id) {
  const { data } = await supa.from("podbor_bot_drafts").select("*").eq("telegram_id", id).maybeSingle();
  return data;
}
async function setDraft(id, patch) {
  const row = Object.assign({ telegram_id: id, updated_at: new Date().toISOString() }, patch);
  await supa.from("podbor_bot_drafts").upsert(row, { onConflict: "telegram_id" });
}
async function dropDraft(id) {
  await supa.from("podbor_bot_drafts").delete().eq("telegram_id", id);
}

/* ---------- фото ---------- */

async function savePhoto(fileId, tgId) {
  if (!TOKEN) TOKEN = await setting("telegram_bot_token");
  const f = await tg("getFile", { file_id: fileId });
  const path = f && f.result && f.result.file_path;
  if (!path) throw new Error("не удалось забрать фото из Telegram");
  const bin = await fetch("https://api.telegram.org/file/bot" + TOKEN + "/" + path);
  const buf = new Uint8Array(await bin.arrayBuffer());
  const key = "inbox/" + tgId + "-" + Date.now() + ".jpg";
  const { error } = await supa.storage.from("candidates")
    .upload(key, buf, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error("фото не сохранилось: " + error.message);
  return key;
}

/* ---------- разбор текста ---------- */

function fingerprint(name) {
  return String(name || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

async function parseText(text) {
  const key = await setting("anthropic_key");
  const model = (await setting("model")) || "claude-sonnet-4-5";
  const today = new Date().toISOString().slice(0, 10);
  if (!key) return null;
  const prompt = [
    "Разбери сообщение HR о кандидате в JSON. Сегодня " + today + ".",
    "Поля: full_name (ФИО), internship_on (дата выхода на стажировку в формате YYYY-MM-DD),",
    "city (город), age (число), description (остальной текст описания), missing (массив имён полей, которых нет).",
    "Если год в дате не указан — бери ближайший будущий или текущий. Ответ — только JSON, без пояснений.",
    "Сообщение:", text,
  ].join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model, max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const j = await r.json().catch(() => null);
  const out = j && j.content && j.content[0] && j.content[0].text;
  if (!out) return null;
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_e) { return null; }
}

function card(p, hr) {
  const L = ["<b>Разобрала так:</b>"];
  L.push("ФИО: " + (p.full_name || "—"));
  L.push("Стажировка с: " + (p.internship_on || "—"));
  L.push("Город: " + (p.city || "—"));
  L.push("Возраст: " + (p.age || "—"));
  L.push("Описание: " + (p.description ? p.description.slice(0, 400) : "—"));
  L.push(hr ? "Подпишу как: <b>" + hr + "</b>"
            : "Подпись HR не задана — пришлите <code>/имя Фамилия Имя</code>");
  return L.join("\n");
}

const CONFIRM = {
  reply_markup: {
    inline_keyboard: [[
      { text: "✅ Всё верно", callback_data: "ok" },
      { text: "✏️ Исправить", callback_data: "edit" },
      { text: "❌ Отмена", callback_data: "cancel" },
    ]],
  },
};

async function showDraft(chatId, draft, hr) {
  const p = draft.parsed || {};
  const miss = [];
  if (!p.full_name) miss.push("ФИО");
  if (!p.internship_on) miss.push("дата выхода на стажировку");
  if (!p.city) miss.push("город");
  let t = card(p, hr);
  if (!draft.photo_path) t += "\n\n⚠️ Фото пока нет — пришлите картинкой, если есть.";
  if (miss.length) t += "\n\nНе хватает: " + miss.join(", ") + ". Напишите одним сообщением — добавлю.";
  await say(chatId, t, CONFIRM);
}

async function createPerson(draft, user, hr) {
  const p = draft.parsed || {};
  const row = {
    full_name: p.full_name,
    fingerprint: fingerprint(p.full_name),
    city: p.city || null,
    age: p.age ? parseInt(p.age) : null,
    description: p.description || null,
    photo_path: draft.photo_path || null,
    internship_on: p.internship_on || null,
    source: "bot",
    hr_manager: hr || null,
    author_tg: user.telegram_id,
    author_email: user.email || null,
  };
  const { data, error } = await supa.from("podbor_people").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/* ---------- обработчик ---------- */

const HELP = [
  "Это бот подбора YAMAGUCHI.",
  "",
  "Пришлите <b>фото с подписью</b> или просто текст, например:",
  "<i>Иванова Анна, выход на стажировку 12.08, Казань, 27 лет. Три года в рознице, спокойная, хорошо говорит.</i>",
  "",
  "Я покажу, что поняла, и создам карточку после вашего подтверждения.",
  "Карточка подпишется вашим именем — в презентации кандидаты сгруппированы по HR-менеджерам.",
  "",
  "Команды:",
  "<code>/имя Фамилия Имя</code> — задать свою подпись",
  "<code>/кто</code> — как я вас подписываю",
  "<code>/list</code> — последние карточки",
  "<code>/cancel</code> — сбросить черновик",
].join("\n");

async function handleUpdate(u) {
  if (u.callback_query) {
    const cq = u.callback_query;
    if (!cq.message || !isPrivate(cq.message.chat)) return;
    const chatId = cq.message.chat.id;
    const user = await getUser(cq.from);
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    if (!user || !user.is_active) return;
    const draft = await getDraft(cq.from.id);
    if (!draft) { await say(chatId, "Черновик уже пуст. Пришлите фото и описание заново."); return; }
    if (cq.data === "cancel") { await dropDraft(cq.from.id); await say(chatId, "Отменила, черновик удалён."); return; }
    if (cq.data === "edit") { await say(chatId, "Что поправить? Напишите одним сообщением, например: «город Уфа, возраст 29»."); return; }
    if (cq.data === "ok") {
      const p = draft.parsed || {};
      if (!p.full_name) { await say(chatId, "Без ФИО карточку не создам. Напишите имя и фамилию."); return; }
      try {
        const hr = await hrSignature(user, cq.from);
        const id = await createPerson(draft, user, hr);
        await dropDraft(cq.from.id);
        await say(chatId, "✅ Карточка создана: <b>" + p.full_name + "</b>" +
          (hr ? "\nПодписана: " + hr
              : "\n⚠️ Без подписи HR. Пришлите <code>/имя Фамилия Имя</code> — подпись встанет и на эту карточку.") +
          "\nОна появится в презентации на hr.tools.rlevelai.ru\n<code>" + id + "</code>");
      } catch (e) {
        await say(chatId, "Не смогла сохранить: " + String(e.message || e));
      }
      return;
    }
    return;
  }

  const msg = u.message || u.edited_message;
  if (!msg) return;
  if (!isPrivate(msg.chat)) return;

  const chatId = msg.chat.id;
  const from = msg.from;
  if (!from || from.is_bot) return;
  const text = (msg.text || msg.caption || "").trim();
  const low = text.toLowerCase();

  let user = await getUser(from);
  if (!user || !user.is_active) {
    if (low.startsWith("/start")) {
      const code = text.split(/\s+/)[1] || "";
      const expected = await inviteCode();
      if (code && code === expected) {
        user = await addUser(from);
        await say(chatId, "Готово, доступ открыт.\n\n" + HELP);
        return;
      }
      await say(chatId, "Чтобы начать, пришлите <code>/start КОД</code> — код выдаёт администратор подбора.\n" +
        "Ваш ID для администратора: <code>" + from.id + "</code>");
      return;
    }
    await say(chatId, "Вас нет в списке. Пришлите <code>/start КОД</code> — код выдаёт администратор подбора.\n" +
      "Ваш ID: <code>" + from.id + "</code>");
    return;
  }

  if (low.startsWith("/имя") || low.startsWith("/name")) {
    const raw = text.replace(/^\/(имя|name)\s*/i, "");
    const name = validName(raw);
    if (!name) {
      await say(chatId, "Напишите так: <code>/имя Артюхова Анастасия</code>\n" +
        "Фамилия и имя, без цифр и скобок. Эта подпись видна руководству в презентации.");
      return;
    }
    await supa.from("podbor_bot_users")
      .update({ full_name: name, username: from.username || null })
      .eq("telegram_id", from.id);
    await say(chatId, "Записала: <b>" + name + "</b>.\n" +
      "Подпись обновится сразу на всех ваших карточках, включая старые.");
    return;
  }

  if (low.startsWith("/кто") || low.startsWith("/kto")) {
    const hr = await hrSignature(user, from);
    await say(chatId, hr
      ? "Карточки от вас подписываются: <b>" + hr + "</b>.\n" +
        "Нужно иначе — пришлите <code>/имя Фамилия Имя</code>."
      : "Подпись пока не задана. Пришлите <code>/имя Фамилия Имя</code> — и карточки подпишутся.");
    return;
  }
  if (low.startsWith("/start") || low.startsWith("/help")) {
    await say(chatId, HELP); return;
  }
  if (low.startsWith("/cancel")) {
    await dropDraft(from.id); await say(chatId, "Черновик сброшен."); return;
  }
  if (low.startsWith("/list")) {
    const { data } = await supa.from("podbor_people")
      .select("full_name,city,internship_on,hr_manager,created_at")
      .order("created_at", { ascending: false }).limit(10);
    if (!data || !data.length) { await say(chatId, "Карточек пока нет."); return; }
    await say(chatId, "<b>Последние карточки:</b>\n" + data.map((p) =>
      "• " + p.full_name + (p.city ? ", " + p.city : "") +
      (p.hr_manager ? " — " + p.hr_manager : "")).join("\n"));
    return;
  }

  const draft = (await getDraft(from.id)) || {};

  if (msg.photo && msg.photo.length) {
    try {
      const best = msg.photo[msg.photo.length - 1];
      const key = await savePhoto(best.file_id, from.id);
      draft.photo_path = key;
      await setDraft(from.id, { photo_path: key });
    } catch (e) {
      await say(chatId, "Фото не сохранилось: " + String(e.message || e));
    }
  }

  if (text) {
    const merged = ((draft.raw_text ? draft.raw_text + "\n" : "") + text).slice(0, 4000);
    let parsed = await parseText(merged);
    if (!parsed) {
      const age = (merged.match(/(\b\d{2})\s*(?:лет|год|года)/) || [])[1];
      const date = (merged.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/) || []);
      parsed = Object.assign({}, draft.parsed || {}, {
        full_name: (draft.parsed && draft.parsed.full_name) ||
                   (merged.match(/^([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/) || [])[1] || null,
        age: age ? parseInt(age) : (draft.parsed && draft.parsed.age) || null,
        internship_on: date[1]
          ? [date[3] ? (date[3].length === 2 ? "20" + date[3] : date[3]) : new Date().getFullYear(),
             String(date[2]).padStart(2, "0"), String(date[1]).padStart(2, "0")].join("-")
          : (draft.parsed && draft.parsed.internship_on) || null,
        description: merged,
      });
    } else if (draft.parsed) {
      parsed = Object.assign({}, draft.parsed, Object.fromEntries(
        Object.entries(parsed).filter(([_k, v]) => v !== null && v !== "" && v !== undefined)));
    }
    await setDraft(from.id, { raw_text: merged, parsed });
    const hr = await hrSignature(user, from);
    await showDraft(chatId, { parsed, photo_path: draft.photo_path }, hr);
    return;
  }

  if (msg.photo) {
    await say(chatId, "Фото приняла. Теперь пришлите данные: ФИО, дата выхода на стажировку, город, возраст, описание.");
    return;
  }

  await say(chatId, HELP);
}

/* Регистрация webhook с секретом. Секрет наружу не возвращается. */
async function setupWebhook() {
  const secret = await webhookSecret();
  if (!secret) return { ok: false, error: "в podbor_settings нет tg_webhook_secret" };
  const set = await tg("setWebhook", {
    url: SELF_URL,
    secret_token: secret,
    allowed_updates: ["message", "edited_message", "callback_query"],
  });
  const info = await tg("getWebhookInfo", {});
  const r = (info && info.result) || {};
  return {
    ok: !!(set && set.ok),
    url: r.url,
    pending_update_count: r.pending_update_count,
    last_error_message: r.last_error_message || null,
    secret_ustanovlen: true,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("tg-hr-bot жив", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  let u = {};
  try { u = await req.json(); } catch (_e) { u = {}; }

  // Служебное действие: перерегистрировать webhook с секретом.
  if (u && u.admin === "setup_webhook") {
    if ((u.code || "") !== ACCESS_CODE) {
      return Response.json({ error: "Неверный код доступа" }, { status: 403 });
    }
    try {
      return Response.json(await setupWebhook());
    } catch (e) {
      return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
    }
  }

  // Всё остальное — только от Telegram, с секретным заголовком.
  const expected = await webhookSecret();
  const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!expected || got !== expected) {
    console.warn("tg-hr-bot: отклонён POST без верного секретного заголовка");
    return new Response("forbidden", { status: 403 });
  }

  try {
    await handleUpdate(u);
  } catch (e) {
    console.error("bot error", e);
  }
  return new Response("ok");
});
