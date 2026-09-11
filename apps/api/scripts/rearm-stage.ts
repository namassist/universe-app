/**
 * Let a stage fire again today.
 *
 * A stage fires once per day. The scheduler claims `stage:<id>:<date>` in
 * Redis with `SET NX EX` before it dispatches, and that key is what stops a
 * second process — or a restart — running the same stage twice. Which is
 * right in production and inconvenient while testing: once Validasi Spare has
 * run this morning, moving its time does nothing, because the claim does not
 * move with it. That surprised us during the 2026-09-12 test.
 *
 * This drops today's claim so the stage becomes eligible again. It changes no
 * schedule and no data — the next tick sees a due, unclaimed stage and fires
 * it, exactly as it would have the first time.
 *
 *   bun run stage:rearm spare-validate day
 *   bun run stage:rearm spare-validate        # both shifts
 *
 * Re-running a stage re-runs its work. For an allocation that is the point;
 * think before doing it to an ingest that writes.
 *
 * Refuses to run against production, which has no business being re-armed by
 * hand.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import { timelineStages } from "../src/db/schema";
import { env } from "../src/env";
import { redis } from "../src/redis";
import { localDate } from "../src/scheduler";

if (env.NODE_ENV === "production") {
  console.error("tidak untuk production.");
  process.exit(1);
}

const [action, shift] = process.argv.slice(2);

if (!action) {
  console.error(
    "pakai: bun run stage:rearm <action> [day|night]\n" +
      "contoh: bun run stage:rearm spare-validate day"
  );
  process.exit(1);
}

const stages = await db
  .select()
  .from(timelineStages)
  .where(
    shift
      ? and(
          eq(timelineStages.action, action as never),
          eq(timelineStages.shift, shift as never)
        )
      : eq(timelineStages.action, action as never)
  );

if (stages.length === 0) {
  console.error(
    `tidak ada stage "${action}"${shift ? ` shift ${shift}` : ""}.`
  );
  process.exit(1);
}

const date = localDate(new Date());

for (const stage of stages) {
  const key = `stage:${stage.id}:${date}`;
  const removed = await redis.del(key);
  console.log(
    removed
      ? `${stage.at} ${stage.name} — klaim ${date} dihapus, akan menyala lagi`
      : `${stage.at} ${stage.name} — belum menyala hari ini, tidak ada yang perlu dihapus`
  );
}

process.exit(0);
