/**
 * Issuing a ticket end to end, minus the printer.
 *
 * The decision and the layout have their own suites; what is proven here is
 * the order of operations — that the row is claimed before anything prints, so
 * a double tap cannot produce two slips, and that a refused printer leaves a
 * failed row somebody can act on rather than a silence.
 *
 * Needs the dev Postgres and a seeded register:
 *   bun --env-file=.env test src/ticket-issue.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { firstTapOf, issueTicket, roleOf, seatOf } from "./ticket-issue";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Tiket ${uid()}`;
const ip = `203.0.113.${90 + Math.floor(Math.random() * 8)}`;
/* A second booth on the same site, with its own printer. */
const otherIp = `203.0.113.${100 + Math.floor(Math.random() * 8)}`;

const made = {
  machines: [] as string[],
  printers: [] as string[],
  niks: [] as string[],
};
let nik = "";

beforeAll(async () => {
  const [person] = await db
    .select({ nik: schema.employees.nik })
    .from(schema.employees)
    .limit(1);
  nik = person?.nik ?? "";
  expect(nik).not.toBe("");
  made.niks.push(nik);

  const [printer] = await db
    .insert(schema.printers)
    .values({ name: `${tag} PRINTER`, ip: "203.0.113.200" })
    .returning({ id: schema.printers.id });
  made.printers.push(printer!.id);

  const [machine] = await db
    .insert(schema.fingerprintMachines)
    .values({ name: tag, ip, printerId: printer!.id, universeOnly: true })
    .returning({ id: schema.fingerprintMachines.id });
  made.machines.push(machine!.id);

  const [otherPrinter] = await db
    .insert(schema.printers)
    .values({ name: `${tag} PRINTER LAIN`, ip: "203.0.113.201" })
    .returning({ id: schema.printers.id });
  made.printers.push(otherPrinter!.id);

  const [otherMachine] = await db
    .insert(schema.fingerprintMachines)
    .values({
      name: `${tag} LAIN`,
      ip: otherIp,
      printerId: otherPrinter!.id,
      universeOnly: true,
    })
    .returning({ id: schema.fingerprintMachines.id });
  made.machines.push(otherMachine!.id);
});

afterAll(async () => {
  if (made.niks.length)
    await db
      .delete(schema.tickets)
      .where(inArray(schema.tickets.nik, made.niks));
  if (made.machines.length)
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made.machines));
  if (made.printers.length)
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, made.printers));
});

/** A tap late enough in the morning that a spare is past the second finger. */
const tapOn = (date: string) => ({
  ip,
  nik,
  at: `${date} 05:40:00`,
  date,
  shift: "day" as const,
});

describe("issuing", () => {
  test("renders and stores a ticket without printing when printing is off", async () => {
    const result = await issueTicket(tapOn("2026-01-02"), {
      printingEnabled: false,
    });
    expect(result.issued).toBe(true);
    if (!result.issued) return;
    expect(result.status).toBe("dry");
    expect(result.preview).toContain("PT UNGGUL DINAMIKA UTAMA");
    expect(result.preview).toContain(nik);
    /* The arrival is on the slip whether or not a unit is. */
    expect(result.preview).toContain("JAM ABSEN      : 2026-01-02 05:40:00");
  });

  /*
   * The claim is what makes a double tap safe. Both calls carry the same
   * contents, so the database refuses the second — not a timer, not a lock.
   */
  test("the same slip is not issued twice", async () => {
    await issueTicket(tapOn("2026-01-03"), { printingEnabled: false });
    const again = await issueTicket(tapOn("2026-01-03"), {
      printingEnabled: false,
    });
    expect(again).toEqual({ issued: false, reason: "duplicate" });
  });

  /*
   * The trial of 2026-09-14: Ruben Lottong tapped Mesin 31, walked to Mesin 33
   * and tapped again nine seconds later, and got a second slip — identical but
   * for NAMA PRINTER. Which booth printed it is not something that changed
   * about him.
   */
  test("the same slip is not issued again at another booth", async () => {
    /* Both taps are heard before either slip is issued, as they are at the
       booth — so the second slip reads the same arrival as the first. */
    const day = "2026-01-07";
    await db.insert(schema.deviceLiveEvents).values([
      { ip, nik, at: `${day} 05:40:00` },
      { ip: otherIp, nik, at: `${day} 05:40:09` },
    ]);
    try {
      const first = await issueTicket(tapOn(day), { printingEnabled: false });
      expect(first.issued).toBe(true);

      const elsewhere = await issueTicket(
        { ...tapOn(day), ip: otherIp, at: `${day} 05:40:09` },
        { printingEnabled: false }
      );
      expect(elsewhere).toEqual({ issued: false, reason: "duplicate" });
    } finally {
      await db
        .delete(schema.deviceLiveEvents)
        .where(inArray(schema.deviceLiveEvents.ip, [ip, otherIp]));
    }
  });

  test("a nik the register does not carry is refused", async () => {
    const result = await issueTicket(
      { ...tapOn("2026-01-04"), nik: "000000000" },
      { printingEnabled: false }
    );
    expect(result).toEqual({ issued: false, reason: "unknown-person" });
  });
});

