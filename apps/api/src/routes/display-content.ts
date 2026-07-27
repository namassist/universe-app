/**
 * What a kiosk shows: the master running-text list, and the sounds.
 *
 * The per-device override half lives in `devices.ts`, next to the ownership
 * check it needs — a device's texts are governed by the menu owning that
 * device's *kind*, and that mapping is already there.
 */

import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { RunTextColor } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, schema, type RunTextRow, type SoundRow } from "../db";
import {
  deleteSound,
  MAX_SOUND_BYTES,
  soundPath,
  storedFileName,
  writeSound,
} from "../storage";
import {
  ErrorSchema,
  RunTextColorSchema,
  RunTextSchema,
  SoundSchema,
} from "./schemas";

const toRunText = (row: RunTextRow) => ({
  id: row.id,
  text: row.text,
  // `color` is text in the database (the palette is a code-level vocabulary,
  // not a migration), and validated against RUNTEXT_COLORS on the way in.
  color: row.color as RunTextColor,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

const runTextNotFound = {
  code: "run_text_not_found",
  message: "Running text tidak ditemukan",
};

export const runTextsRoutes = new Elysia({
  prefix: "/run-texts",
  tags: ["display"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query }) => {
      const rows = await db
        .select()
        .from(schema.runTexts)
        .where(
          query.active === undefined
            ? undefined
            : eq(schema.runTexts.active, query.active)
        )
        .orderBy(asc(schema.runTexts.createdAt));
      return rows.map(toRunText);
    },
    {
      auth: { menu: "running-text", mode: "view" },
      query: t.Object({ active: t.Optional(t.Boolean()) }),
      response: {
        200: t.Array(RunTextSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List the master running texts" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const text = body.text.trim();
      if (!text)
        return status(422, {
          code: "validation_failed",
          message: "Teks tidak boleh kosong",
        });
      const [row] = await db
        .insert(schema.runTexts)
        .values({ text, color: body.color, active: body.active ?? true })
        .returning();
      return status(201, toRunText(row!));
    },
    {
      auth: { menu: "running-text", mode: "manage" },
      // Required rather than optional: `t.Optional(t.UnionEnum([...]))` injects
      // the first value when the field is absent, which would silently make
      // every colourless text Cyan.
      body: t.Object({
        text: t.String({ minLength: 1 }),
        color: RunTextColorSchema,
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: RunTextSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Create a master running text" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [row] = await db
        .update(schema.runTexts)
        .set({
          ...(body.text !== undefined ? { text: body.text.trim() } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where(eq(schema.runTexts.id, params.id))
        .returning();
      if (!row) return status(404, runTextNotFound);
      return toRunText(row);
    },
    {
      auth: { menu: "running-text", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        text: t.Optional(t.String({ minLength: 1 })),
        color: t.Optional(
          t.Union([
            t.Literal("Cyan"),
            t.Literal("Oranye"),
            t.Literal("Putih"),
            t.Literal("Merah"),
          ])
        ),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: RunTextSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Edit a master running text" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .delete(schema.runTexts)
        .where(eq(schema.runTexts.id, params.id))
        .returning({ id: schema.runTexts.id });
      if (!row) return status(404, runTextNotFound);
      return { ok: true };
    },
    {
      auth: { menu: "running-text", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Delete a master running text" },
    }
  );

/* ---------------------------------------------------------------- sounds */

const toSound = (row: SoundRow) => ({
  id: row.id,
  name: row.name,
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

const soundNotFound = {
  code: "sound_not_found",
  message: "Sound tidak ditemukan",
};

export const soundsRoutes = new Elysia({ prefix: "/sounds", tags: ["sounds"] })
  .use(requireAuth)

  .get(
    "/",
    async ({ query }) => {
      const rows = await db
        .select()
        .from(schema.sounds)
        .where(
          query.active === undefined
            ? undefined
            : eq(schema.sounds.active, query.active)
        )
        .orderBy(asc(schema.sounds.name));
      return rows.map(toSound);
    },
    {
      auth: { menu: "sound", mode: "view" },
      query: t.Object({ active: t.Optional(t.Boolean()) }),
      response: {
        200: t.Array(SoundSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List sounds" },
    }
  )

  /**
   * Streamed rather than read: `Bun.file` is a lazy handle, so the bytes go
   * from the page cache to the socket without passing through this process's
   * heap (design D7). Reading it into a Buffer first would put every
   * simultaneous playback's worth of audio in memory for no gain.
   */
  .get(
    "/:id/file",
    async ({ params, status }) => {
      const [row] = await db
        .select()
        .from(schema.sounds)
        .where(eq(schema.sounds.id, params.id))
        .limit(1);
      if (!row) return status(404, soundNotFound);

      const file = Bun.file(soundPath(row.fileName));
      if (!(await file.exists())) return status(404, soundNotFound);
      return new Response(file, {
        headers: { "content-type": row.mimeType },
      });
    },
    {
      auth: { menu: "sound", mode: "view" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      // No 200 schema: the body is audio, and declaring a JSON shape for it
      // would have Elysia try to validate bytes as an object.
      response: { 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      detail: { summary: "Stream a sound's audio" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const file = body.file;
      // Worth knowing: Bun derives `File.type` from the *filename extension*,
      // not from the part's Content-Type header — a `.wav` sent as text/plain
      // still arrives as audio/x-wav, and an extensionless name arrives as "".
      // That is the stronger of the two, since a client cannot talk its way
      // past it by asserting a type, and it is why the check reads this way.
      if (!file.type.startsWith("audio/"))
        return status(422, {
          code: "unsupported_media_type",
          message: `Tipe berkas "${file.type || "tidak diketahui"}" bukan audio`,
        });
      if (file.size > MAX_SOUND_BYTES)
        return status(422, {
          code: "file_too_large",
          message: `Berkas melebihi ${MAX_SOUND_BYTES / (1024 * 1024)} MB`,
        });

      // Generated, never the client's — see `storedFileName`. The client's name
      // contributes at most a vetted extension, so `../../etc/passwd` writes a
      // UUID inside SOUND_DIR and nothing else.
      const fileName = storedFileName(file.name);
      await writeSound(fileName, await file.arrayBuffer());

      const [row] = await db
        .insert(schema.sounds)
        .values({
          name: body.name.trim(),
          fileName,
          mimeType: file.type,
          sizeBytes: file.size,
          active: true,
        })
        .returning();
      return status(201, toSound(row!));
    },
    {
      auth: { menu: "sound", mode: "manage" },
      body: t.Object({
        name: t.String({ minLength: 1 }),
        file: t.File(),
      }),
      response: {
        201: SoundSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Upload a sound" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [row] = await db
        .update(schema.sounds)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where(eq(schema.sounds.id, params.id))
        .returning();
      if (!row) return status(404, soundNotFound);
      return toSound(row);
    },
    {
      auth: { menu: "sound", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: SoundSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Rename or activate/deactivate a sound" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .delete(schema.sounds)
        .where(eq(schema.sounds.id, params.id))
        .returning({ fileName: schema.sounds.fileName });
      if (!row) return status(404, soundNotFound);
      // The row is the only reference to the file, so it goes with the row —
      // otherwise SOUND_DIR accumulates audio nothing can name or play.
      await deleteSound(row.fileName);
      return { ok: true };
    },
    {
      auth: { menu: "sound", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Delete a sound and its stored file" },
    }
  );
