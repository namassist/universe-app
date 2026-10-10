-- "Active" becomes the only switch, and it now means listened to live, which
-- sends enableDevice and prints tickets. Only a machine that was already all
-- three — active, an operator booth, and Universe's own — may keep it; every
-- other one (ShiftCorner's included) starts inactive, the safe direction.
UPDATE "fingerprint_machines" SET "active" = ("active" AND "operator_booth" AND "universe_only");--> statement-breakpoint
ALTER TABLE "fingerprint_machines" DROP COLUMN "operator_booth";--> statement-breakpoint
ALTER TABLE "fingerprint_machines" DROP COLUMN "universe_only";