describe("when a printer is involved", () => {
  test("a printer that accepts leaves a printed row", async () => {
    const result = await issueTicket(tapOn("2026-01-05"), {
      printingEnabled: true,
      print: async () => ({ sent: true, ms: 12 }),
    });
    expect(result.issued && result.status).toBe("printed");

    const [row] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.date, "2026-01-05"));
    expect(row?.status).toBe("printed");
    expect(row?.printedAt).not.toBeNull();
  });

  /*
   * A refused printer must leave something a person can act on. The tap was
   * still attendance; only the paper is missing.
   */
  test("a printer that refuses leaves a failed row with the reason", async () => {
    const result = await issueTicket(tapOn("2026-01-06"), {
      printingEnabled: true,
      print: async () => ({ sent: false, reason: "ECONNREFUSED", ms: 4 }),
      /* The minute the owner asked for, compressed: what is under test is that
         it retries and then stops, not how long it waits. */
      retry: { forMs: 150, gapMs: 30 },
    });
    expect(result.issued && result.status).toBe("failed");

    const [row] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.date, "2026-01-06"));
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("ECONNREFUSED");
    expect(row?.printedAt).toBeNull();
    /* Tried more than once inside its minute. */
    expect(row?.attempts).toBeGreaterThan(1);
  });
});

/**
 * Which reader caught the first finger must not change the arrival.
 *
 * The live session hears a tap in about a second; the periodic pull finds it
 * within half a minute. Either can miss one — a session that dropped, a
 * machine nobody is listening to — and before this the arrival was read from
 * the live events alone. A spare whose first finger went unheard had his
 * second finger printed as his arrival, which is past the deadline, which
 * costs him the unit on his slip.
 */
describe("the first tap of the shift", () => {
  const day = "2026-01-08";

  afterAll(async () => {
    await db.delete(schema.deviceTaps).where(eq(schema.deviceTaps.ip, ip));
    await db
      .delete(schema.deviceLiveEvents)
      .where(eq(schema.deviceLiveEvents.ip, ip));
  });

  test("is found in the pulled taps when the live session missed it", async () => {
    /* Only the pull has the 04:41 tap; the live session joined later. */
    await db
      .insert(schema.deviceTaps)
      .values({ ip, nik, at: `${day} 04:41:00`, direction: "in" });

    expect(await firstTapOf(nik, day, "day")).toBe(`${day} 04:41:00`);
  });

  test("is the earliest across both readers, not the earliest of one", async () => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik, at: `${day} 04:39:00` });

    expect(await firstTapOf(nik, day, "day")).toBe(`${day} 04:39:00`);
  });

  test("ignores a tap belonging to the other shift", async () => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik, at: `${day} 17:05:00` });

    expect(await firstTapOf(nik, day, "day")).toBe(`${day} 04:39:00`);
    expect(await firstTapOf(nik, day, "night")).toBe(`${day} 17:05:00`);
  });
});

/*
 * Which plan seat reaches the paper (owner, 2026-09-15).
 *
 * The plan remembers a standing operator's unit whatever became of it. Read
 * alone it printed DT4084 for Alif Zainuddin while DT4084 was broken down and
 * in no formation, and it would print a unit for an employee the board never
 * allocates. The slip now asks what the board asks.
 */
