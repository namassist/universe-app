/**
 * One named example of `GET /v1/me/shift` per state the operator's Beranda
 * draws (docs/prd.md, Mobile app → User; the "operator/beranda/*" frames).
 *
 * The app chooses its screen from `phase`, `status`, `reason`, `seat.source`,
 * `withdrawn` and `ftw.verdict`; each example is one such combination, as
 * `standing()` (`my-shift.ts`) produces it. `openapi-examples.test.ts`
 * checks every one against the route's own response schema.
 */

const GATES = {
  ftwDeadline: "05:00",
  fingerIn: "05:25",
  board: "05:26",
  secondFinger: "05:28",
  busDepart: "05:30",
};
const SEAT = {
  unit: "DT4023",
  area: "PIT 3 SELATAN",
  bus: "BUS 07",
  fleet: "EX1203",
};
const FTW_PASS = {
  verdict: "pass",
  sentAt: "2026-11-09 04:41:12",
  sleepMinutes: 405,
  category: "Dapat Bekerja",
};

const shift = (over: Record<string, unknown>) => ({
  shift: {
    date: "2026-11-09",
    shift: "day",
    roster: "D",
    phase: "plan",
    status: "holder",
    reason: null,
    refusal: null,
    planUnit: "DT4023",
    seat: { ...SEAT, source: null, placedAt: null },
    ftw: FTW_PASS,
    checkInAt: null,
    boardAt: null,
    withdrawn: null,
    gates: GATES,
    ...over,
  },
});

const BOARD = { phase: "board", boardAt: "2026-11-09T05:26:00.000Z" };

export const SHIFT_EXAMPLES: Record<
  string,
  { summary: string; value: unknown }
> = {
  "rencana-holder": {
    summary: "Before the board: holds their unit (Rencana, belum final)",
    value: shift({}),
  },
  "rencana-partner-dijadwalkan": {
    summary: "Before the board: holds their unit, partner rostered too",
    value: shift({ reason: "partner-rostered" }),
  },
  "rencana-breakdown": {
    summary: "Before the board: their unit is broken down, so SPARE",
    value: shift({ status: "spare", reason: "breakdown", seat: null }),
  },
  "rencana-tidak-masuk-fleet": {
    summary: "Before the board: their unit is not in the fleet, so SPARE",
    value: shift({ status: "spare", reason: "not-in-fleet", seat: null }),
  },
  "rencana-simper-tidak-berlaku": {
    summary: "Before the board: the unit refuses them, so SPARE",
    value: shift({
      status: "spare",
      reason: "ineligible",
      refusal: 'Tidak punya SIMPER "OHT 100T"',
      seat: null,
    }),
  },
  "rencana-tanpa-unit-pegangan": {
    summary: "Before the board: no unit of their own, SPARE",
    value: shift({
      status: "spare",
      reason: "no-plan-seat",
      planUnit: null,
      seat: null,
    }),
  },
  "rencana-ftw-terlambat": {
    summary: "Before the board: FTW uploaded after the deadline",
    value: shift({
      ftw: { ...FTW_PASS, verdict: "late", sentAt: "2026-11-09 05:07:30" },
    }),
  },
  "rencana-ftw-tidak-lolos": {
    summary: "Before the board: FTW did not pass",
    value: shift({
      ftw: {
        ...FTW_PASS,
        verdict: "fail",
        sleepMinutes: 250,
        category: "Istirahat Minimal 2 Jam",
      },
    }),
  },
  "rencana-ftw-tak-terbaca": {
    summary: "Before the board: savera sent a value that is not recognised",
    value: shift({
      ftw: { ...FTW_PASS, verdict: "unreadable", category: "Belum Dinilai" },
    }),
  },
  "rencana-ftw-lolos-finger": {
    summary: "Before the board: FTW passed and fingered in on time",
    value: shift({ checkInAt: "05:12:40" }),
  },
  "rencana-off": {
    summary: "Not rostered to this shift",
    value: shift({
      roster: "OFF",
      status: "off",
      seat: null,
      ftw: null,
    }),
  },
  "rencana-tidak-dialokasikan": {
    summary: "Not allocated: not aktif, or a position that takes no unit",
    value: shift({
      status: "not-allocated",
      planUnit: null,
      seat: null,
      ftw: null,
    }),
  },
  "papan-holder": {
    summary: "Board built: kept their unit",
    value: shift({
      ...BOARD,
      checkInAt: "05:12:40",
      seat: { ...SEAT, source: "plan", placedAt: null },
    }),
  },
  "papan-spare-menunggu-finger-kedua": {
    summary: "Board built: SPARE, waiting for the second finger",
    value: shift({
      ...BOARD,
      status: "spare",
      reason: "awaiting-second-finger",
      planUnit: null,
      seat: null,
      checkInAt: "05:12:40",
    }),
  },
  "papan-spare-dapat-kursi": {
    summary: "After the second finger: a spare given a unit",
    value: shift({
      ...BOARD,
      status: "spare",
      planUnit: null,
      checkInAt: "05:12:40",
      seat: { ...SEAT, unit: "DT4084", source: "spare", placedAt: null },
    }),
  },
  "papan-tidak-dapat-kursi": {
    summary: "After the second finger: a spare given no unit",
    value: shift({
      ...BOARD,
      status: "spare",
      reason: "not-seated",
      planUnit: null,
      seat: null,
      checkInAt: "05:12:40",
    }),
  },
  "penempatan-manual": {
    summary: "Placed on a unit by hand",
    value: shift({
      ...BOARD,
      status: "spare",
      planUnit: null,
      checkInAt: "05:29:10",
      seat: {
        ...SEAT,
        unit: "RD5053",
        fleet: "EX5001",
        area: "Pit Selatan",
        bus: "04",
        source: "manual",
        placedAt: "2026-11-09T05:41:00.000Z",
      },
    }),
  },
  "kursi-dicabut": {
    summary: "Their seat was taken back by a rebuilt board",
    value: shift({
      ...BOARD,
      boardAt: "2026-11-09T05:35:00.000Z",
      status: "spare",
      reason: "not-seated",
      seat: null,
      checkInAt: "05:12:40",
      withdrawn: {
        unit: "DT4023",
        at: "2026-11-09T05:35:00.000Z",
        cause: "regenerated",
        slipPrintedAt: "2026-11-09T05:06:00.000Z",
        unitStatus: { status: "breakdown", at: "2026-11-09T05:33:00.000Z" },
      },
    }),
  },
  "shift-tidak-ditentukan": {
    summary: "The timeline cannot say which shift is running",
    value: { shift: null },
  },
};
