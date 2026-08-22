import { createClient } from "npm:@supabase/supabase-js@2";

function requireEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(name + " is required");
  return value;
}

/* hr-present — данные для экрана презентаций: люди, подборки, публикация.
   Фото хранятся в бакете candidates, наружу уходят публичные ссылки.

   v2: срок жизни подписи поднят с 1 часа до 7 суток.
   v4: фото отдаются публичными URL bucket candidates вместо signed URL.
   Почему: signed URL вшивается в HTML и может отваливаться в браузере как
   ERR_CONNECTION_RESET/ERR_HTTP2_PING_FAILED, хотя файл и права на месте.

   v3: в действии people отдаются hr_manager и author_tg — чтобы на внутреннем экране
   было видно, чей кандидат. В действии public_set этих полей нет и быть не должно. */

const ACCESS_CODE = requireEnv("HH_UI_CODE");
const supa = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

function publicPhotoUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(String(path))) return String(path);
  return "/api/photo?path=" + encodeURIComponent(String(path));
}

async function photoUrls(paths) {
  const map = {};
  const uniq = Array.from(new Set(paths.filter(Boolean)));
  uniq.forEach((p) => { map[p] = publicPhotoUrl(p); });
  return map;
}

async function withPhotos(rows) {
  const map = await photoUrls(rows.map((r) => r.photo_path));
  return rows.map((r) => Object.assign({}, r, { photo_url: r.photo_path ? map[r.photo_path] || null : null }));
}

function token() {
  return crypto.randomUUID().replace(/-/g, "") + Math.random().toString(36).slice(2, 10);
}

async function handle(b) {
  const a = b.action;

  if (a === "people") {
    const { data, error } = await supa.from("podbor_people")
      .select("id,full_name,city,age,description,photo_path,internship_on,created_at,hr_manager,author_tg,external_id")
      .eq("archived", false).not("photo_path", "is", null)
      .order("created_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return { items: await withPhotos(data || []) };
  }

  if (a === "hr_names") {
    const { data, error } = await supa.from("podbor_bot_users").select("telegram_id,full_name");
    if (error) throw new Error(error.message);
    return { items: data || [] };
  }

  if (a === "sets") {
    const { data, error } = await supa.from("podbor_present_sets")
      .select("*, podbor_present_items(count)").order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return { items: (data || []).map((s) => Object.assign({}, s, {
      items_count: (s.podbor_present_items && s.podbor_present_items[0] && s.podbor_present_items[0].count) || 0,
      podbor_present_items: undefined,
    })) };
  }

  if (a === "create_set") {
    const row = {
      title: String(b.title || "Новая подборка").slice(0, 200),
      vacancy_name: b.vacancy_name || null,
      area: b.area || null,
      author_email: b.author_email || null,
    };
    const { data, error } = await supa.from("podbor_present_sets").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return { set: data };
  }

  if (a === "set" || a === "public_set") {
    let q = supa.from("podbor_present_sets").select("*");
    q = a === "public_set" ? q.eq("public_token", String(b.token || "")) : q.eq("id", String(b.set_id || ""));
    const { data: set, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    if (!set) return { set: null, items: [] };
    const cols = a === "public_set"
      ? "id,full_name,city,age,description,photo_path,internship_on"
      : "id,full_name,city,age,description,photo_path,internship_on,hr_manager,author_tg,external_id";
    const { data: items } = await supa.from("podbor_present_items")
      .select("id,note,position,person_id,podbor_people(" + cols + ")")
      .eq("set_id", set.id).order("position");
    const flat = (items || []).map((i) => Object.assign({}, i.podbor_people, {
      item_id: i.id, note: i.note, position: i.position,
    }));
    return { set, items: await withPhotos(flat) };
  }

  if (a === "add") {
    const ids = Array.isArray(b.person_ids) ? b.person_ids : [b.person_id];
    const { data: max } = await supa.from("podbor_present_items")
      .select("position").eq("set_id", b.set_id).order("position", { ascending: false }).limit(1);
    let pos = (max && max[0] ? max[0].position : -1) + 1;
    const rows = ids.filter(Boolean).map((pid) => ({ set_id: b.set_id, person_id: pid, position: pos++ }));
    const { error } = await supa.from("podbor_present_items")
      .upsert(rows, { onConflict: "set_id,person_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { added: rows.length };
  }

  if (a === "remove") {
    const { error } = await supa.from("podbor_present_items").delete().eq("id", b.item_id);
    if (error) throw new Error(error.message);
    return { removed: true };
  }

  if (a === "reorder") {
    const order = Array.isArray(b.item_ids) ? b.item_ids : [];
    for (let i = 0; i < order.length; i++) {
      await supa.from("podbor_present_items").update({ position: i }).eq("id", order[i]);
    }
    return { ok: true };
  }

  if (a === "update_person") {
    const patch = {};
    ["full_name", "city", "description", "hr_manager"].forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
    if (b.age !== undefined) patch.age = b.age ? parseInt(b.age) : null;
    if (b.internship_on !== undefined) patch.internship_on = b.internship_on || null;
    const { error } = await supa.from("podbor_people").update(patch).eq("id", b.person_id);
    if (error) throw new Error(error.message);
    return { saved: true };
  }

  if (a === "archive_person") {
    const personId = String(b.person_id || "").trim();
    if (!personId) throw new Error("Не указана карточка кандидата");

    const { data: person, error: readError } = await supa.from("podbor_people")
      .select("id,external_id,archived").eq("id", personId).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!person) throw new Error("Карточка кандидата не найдена");
    if (person.external_id) {
      throw new Error("Кандидат уже подтверждён в Borboza и не может быть убран этим действием");
    }
    if (person.archived) return { archived: true };

    const { data: archived, error } = await supa.from("podbor_people")
      .update({ archived: true }).eq("id", personId).is("external_id", null)
      .select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!archived) {
      throw new Error("Карточка уже подтверждена в Borboza; обновите список");
    }
    return { archived: true };
  }

  if (a === "update_set") {
    const patch = {};
    ["title", "vacancy_name", "area", "comment"].forEach((k) => { if (b[k] !== undefined) patch[k] = b[k]; });
    const { error } = await supa.from("podbor_present_sets").update(patch).eq("id", b.set_id);
    if (error) throw new Error(error.message);
    return { saved: true };
  }

  if (a === "publish") {
    const t = token();
    const { error } = await supa.from("podbor_present_sets")
      .update({ public_token: t, published_at: new Date().toISOString() }).eq("id", b.set_id);
    if (error) throw new Error(error.message);
    return { token: t };
  }

  if (a === "unpublish") {
    const { error } = await supa.from("podbor_present_sets")
      .update({ public_token: null, published_at: null }).eq("id", b.set_id);
    if (error) throw new Error(error.message);
    return { unpublished: true };
  }

  if (a === "delete_set") {
    const { error } = await supa.from("podbor_present_sets").delete().eq("id", b.set_id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }

  throw new Error("Неизвестное действие: " + a);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("hr-present жив", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  let b = {};
  try { b = await req.json(); } catch (_e) { b = {}; }
  if ((b.code || "") !== ACCESS_CODE) {
    return Response.json({ error: "Неверный код доступа" }, { status: 403, headers: CORS });
  }
  try {
    return Response.json(await handle(b), { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e && e.message || e) }, { status: 500, headers: CORS });
  }
});