describe("which plan seat reaches the paper", () => {
  const fixture = {
    slots: [] as string[],
    units: [] as string[],
    employees: [] as string[],
    docs: [] as string[],
    departments: [] as string[],
  };
  const day = "2026-01-09";

  afterAll(async () => {
    if (fixture.slots.length)
      await db
        .delete(schema.fleetPlanSlots)
        .where(inArray(schema.fleetPlanSlots.id, fixture.slots));
    if (fixture.units.length)
      await db
        .delete(schema.units)
        .where(inArray(schema.units.id, fixture.units));
    if (fixture.employees.length) {
      await db
        .delete(schema.rosterDays)
        .where(inArray(schema.rosterDays.employeeId, fixture.employees));
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, fixture.employees));
    }
    if (fixture.docs.length)
      await db
        .delete(schema.rosterDocuments)
        .where(inArray(schema.rosterDocuments.id, fixture.docs));
    if (fixture.departments.length)
      await db
        .delete(schema.departments)
        .where(inArray(schema.departments.id, fixture.departments));
  });

  /*
   * A department and roster of its own. A plan seat needs the roster since
   * 2026-09-15, and a department holds one active document a month.
   */
  let rostered: { id: string; companyId: string; docId: string } | null = null;
  const rosterDept = async () => {
    if (rostered) return rostered;
    const [company] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .limit(1);
    const [dept] = await db
      .insert(schema.departments)
      .values({ name: `${tag} PLAN DEPT`, companyId: company!.id })
      .returning({ id: schema.departments.id });
    fixture.departments.push(dept!.id);
    const [doc] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: dept!.id,
        month: "2026-01-01",
        fileName: `${tag}-plan.xlsx`,
      })
      .returning({ id: schema.rosterDocuments.id });
    fixture.docs.push(doc!.id);
    rostered = { id: dept!.id, companyId: company!.id, docId: doc!.id };
    return rostered;
  };

  /** A standing operator on one support unit, in whatever state is asked. */
  const standing = async (opts: {
    unit?: { breakdown?: boolean; standby?: boolean; active?: boolean };
    status?: "aktif" | "standby" | "nonaktif";
  }) => {
    const dept = await rosterDept();
    const [position] = await db
      .select({ id: schema.positions.id })
      .from(schema.positions)
      .limit(1);
    const personNik = `97${Math.floor(Math.random() * 1e7)
      .toString()
      .padStart(7, "0")}`;
    const [employee] = await db
      .insert(schema.employees)
      .values({
        nik: personNik,
        name: `${tag} ${personNik}`,
        departmentId: dept.id,
        companyId: dept.companyId,
        positionId: position!.id,
        status: opts.status ?? "aktif",
      })
      .returning({ id: schema.employees.id });
    fixture.employees.push(employee!.id);
    await db.insert(schema.rosterDays).values({
      documentId: dept.docId,
      employeeId: employee!.id,
      date: day,
      code: "D",
    });

    /* The catalogue keys a unit cannot exist without; any row will do. */
    const [[cls], [type], [model], [brand]] = await Promise.all([
      db
        .select({ id: schema.unitClasses.id })
        .from(schema.unitClasses)
        .limit(1),
      db.select({ id: schema.unitTypes.id }).from(schema.unitTypes).limit(1),
      db.select({ id: schema.unitModels.id }).from(schema.unitModels).limit(1),
      db.select({ id: schema.unitBrands.id }).from(schema.unitBrands).limit(1),
    ]);
    const [unit] = await db
      .insert(schema.units)
      .values({
        code: `ZZTK${uid()}`,
        classId: cls!.id,
        typeId: type!.id,
        modelId: model!.id,
        brandId: brand!.id,
        /* Crewed as support, so it takes part in allocation without a
           formation to build around it. */
        fleetSupport: true,
        workArea: `${tag} Pit`,
        breakdown: opts.unit?.breakdown ?? false,
        standby: opts.unit?.standby ?? false,
        active: opts.unit?.active ?? true,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    fixture.units.push(unit!.id);

    const [slot] = await db
      .insert(schema.fleetPlanSlots)
      .values({ unitId: unit!.id, employeeId: employee!.id })
      .returning({ id: schema.fleetPlanSlots.id });
    fixture.slots.push(slot!.id);

    return { nik: personNik, unit: unit!.code };
  };

  test("a unit the board is about prints, and its operator is standing", async () => {
    const op = await standing({});
    expect(await roleOf(op.nik)).toBe("standing");
    expect((await seatOf(op.nik, day, "day"))?.seat.unit).toBe(op.unit);
  });

  test("a unit on standby is still allocated, so it still prints", async () => {
    const op = await standing({ unit: { standby: true } });
    expect(await roleOf(op.nik)).toBe("standing");
    expect((await seatOf(op.nik, day, "day"))?.seat.unit).toBe(op.unit);
  });

  /* He waits for the second finger like a spare, as the board treats him. */
  test("a broken-down unit prints nothing, and its operator is a spare", async () => {
    const op = await standing({ unit: { breakdown: true } });
    expect(await roleOf(op.nik)).toBe("spare");
    expect(await seatOf(op.nik, day, "day")).toBeNull();
  });

  test("an inactive unit prints nothing either", async () => {
    const op = await standing({ unit: { active: false } });
    expect(await roleOf(op.nik)).toBe("spare");
    expect(await seatOf(op.nik, day, "day")).toBeNull();
  });

  /* The unit is fine; it is the person the board will not allocate. */
  test("an employee on standby gets no unit from the plan", async () => {
    const op = await standing({ status: "standby" });
    expect(await seatOf(op.nik, day, "day")).toBeNull();
  });
});

/*
 * What UNIT says when nobody seated him (owner, 2026-09-15).
 *
 * SPARE for an operator the board could have used, whatever kept him off a
 * unit; a dash for anybody the board never considers. Decided from the
 * register at the tap, because the slip is printed there.
 */
