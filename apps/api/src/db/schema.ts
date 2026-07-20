import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { USER_ROLES } from "@universe/contracts";

// Enum values come from contracts so db, API schema, and client cannot drift.
export const userRole = pgEnum("user_role", USER_ROLES);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
