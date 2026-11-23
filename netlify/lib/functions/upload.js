import { randomUUID } from "node:crypto";
import {
  MAX_BYTES,
  EXT,
  DECLARED_OK,
  json,
  fail,
  clean,
  isEmail,
  sniffType,
  stores,
} from "../lib/common.js";

export const config = {
  path: "/api/upload",
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: ["ip", "domain"] },
};

export default async (req) => {
  if (req.method !== "POST") {
    return json({ ok: false, code: "bad_method", error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_BYTES + 512 * 1024) {
    return fail("photo_too_large", "The photo is larger than 4 MB.", 413);
  }

  try {
    let form;
    try {
      form = await req.formData();
    } catch {
      return fail("bad_form", "Could not read the submitted form.");
    }

    if (clean(form.get("website"), 50)) {
      return json({ ok: true, id: "ok" }, 201);
    }

    const name = clean(form.get("name"), 100);
    const contest = clean(form.get("contest"), 100);
    const email = clean(form.get("email"), 254).toLowerCase();
    const caption = clean(form.get("caption"), 500);

    const fields = {};
    if (name.length < 2) fields.name = "name_required";
    if (!contest) fields.contest = "contest_required";
    if (!isEmail(email)) fields.email = "email_invalid";
    if (Object.keys(fields).length) {
      return fail("invalid_fields", "Please check the highlighted fields.", 400, { fields });
    }

    const file = form.get("photo");
    if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) {
      return fail("photo_required", "Please choose a photo.");
    }
    if (file.size > MAX_BYTES) {
      return fail("photo_too_large", "The photo is larger than 4 MB.", 413);
    }
    if (file.type && !DECLARED_OK.has(file.type.toLowerCase())) {
      return fail("photo_type", "Only JPEG, PNG, WebP or HEIC photos are accepted.", 415);
    }

    const buffer = await file.arrayBuffer();
    const type = sniffType(new Uint8Array(buffer));
    if (!type) {
      return fail("photo_type", "Only JPEG, PNG, WebP or HEIC photos are accepted.", 415);
    }

    const id = `${Date.now()}-${randomUUID()}`;
    const key = `${id}.${EXT[type]}`;
    const record = {
      id,
      key,
      name,
      contest,
      email,
      caption,
      contentType: type,
      size: buffer.byteLength,
      createdAt: new Date().toISOString(),
    };

    const { photos, meta } = stores();
    await photos.set(key, buffer, { metadata: { contentType: type } });
    try {
      await meta.setJSON(id, record);
    } catch (err) {
      await photos.delete(key).catch(() => {});
      throw err;
    }

    return json({ ok: true, id }, 201);
  } catch (err) {
    console.error("upload failed", err);
    return fail("server_error", "Something went wrong on our side. Please try again.", 500);
  }
};