describe("what UNIT says without a seat", () => {
  const fixture = {
    niks: [] as string[],
    employees: [] as string[],
    positions: [] as string[],
  };
  const day = "2026-01-10";

  afterAll(async () => {
    if (fixture.niks.length)
      await db
        .delete(schema.tickets)
        .where(inArray(schema.tickets.nik, fixture.niks));
    if (fixture.employees.length)
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, fixture.employees));
    if (fixture.positions.length)
      await db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, fixture.positions));
  });

  /** Somebody holding no unit, in an allocated position or not. */
  const person = async (opts: {
    fleetAllocation: boolean;
    status?: "aktif" | "standby" | "nonaktif";
  }) => {
    const [dept] = await db
      .select({
        id: schema.departments.id,
        companyId: schema.departments.companyId,
      })
      .from(schema.departments)
      .limit(1);
    const personNik = `96${Math.floor(Math.random() * 1e7)
      .toString()
      .padStart(7, "0")}`;
    const [position] = await db
      .insert(schema.positions)
      .values({
        name: `${tag} POS ${personNik}`,
        departmentId: dept!.id,
        fleetAllocation: opts.fleetAllocation,
      })
      .returning({ id: schema.positions.id });
    fixture.positions.push(position!.id);
    const [employee] = await db
      .insert(schema.employees)
      .values({
        nik: personNik,
        name: `${tag} ${personNik}`,
        departmentId: dept!.id,
        companyId: dept!.companyId,
        positionId: position!.id,
        status: opts.status ?? "aktif",
      })
      .returning({ id: schema.employees.id });
    fixture.employees.push(employee!.id);
    fixture.niks.push(personNik);
    return personNik;
  };

  const unitLine = async (who: string) => {
    const result = await issueTicket(
      { ...tapOn(day), nik: who },
      { printingEnabled: false }
    );
    expect(result.issued).toBe(true);
    if (!result.issued) return null;
    return result.preview.split("\n").find((l) => l.startsWith("UNIT "));
  };

  test("an operator with no unit reads SPARE", async () => {
    const who = await person({ fleetAllocation: true });
    expect(await unitLine(who)).toBe("UNIT           : SPARE");
  });

  test("an employee on standby keeps the dash", async () => {
    const who = await person({ fleetAllocation: true, status: "standby" });
    expect(await unitLine(who)).toBe("UNIT           : -");
  });

  test("somebody whose position is never allocated keeps the dash", async () => {
    const who = await person({ fleetAllocation: false });
    expect(await unitLine(who)).toBe("UNIT           : -");
  });

  /* Holds no SIMPER on a unit that asks for FTW, so owes no filing. */
  test("no FTW on file, owing none, reads a dash", async () => {
    const who = await person({ fleetAllocation: true });
    const result = await issueTicket(
      { ...tapOn("2026-01-11"), nik: who },
      { printingEnabled: false }
    );
    expect(result.issued && result.preview).toContain("FTW            : -\n");
  });
});

/*
 * The slip before the board, held to what the board will ask (2026-09-15).
 *
 * A standing operator's first-finger slip printed his plan unit on the plan's
 * word alone; the board then refused an expired or missing SIMPER, or gave the
 * unit to a partner on the same shift, and the paper disagreed with the wall.
 */
describe("a plan seat on the first-finger slip", () => {
  const fixture = {
    niks: [] as string[],
    slots: [] as string[],
    skills: [] as string[],
    units: [] as string[],
    codes: [] as string[],
    employees: [] as string[],
    positions: [] as string[],
    docs: [] as string[],
    departments: [] as string[],
  };
  const day = "2026-01-12";

  afterAll(async () => {
    const del = async (ids: string[], run: () => Promise<unknown>) => {
      if (ids.length) await run();
    };
    await del(fixture.niks, () =>
      db.delete(schema.tickets).where(inArray(schema.tickets.nik, fixture.niks))
    );
    await del(fixture.niks, () =>
      db
        .delete(schema.deviceLiveEvents)
        .where(inArray(schema.deviceLiveEvents.nik, fixture.niks))
    );
    await del(fixture.niks, () =>
      db
        .delete(schema.ftwReadings)
        .where(inArray(schema.ftwReadings.nik, fixture.niks))
    );
    await del(fixture.slots, () =>
      db
        .delete(schema.fleetPlanSlots)
        .where(inArray(schema.fleetPlanSlots.id, fixture.slots))
    );
    await del(fixture.employees, () =>
      db
        .delete(schema.employeeSkills)
        .where(inArray(schema.employeeSkills.employeeId, fixture.employees))
    );
    await del(fixture.employees, () =>
      db
        .delete(schema.rosterDays)
        .where(inArray(schema.rosterDays.employeeId, fixture.employees))
    );
    await del(fixture.docs, () =>
      db
        .delete(schema.rosterDocuments)
        .where(inArray(schema.rosterDocuments.id, fixture.docs))
    );
    await del(fixture.units, () =>
      db.delete(schema.units).where(inArray(schema.units.id, fixture.units))
    );
    await del(fixture.codes, () =>
      db
        .delete(schema.simperCodes)
        .where(inArray(schema.simperCodes.id, fixture.codes))
    );
    await del(fixture.employees, () =>
      db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, fixture.employees))
    );
    await del(fixture.positions, () =>
      db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, fixture.positions))
    );
    await del(fixture.departments, () =>
      db
        .delete(schema.departments)
        .where(inArray(schema.departments.id, fixture.departments))
    );
  });

  /*
   * One department of its own, and one roster document for it.
   *
   * A department holds a single active document per month, so a document per
   * operator was refused from the second one on — and borrowing a real
   * department would collide with whatever roster the register already holds.
   */
  let shared: { id: string; companyId: string; docId: string } | null = null;
  const deptOf = async () => {
    if (shared) return shared;
    const [company] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .limit(1);
    const [dept] = await db
      .insert(schema.departments)
      .values({ name: `${tag} DEPT`, companyId: company!.id })
      .returning({ id: schema.departments.id });
    fixture.departments.push(dept!.id);
    const [doc] = await db
      .insert(schema.rosterDocuments)
      .values({
        departmentId: dept!.id,
        month: "2026-01-01",
        fileName: `${tag}.xlsx`,
      })
      .returning({ id: schema.rosterDocuments.id });
    fixture.docs.push(doc!.id);
    shared = { id: dept!.id, companyId: company!.id, docId: doc!.id };
    return shared;
  };

  /** A support unit, optionally asking for a SIMPER and for FTW. */
  const unit = async (simperCodeId: string | null = null, ftw = false) => {
    const [[cls], [type], [model], [brand]] = await Promise.all([
      db
        .select({ id: schema.unitClasses.id })
        .from(schema.unitClasses)
        .limit(1),
      db.select({ id: schema.unitTypes.id }).from(schema.unitTypes).limit(1),
      db.select({ id: schema.unitModels.id }).from(schema.unitModels).limit(1),
      db.select({ id: schema.unitBrands.id }).from(schema.unitBrands).limit(1),
    ]);
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZPS${uid()}`,
        classId: cls!.id,
        typeId: type!.id,
        modelId: model!.id,
        brandId: brand!.id,
        fleetSupport: true,
        workArea: `${tag} Pit`,
        simperCodeId,
        ftw,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    fixture.units.push(row!.id);
    return row!;
  };

  const simper = async () => {
    const [row] = await db
      .insert(schema.simperCodes)
      .values({ name: `${tag} SIM ${uid()}` })
      .returning({ id: schema.simperCodes.id });
    fixture.codes.push(row!.id);
    return row!.id;
  };

  /** A standing operator on `unitId`, rostered to this day shift. */
  const operator = async (
    unitId: string,
    opts: { skill?: string; simperExp?: string } = {}
  ) => {
    const dept = await deptOf();
    const personNik = `95${Math.floor(Math.random() * 1e7)
      .toString()
      .padStart(7, "0")}`;
    const [position] = await db
      .insert(schema.positions)
      .values({
        name: `${tag} OP ${personNik}`,
        departmentId: dept.id,
        fleetAllocation: true,
      })
      .returning({ id: schema.positions.id });
    fixture.positions.push(position!.id);
    const [employee] = await db
      .insert(schema.employees)
      .values({
        nik: personNik,
        name: `${tag} ${personNik}`,
        departmentId: dept.id,
        companyId: dept.companyId,
        positionId: position!.id,
        simperExp: opts.simperExp ?? null,
      })
      .returning({ id: schema.employees.id });
    fixture.employees.push(employee!.id);
    fixture.niks.push(personNik);
    if (opts.skill)
      await db
        .insert(schema.employeeSkills)
        .values({ employeeId: employee!.id, simperCodeId: opts.skill });

    const [slot] = await db
      .insert(schema.fleetPlanSlots)
      .values({ unitId, employeeId: employee!.id })
      .returning({ id: schema.fleetPlanSlots.id });
    fixture.slots.push(slot!.id);

    await db.insert(schema.rosterDays).values({
      documentId: dept.docId,
      employeeId: employee!.id,
      date: day,
      code: "D",
    });
    return personNik;
  };

  /** In time for the 05:25 gate, heard by the live session as it is at a booth. */
  const tapAt = async (who: string, clock: string) => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik: who, at: `${day} ${clock}` });
    return {
      ip,
      nik: who,
      at: `${day} ${clock}`,
      date: day,
      shift: "day" as const,
    };
  };

  const unitLine = async (tapped: Awaited<ReturnType<typeof tapAt>>) => {
    const result = await issueTicket(tapped, { printingEnabled: false });
    expect(result.issued).toBe(true);
    return result.issued
      ? result.preview.split("\n").find((l) => l.startsWith("UNIT "))
      : null;
  };

  test("prints the unit when he holds its SIMPER", async () => {
    const code = await simper();
    const u = await unit(code);
    const who = await operator(u.id, { skill: code });
    expect(await unitLine(await tapAt(who, "05:00:00"))).toBe(
      `UNIT           : ${u.code}`
    );
  });

  test("prints SPARE when he does not hold the unit's SIMPER", async () => {
    const u = await unit(await simper());
    const who = await operator(u.id);
    expect(await unitLine(await tapAt(who, "05:00:00"))).toBe(
      "UNIT           : SPARE"
    );
  });

  test("prints SPARE when his SIMPER has expired", async () => {
    const code = await simper();
    const u = await unit(code);
    const who = await operator(u.id, { skill: code, simperExp: "2000-01-01" });
    expect(await unitLine(await tapAt(who, "05:00:00"))).toBe(
      "UNIT           : SPARE"
    );
  });

  /* The board's order: both ready and eligible, so the earlier tap wins. */
  test("of two partners on one shift, only the earlier tap gets the unit", async () => {
    const u = await unit();
    const early = await operator(u.id);
    const late = await operator(u.id);
    const earlyTap = await tapAt(early, "04:50:00");
    const lateTap = await tapAt(late, "05:05:00");
    expect(await unitLine(lateTap)).toBe("UNIT           : SPARE");
    expect(await unitLine(earlyTap)).toBe(`UNIT           : ${u.code}`);
  });

  /* A partner who has not tapped cannot win on the clock. */
  test("a partner who has not tapped yet does not take it", async () => {
    const u = await unit();
    const here = await operator(u.id);
    await operator(u.id);
    expect(await unitLine(await tapAt(here, "05:00:00"))).toBe(
      `UNIT           : ${u.code}`
    );
  });

  /*
   * The owner's case (2026-09-15). B taps first with no FTW and is handed
   * SPARE; A taps ready and is handed the unit; B's FTW arrives and he taps
   * again. His tap is still the earlier one, but the unit is in A's hand.
   */
  test("a partner ready only later does not take a unit already handed out", async () => {
    const u = await unit(null, true);
    const a = await operator(u.id);
    const b = await operator(u.id);
    const fit = (who: string) =>
      db.insert(schema.ftwReadings).values({
        nik: who,
        date: day,
        name: tag,
        sleepMinutes: 400,
        sleepCategory: "Dapat Bekerja",
        ftwDecision: "FTW aman",
      });

    expect(await unitLine(await tapAt(b, "04:50:00"))).toBe(
      "UNIT           : SPARE"
    );

    await fit(a);
    expect(await unitLine(await tapAt(a, "05:00:00"))).toBe(
      `UNIT           : ${u.code}`
    );

    await fit(b);
    expect(await unitLine(await tapAt(b, "05:10:00"))).toBe(
      "UNIT           : SPARE"
    );
  });
});

/*
 * Two gaps the full-scenario print test found (2026-09-15).
 *
 * A mechanic and a standby employee waited until the second finger for a
 * slip; and once the board existed, an operator it had not seated — his tap
 * heard too late — got his standing unit on paper while the board had given
 * it to a spare who already held a slip for it.
 */
describe("what the print test found", () => {
  const fixture = {
    niks: [] as string[],
    slots: [] as string[],
    units: [] as string[],
    employees: [] as string[],
    positions: [] as string[],
    docs: [] as string[],
  };
  const day = "2026-01-14";

  afterAll(async () => {
    if (fixture.niks.length) {
      await db
        .delete(schema.tickets)
        .where(inArray(schema.tickets.nik, fixture.niks));
      await db
        .delete(schema.deviceLiveEvents)
        .where(inArray(schema.deviceLiveEvents.nik, fixture.niks));
    }
    if (fixture.docs.length)
      await db
        .delete(schema.fleetActualDocuments)
        .where(inArray(schema.fleetActualDocuments.id, fixture.docs));
    if (fixture.slots.length)
      await db
        .delete(schema.fleetPlanSlots)
        .where(inArray(schema.fleetPlanSlots.id, fixture.slots));
    if (fixture.units.length)
      await db
        .delete(schema.units)
        .where(inArray(schema.units.id, fixture.units));
    if (fixture.employees.length)
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, fixture.employees));
    if (fixture.positions.length)
      await db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, fixture.positions));
  });

  const someone = async (opts: {
    fleetAllocation: boolean;
    status?: "aktif" | "standby";
  }) => {
    const [dept] = await db
      .select({
        id: schema.departments.id,
        companyId: schema.departments.companyId,
      })
      .from(schema.departments)
      .limit(1);
    const who = `94${Math.floor(Math.random() * 1e7)
      .toString()
      .padStart(7, "0")}`;
    const [position] = await db
      .insert(schema.positions)
      .values({
        name: `${tag} FOUND ${who}`,
        departmentId: dept!.id,
        fleetAllocation: opts.fleetAllocation,
      })
      .returning({ id: schema.positions.id });
    fixture.positions.push(position!.id);
    const [employee] = await db
      .insert(schema.employees)
      .values({
        nik: who,
        name: `${tag} ${who}`,
        departmentId: dept!.id,
        companyId: dept!.companyId,
        positionId: position!.id,
        status: opts.status ?? "aktif",
      })
      .returning({ id: schema.employees.id });
    fixture.employees.push(employee!.id);
    fixture.niks.push(who);
    return { nik: who, id: employee!.id };
  };

  const tapAt = async (who: string, clock: string) => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik: who, at: `${day} ${clock}` });
    return issueTicket(
      { ip, nik: who, at: `${day} ${clock}`, date: day, shift: "day" },
      { printingEnabled: false }
    );
  };

  const unitOf = (result: Awaited<ReturnType<typeof issueTicket>>) =>
    result.issued
      ? result.preview.split("\n").find((l) => l.startsWith("UNIT "))
      : null;

  test("a mechanic gets his slip at the first finger", async () => {
    const mechanic = await someone({ fleetAllocation: false });
    const result = await tapAt(mechanic.nik, "05:00:00");
    expect(result.issued).toBe(true);
    expect(unitOf(result)).toBe("UNIT           : -");
  });

  test("a standby employee gets his slip at the first finger", async () => {
    const standby = await someone({ fleetAllocation: true, status: "standby" });
    const result = await tapAt(standby.nik, "05:00:00");
    expect(result.issued).toBe(true);
    expect(unitOf(result)).toBe("UNIT           : -");
  });

  test("once the board exists, a plan unit it did not give him prints SPARE", async () => {
    const [[cls], [type], [model], [brand]] = await Promise.all([
      db
        .select({ id: schema.unitClasses.id })
        .from(schema.unitClasses)
        .limit(1),
      db.select({ id: schema.unitTypes.id }).from(schema.unitTypes).limit(1),
      db.select({ id: schema.unitModels.id }).from(schema.unitModels).limit(1),
      db.select({ id: schema.unitBrands.id }).from(schema.unitBrands).limit(1),
    ]);
    const [unit] = await db
      .insert(schema.units)
      .values({
        code: `ZZFD${uid()}`,
        classId: cls!.id,
        typeId: type!.id,
        modelId: model!.id,
        brandId: brand!.id,
        fleetSupport: true,
        workArea: `${tag} Pit`,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    fixture.units.push(unit!.id);
    const operator = await someone({ fleetAllocation: true });
    const [slot] = await db
      .insert(schema.fleetPlanSlots)
      .values({ unitId: unit!.id, employeeId: operator.id })
      .returning({ id: schema.fleetPlanSlots.id });
    fixture.slots.push(slot!.id);

    /* A board for the shift that does not seat him. */
    const [doc] = await db
      .insert(schema.fleetActualDocuments)
      .values({ date: day, shift: "day" })
      .returning({ id: schema.fleetActualDocuments.id });
    fixture.docs.push(doc!.id);

    expect(unitOf(await tapAt(operator.nik, "05:00:00"))).toBe(
      "UNIT           : SPARE"
    );
  });
});

/*
 * Two more gaps a sync audit found (2026-09-15).
 *
 * An admin's hand placement never reached paper — the slip judged the late
 * person again and printed SPARE while the wall showed him on the unit. And an
 * operator not rostered to the shift printed his standing unit before the
 * board, which then gave it to somebody who was.
 */
describe("hand placements and the roster", () => {
  const fixture = {
    niks: [] as string[],
    slots: [] as string[],
    units: [] as string[],
    employees: [] as string[],
    positions: [] as string[],
    docs: [] as string[],
  };
  const day = "2026-01-15";

  afterAll(async () => {
    if (fixture.niks.length) {
      await db
        .delete(schema.tickets)
        .where(inArray(schema.tickets.nik, fixture.niks));
      await db
        .delete(schema.deviceLiveEvents)
        .where(inArray(schema.deviceLiveEvents.nik, fixture.niks));
      await db
        .delete(schema.ftwReadings)
        .where(inArray(schema.ftwReadings.nik, fixture.niks));
    }
    if (fixture.docs.length)
      await db
        .delete(schema.fleetActualDocuments)
        .where(inArray(schema.fleetActualDocuments.id, fixture.docs));
    if (fixture.slots.length)
      await db
        .delete(schema.fleetPlanSlots)
        .where(inArray(schema.fleetPlanSlots.id, fixture.slots));
    if (fixture.units.length)
      await db
        .delete(schema.units)
        .where(inArray(schema.units.id, fixture.units));
    if (fixture.employees.length)
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, fixture.employees));
    if (fixture.positions.length)
      await db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, fixture.positions));
  });

  const operator = async () => {
    const [dept] = await db
      .select({
        id: schema.departments.id,
        companyId: schema.departments.companyId,
      })
      .from(schema.departments)
      .limit(1);
    const who = `93${Math.floor(Math.random() * 1e7)
      .toString()
      .padStart(7, "0")}`;
    const [position] = await db
      .insert(schema.positions)
      .values({
        name: `${tag} HAND ${who}`,
        departmentId: dept!.id,
        fleetAllocation: true,
      })
      .returning({ id: schema.positions.id });
    fixture.positions.push(position!.id);
    const [employee] = await db
      .insert(schema.employees)
      .values({
        nik: who,
        name: `${tag} ${who}`,
        departmentId: dept!.id,
        companyId: dept!.companyId,
        positionId: position!.id,
      })
      .returning({ id: schema.employees.id });
    fixture.employees.push(employee!.id);
    fixture.niks.push(who);
    return { nik: who, id: employee!.id };
  };

  const unit = async (ftw = false) => {
    const [[cls], [type], [model], [brand]] = await Promise.all([
      db
        .select({ id: schema.unitClasses.id })
        .from(schema.unitClasses)
        .limit(1),
      db.select({ id: schema.unitTypes.id }).from(schema.unitTypes).limit(1),
      db.select({ id: schema.unitModels.id }).from(schema.unitModels).limit(1),
      db.select({ id: schema.unitBrands.id }).from(schema.unitBrands).limit(1),
    ]);
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZHP${uid()}`,
        classId: cls!.id,
        typeId: type!.id,
        modelId: model!.id,
        brandId: brand!.id,
        fleetSupport: true,
        workArea: `${tag} Pit`,
        ftw,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    fixture.units.push(row!.id);
    return row!;
  };

  const tapAt = async (who: string, date: string, clock: string) => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik: who, at: `${date} ${clock}` });
    return issueTicket(
      { ip, nik: who, at: `${date} ${clock}`, date, shift: "day" },
      { printingEnabled: false }
    );
  };

  const unitOf = (result: Awaited<ReturnType<typeof issueTicket>>) =>
    result.issued
      ? result.preview.split("\n").find((l) => l.startsWith("UNIT "))
      : null;

  /** A board for `date` with one hand placement on it. */
  const placeByHand = async (
    date: string,
    unitId: string,
    employeeId: string
  ) => {
    const [doc] = await db
      .insert(schema.fleetActualDocuments)
      .values({ date, shift: "day" })
      .returning({ id: schema.fleetActualDocuments.id });
    fixture.docs.push(doc!.id);
    await db.insert(schema.fleetActualSlots).values({
      documentId: doc!.id,
      unitId,
      employeeId,
      source: "manual",
      workArea: `${tag} Pit`,
    });
  };

  test("a late tap placed by hand prints the unit", async () => {
    const u = await unit();
    const late = await operator();
    await placeByHand(day, u.id, late.id);
    expect(unitOf(await tapAt(late.nik, day, "05:40:00"))).toBe(
      `UNIT           : ${u.code}`
    );
  });

  test("a hand placement prints even over a failed FTW", async () => {
    const date = "2026-01-16";
    const u = await unit(true);
    const refused = await operator();
    await db.insert(schema.ftwReadings).values({
      nik: refused.nik,
      date,
      name: tag,
      sleepMinutes: 200,
      sleepCategory: "Tidak Boleh Bekerja",
      ftwDecision: "FTW perlu tindak lanjut",
    });
    await placeByHand(date, u.id, refused.id);
    expect(unitOf(await tapAt(refused.nik, date, "05:00:00"))).toBe(
      `UNIT           : ${u.code}`
    );
  });

  test("an operator not rostered to the shift prints SPARE before the board", async () => {
    const date = "2026-01-17";
    const u = await unit();
    const offToday = await operator();
    const [slot] = await db
      .insert(schema.fleetPlanSlots)
      .values({ unitId: u.id, employeeId: offToday.id })
      .returning({ id: schema.fleetPlanSlots.id });
    fixture.slots.push(slot!.id);
    const result = await tapAt(offToday.nik, date, "05:00:00");
    /* Printed at once: the board will never consider him, so there is
       nothing to wait for. */
    expect(result.issued).toBe(true);
    expect(unitOf(result)).toBe("UNIT           : SPARE");
  });
});
