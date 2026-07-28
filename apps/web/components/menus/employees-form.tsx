"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Briefcase,
  Camera,
  Crop,
  Heart,
  House,
  IdCard,
  Image as ImageIcon,
  Search,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";

import {
  BLOOD_TYPES,
  MCU_RESULTS,
  type BloodType,
  type EmployeeStatus,
  type McuResult,
} from "@universe/contracts";

import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  employeeQueryOptions,
  photoUrl,
  type EmployeeRow,
} from "@/lib/queries/employees";
import { masterQueryOptions, recordDescription } from "@/lib/queries/master";
import {
  decodePhoto,
  EmployeePhotoCrop,
  type CropSource,
} from "@/components/menus/employee-photo-crop";
import { Avatar, initialsOf } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dropzone } from "@/components/ui/dropzone";
import { Field, FormGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StateBox } from "@/components/ui/state-box";
import { useToast } from "@/components/ui/toast";

/**
 * The API's photo rules, repeated here so a file that cannot be stored is
 * refused before it is uploaded rather than after.
 *
 * Mirrored, not shared: these are `MAX_PHOTO_BYTES` and `PHOTO_EXTENSIONS` in
 * `apps/api/src/storage.ts`, and the server remains the boundary — the copy
 * exists so an operator learns about a 9 MB file immediately instead of
 * watching it upload and then fail. `sounds.tsx` mirrors its own cap the same
 * way. Keep the two in step; loosening this one grants nothing.
 */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const PHOTO_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

/**
 * Whether the API would store this file, by the same two keys it uses: the
 * extension on the name, or failing that the declared type. A `.jpg` holding
 * something else still passes — the server does not read magic bytes either.
 */
function isStorablePhoto(file: File): boolean {
  const dot = file.name.lastIndexOf(".");
  const extension = dot < 0 ? "" : file.name.slice(dot).toLowerCase();
  return (
    PHOTO_EXTENSIONS.includes(extension) ||
    PHOTO_TYPES.includes(file.type.toLowerCase())
  );
}

/**
 * The form's own state, in the shape the API speaks.
 *
 * Ids rather than names throughout, because that is what a write carries
 * (design D4/D5): the names on screen are a join result, and posting one back
 * would put the text comparison the catalogues exist to abolish into the
 * client. `""` is the empty choice for the two optional references.
 */
type Fields = {
  nama: string;
  nik: string;
  companyId: string;
  positionId: string;
  departmentId: string;
  joinDate: string;
  license: string;
  simperTypeId: string;
  simperNo: string;
  simperExp: string;
  mcu: string;
  mcuExp: string;
  blood: string;
  medical: string;
  messId: string;
  /**
   * Block is its own field (design D5). The mess catalogue is one level —
   * Mess A/B/C — because a block carries no attributes and nothing in the
   * allocation model reads one; modelling it would add a table, a menu, a slug,
   * and a grant to validate a string that is only ever displayed.
   */
  block: string;
  room: string;
  phone: string;
  emergency: string;
  status: EmployeeStatus;
};

const EMPTY: Fields = {
  nama: "",
  nik: "",
  companyId: "",
  positionId: "",
  departmentId: "",
  joinDate: "",
  license: "",
  simperTypeId: "",
  simperNo: "",
  simperExp: "",
  mcu: "",
  mcuExp: "",
  blood: "",
  medical: "",
  messId: "",
  block: "",
  room: "",
  phone: "",
  emergency: "",
  status: "aktif",
};

/** `""` on the wire is `null` — "no mess", "no permit", "no date". */
const orNull = (value: string) => (value.trim() ? value.trim() : null);

/** The stored record, flattened into the shape the form edits. */
function fieldsOf(record: EmployeeRow): Fields {
  return {
    nama: record.name,
    nik: record.nik,
    companyId: record.companyId,
    positionId: record.positionId,
    departmentId: record.departmentId,
    joinDate: record.joinDate ?? "",
    license: record.license,
    simperTypeId: record.simperTypeId ?? "",
    simperNo: record.simperNo,
    simperExp: record.simperExp ?? "",
    mcu: record.mcu ?? "",
    mcuExp: record.mcuExp ?? "",
    blood: record.blood ?? "",
    medical: record.medical,
    messId: record.messId ?? "",
    block: record.block,
    room: record.room,
    phone: record.phone,
    emergency: record.emergency,
    status: record.status,
  };
}

/**
 * Add/edit employee form, served by the API.
 *
 * Two components rather than one, and the split is load-bearing: the editable
 * state is seeded from the stored record in a `useState` initializer, so the
 * record has to exist before the form mounts. Filling the fields from an effect
 * instead would let a background refetch overwrite half-typed edits with the
 * stored values — the same data loss as a dropped connection, but silent.
 */
export function EmployeeForm({ nik }: { nik?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const empQ = useQuery({ ...employeeQueryOptions(nik ?? ""), enabled: !!nik });

  if (nik && empQ.isPending)
    return (
      <Panel>
        <Skeleton className="h-24" />
      </Panel>
    );

  if (nik && !empQ.data)
    return (
      <Panel>
        <StateBox
          icon={<Search className="text-(--color-primary-bright)" />}
          title={t.noResTitle}
          body={`NIK ${nik}`}
        >
          <Button
            variant="secondary"
            className="mx-auto"
            onClick={() => router.push("/employees")}
          >
            <ArrowLeft />
            {t.back}
          </Button>
        </StateBox>
      </Panel>
    );

  const record = empQ.data ?? null;
  return (
    <EmployeeFields
      // Remounted if the identity underneath changes, which is React's own
      // answer to "reset all state when the input record is a different one".
      key={record?.id ?? "new"}
      nik={nik}
      record={record}
    />
  );
}

/**
 * The photo is uploaded *after* the record is written, and deliberately so: its
 * endpoint addresses an employee by NIK, so on a create there is nothing to
 * address until the create has landed. A failed upload therefore leaves a saved
 * employee without a photo — reported as its own toast rather than folded into
 * the save, because retrying the upload is a different action from retrying the
 * save.
 */
function EmployeeFields({
  nik,
  record,
}: {
  nik?: string;
  record: EmployeeRow | null;
}) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const listHref = `/employees`;

  // Active rows only: these are selection lists, so a retired catalogue entry
  // stops being offered while the employees already holding it keep showing it.
  const companies = useQuery(masterQueryOptions("perusahaan", true));
  const positions = useQuery(masterQueryOptions("jabatan", true));
  const departments = useQuery(masterQueryOptions("departemen", true));
  const messes = useQuery(masterQueryOptions("mess", true));
  const simperTypes = useQuery(masterQueryOptions("simper", true));
  const simperCodes = useQuery(masterQueryOptions("kode-simper", true));

  const [f, setF] = React.useState<Fields>(() =>
    record ? fieldsOf(record) : EMPTY
  );
  const [skillIds, setSkillIds] = React.useState<string[]>(
    () => record?.skills.map((s) => s.id) ?? []
  );
  const [dirty, setDirty] = React.useState(false);
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [cropSource, setCropSource] = React.useState<CropSource | null>(null);
  /** The file as picked, before cropping — kept so the crop can be redone. */
  const [origin, setOrigin] = React.useState<File | null>(null);
  /** Object URL of the cropped square, so the avatar shows what will be sent. */
  const [preview, setPreview] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<{
    nama?: boolean;
    nik?: boolean;
  }>({});
  const [dirtyDlg, setDirtyDlg] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  /* Object URLs are held by the document until revoked, so leaving the form
     mid-edit would otherwise keep every staged crop alive for the session. */
  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  function up<K extends keyof Fields>(key: K, value: Fields[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function toggleSkill(id: string) {
    setSkillIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
    setDirty(true);
  }

  /**
   * A rejected file leaves the staged photo untouched: dropping a PDF onto a
   * form that already has a replacement queued must not silently discard it.
   *
   * A picked file is not staged directly — it goes to the cropper, and what
   * `stagePhoto` finally receives is the square that came back out. Every photo
   * therefore reaches the API at 1:1, which is what `object-cover` on the
   * avatars has been silently assuming all along.
   */
  async function pickPhoto(file: File) {
    if (!isStorablePhoto(file)) {
      pushToast("error", t.efPhotoFailT, t.efPhotoType);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      pushToast(
        "error",
        t.efPhotoFailT,
        `${t.efPhotoSize} (${fileSize(file.size)})`
      );
      return;
    }
    const bitmap = await decodePhoto(file);
    if (!bitmap) {
      pushToast("error", t.efPhotoFailT, t.efCropUnreadable);
      return;
    }
    setCropSource({ file, bitmap });
  }

  /** The cropped square, which is what actually gets uploaded. */
  function stagePhoto(file: File) {
    // The file that went *into* the cropper is kept so the framing can be
    // redone. Re-cropping the square that came out would compound the loss —
    // each pass would re-encode an already re-encoded photo.
    setOrigin(cropSource?.file ?? null);
    closeCrop();
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setDirty(true);
  }

  /** Reopen the cropper on the original file, not on the cropped square. */
  async function recrop() {
    if (!origin) return;
    const bitmap = await decodePhoto(origin);
    if (!bitmap) {
      pushToast("error", t.efPhotoFailT, t.efCropUnreadable);
      return;
    }
    setCropSource({ file: origin, bitmap });
  }

  /** Drop the staged photo; the avatar falls back to the stored one. */
  function discardPhoto() {
    setPhoto(null);
    setOrigin(null);
    setPreview(null);
    setDirty(true);
  }

  /* The bitmap holds decoded pixels until it is closed, so cancelling has to
     release it rather than just dropping the reference. */
  function closeCrop() {
    cropSource?.bitmap.close();
    setCropSource(null);
  }

  function cancel() {
    if (dirty) setDirtyDlg(true);
    else router.back();
  }

  /** Uploaded after the record exists — the endpoint is keyed on NIK. */
  async function uploadPhoto(targetNik: string): Promise<boolean> {
    if (!photo) return true;
    const { error } = await api.v1
      .employees({ nik: targetNik })
      .photo.post({ file: photo });
    if (error) {
      pushToast("error", t.efPhotoFailT, errorMessage(error, t.loginErr));
      return false;
    }
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = { nama: !f.nama.trim(), nik: !f.nik.trim() };
    setErrors(errs);
    if (errs.nama || errs.nik) {
      pushToast("error", t.toastFormErrT, t.toastFormErrD);
      return;
    }
    if (!f.companyId || !f.positionId || !f.departmentId) {
      pushToast("error", t.toastFormErrT, t.efRefRequired);
      return;
    }

    const name = f.nama.trim();
    const body = {
      name,
      companyId: f.companyId,
      positionId: f.positionId,
      departmentId: f.departmentId,
      messId: orNull(f.messId),
      simperTypeId: orNull(f.simperTypeId),
      joinDate: orNull(f.joinDate),
      license: f.license.trim(),
      simperNo: f.simperNo.trim(),
      simperExp: orNull(f.simperExp),
      mcu: (orNull(f.mcu) as McuResult | null) ?? null,
      mcuExp: orNull(f.mcuExp),
      blood: (orNull(f.blood) as BloodType | null) ?? null,
      medical: f.medical.trim(),
      block: f.block.trim(),
      room: f.room.trim(),
      phone: f.phone.trim(),
      emergency: f.emergency.trim(),
      status: f.status,
      skillIds,
    };

    setSaving(true);
    const result = nik
      ? await api.v1.employees({ nik }).patch(body)
      : await api.v1.employees.post({ ...body, nik: f.nik.trim() });

    if (result.error) {
      setSaving(false);
      pushToast(
        "error",
        nik ? t.toastSaveT : t.toastAddT,
        errorMessage(result.error, t.loginErr)
      );
      return;
    }

    const savedNik = result.data.nik;
    await uploadPhoto(savedNik);
    setSaving(false);
    setDirty(false);

    // The affected queries, not the route: a refresh would re-render the whole
    // tree to pick up one record.
    await queryClient.invalidateQueries({ queryKey: ["employees"] });
    await queryClient.invalidateQueries({ queryKey: ["employee", savedNik] });

    if (nik) {
      pushToast("success", t.toastSaveT, `${name} ${t.toastSaveD}`);
      router.push(`${listHref}/${savedNik}`);
    } else {
      pushToast("success", t.toastAddT, `${name} — NIK ${savedNik}`);
      router.push(listHref);
    }
  }

  /**
   * The cropped square once one is staged, and the stored photo until then.
   *
   * Showing the crop rather than the old photo is the point of cropping in the
   * first place — the avatar is where an operator checks the framing before
   * saving. With nothing staged the stored photo stays put: blanking it would
   * read as "the photo was removed" when nothing has been written yet.
   */
  const previewSrc = preview ?? (record ? photoUrl(record) : null);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={nik ? `${t.efTitleEdit} — ${record?.name ?? nik}` : t.efTitleAdd}
        sub={t.efSubAdd}
      />

      <form onSubmit={submit} noValidate>
        <div className="flex flex-col gap-6">
          {/* Photo and employment share a row rather than the photo card
              standing alone: capping its width fixed one problem and created
              another — a narrow card on a full-width row leaves the space
              beside it empty, which reads as something failed to load.
              Employment is the longest section, so it absorbs the remainder.
              They stack below 1100px, where two columns stop fitting.

              No `items-start`: the grid's default stretch is what makes both
              panels the height of the taller one, so the row has a single
              bottom edge instead of one card ending short of the other. */}
          <div className="grid grid-cols-[22rem_1fr] gap-6 max-[1100px]:grid-cols-1">
            <Panel>
              <SectionTitle>
                <Camera />
                {t.secPhoto}
              </SectionTitle>
              <div className="flex flex-col gap-4">
                {/* Full card width, not a centred inset. At `max-w-56` the photo
                  had its own left and right edge, half an inch inside every
                  other element's — three content widths in one small card. One
                  shared edge, and the photo gets bigger for free.

                  `key` on the URL so a newly cropped photo remounts and replays
                  the entrance — without it React reuses the node, the src
                  swaps, and the change happens with no acknowledgement. */}
                <Avatar
                  key={previewSrc ?? "empty"}
                  src={previewSrc}
                  alt={f.nama}
                  className="aspect-square size-auto w-full animate-pop-in rounded-card text-6xl shadow-[0_0_0_3px_var(--ring-avatar),0_0_28px_rgba(0,212,255,.3)] transition-shadow duration-300 hover:shadow-[0_0_0_3px_var(--ring-avatar),0_0_40px_rgba(0,212,255,.45)] [&_img]:transition-transform [&_img]:duration-500 hover:[&_img]:scale-105"
                >
                  {initialsOf(f.nama || record?.name || "")}
                </Avatar>

                <Dropzone
                  compact
                  className="h-20"
                  icon={<Upload />}
                  /* The dropzone keeps its own invitation. The staged file gets
                   its own row rather than being written into this title, where
                   a 60-character name pushed the layout around and still left
                   nothing to act on it with. */
                  title={t.efDzTitle}
                  hint={t.efDzHint}
                  aria-label={t.efDzTitle}
                  onPick={() => fileRef.current?.click()}
                  onDropFile={(_name, file) => void pickPhoto(file)}
                  dragging={dragging}
                  onDragChange={setDragging}
                />

                {photo ? (
                  <div className="flex animate-rise-in flex-col gap-2 rounded-control border border-(--divider) bg-(--fill-subtle) p-3">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="size-4 flex-none text-(--color-primary-bright)" />
                      <span
                        className="min-w-0 flex-1 truncate text-xs"
                        title={photo.name}
                      >
                        {photo.name}
                      </span>
                      <span className="flex-none font-mono text-[11px] text-(--text-tertiary)">
                        {fileSize(photo.size)}
                      </span>
                    </div>
                    {/* Not two equal halves. Re-cropping is the likely action and
                      takes the space; discarding is the rare one and gets only
                      the width of its label. Equal widths gave the ghost button
                      an empty half of the row, which read as a gap. */}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => void recrop()}
                      >
                        <Crop />
                        {t.efRecrop}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={discardPhoto}
                      >
                        <X />
                        {t.efDiscardPhoto}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  /* Extensions as well as types: the browser picker filters on
                   whichever it can resolve, and a drop bypasses this entirely —
                   which is why `pickPhoto` re-checks rather than trusting it. */
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void pickPhoto(file);
                    // Cleared so picking the same file twice still fires a change
                    // — a cancelled crop is exactly when that is retried.
                    e.target.value = "";
                  }}
                />
              </div>
            </Panel>

            <Panel>
              <SectionTitle>
                <Briefcase />
                {t.secEmployment}
              </SectionTitle>
              <FormGrid>
                <Field
                  label={t.kFullName}
                  htmlFor="ef-nama"
                  required
                  error={errors.nama}
                  errorMessage={t.errNama}
                >
                  <Input
                    id="ef-nama"
                    value={f.nama}
                    onChange={(e) => up("nama", e.target.value)}
                  />
                </Field>
                <Field
                  label="NIK"
                  htmlFor="ef-nik"
                  required
                  helper={t.helpNik}
                  error={errors.nik}
                  errorMessage={t.errNik}
                >
                  <Input
                    id="ef-nik"
                    className="font-mono"
                    value={f.nik}
                    disabled={!!nik}
                    onChange={(e) => up("nik", e.target.value)}
                  />
                </Field>
                {/* A catalogue now, not two hardcoded options (design D5). */}
                <Field label={t.kCompany} htmlFor="ef-comp" required>
                  <Select
                    id="ef-comp"
                    value={f.companyId}
                    onChange={(e) => up("companyId", e.target.value)}
                  >
                    <option value="">—</option>
                    {(companies.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t.thDept} htmlFor="ef-dept" required>
                  <Select
                    id="ef-dept"
                    value={f.departmentId}
                    onChange={(e) => up("departmentId", e.target.value)}
                  >
                    <option value="">—</option>
                    {(departments.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* Was a free `<Input>`, and its value is used to group and
                  filter — which is exactly what made two spellings of the same
                  job two jobs (design D5). */}
                <Field label={t.thPos} htmlFor="ef-pos" required>
                  <Select
                    id="ef-pos"
                    value={f.positionId}
                    onChange={(e) => up("positionId", e.target.value)}
                  >
                    <option value="">—</option>
                    {(positions.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t.kJoin} htmlFor="ef-join">
                  <Input
                    id="ef-join"
                    type="date"
                    className="font-mono"
                    value={f.joinDate}
                    onChange={(e) => up("joinDate", e.target.value)}
                  />
                </Field>
                {/* Two values, not three: leave is dated and owned by the roster
                  (design D7). */}
                <Field label={t.thStatus} htmlFor="ef-status">
                  <Select
                    id="ef-status"
                    value={f.status}
                    onChange={(e) =>
                      up("status", e.target.value as EmployeeStatus)
                    }
                  >
                    <option value="aktif">{t.stAktif}</option>
                    <option value="nonaktif">{t.stNonaktif}</option>
                  </Select>
                </Field>
              </FormGrid>
            </Panel>
          </div>

          <Panel>
            <SectionTitle>
              <IdCard />
              SIMPER &amp; {t.kLicense}
            </SectionTitle>
            <FormGrid>
              <Field label={t.kSimperCat} htmlFor="ef-simkat">
                <Select
                  id="ef-simkat"
                  value={f.simperTypeId}
                  onChange={(e) => up("simperTypeId", e.target.value)}
                >
                  <option value="">—</option>
                  {/* Permit type — whether this person may operate at all. A
                      different catalogue from the qualification codes below
                      (design D4). */}
                  {(simperTypes.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {recordDescription(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.kSimperNo} htmlFor="ef-simno">
                <Input
                  id="ef-simno"
                  className="font-mono"
                  value={f.simperNo}
                  onChange={(e) => up("simperNo", e.target.value)}
                />
              </Field>
              <Field label={t.kValidity} htmlFor="ef-simexp">
                <Input
                  id="ef-simexp"
                  type="date"
                  className="font-mono"
                  value={f.simperExp}
                  onChange={(e) => up("simperExp", e.target.value)}
                />
              </Field>
              <Field
                label={t.efSkills}
                helper={t.efSkillsHelp}
                className="col-span-full"
              >
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-control border border-(--glass-1-border) bg-(--fill-subtle) p-3 sm:grid-cols-3">
                  {/* Written as ids: the allocation engine matches these
                      against `units.simper_code_id`, and a name on the wire
                      would be a text comparison again (design D4). */}
                  {(simperCodes.data ?? []).map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={skillIds.includes(c.id)}
                        onChange={() => toggleSkill(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t.kLicenseType} htmlFor="ef-lisensi">
                <Input
                  id="ef-lisensi"
                  value={f.license}
                  onChange={(e) => up("license", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <Panel>
            <SectionTitle>
              <Heart />
              {t.secMedical}
            </SectionTitle>
            <FormGrid>
              <Field label={t.kMcu} htmlFor="ef-mcu">
                <Select
                  id="ef-mcu"
                  value={f.mcu}
                  onChange={(e) => up("mcu", e.target.value)}
                >
                  <option value="">—</option>
                  {MCU_RESULTS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.kMcuExp} htmlFor="ef-mcuexp">
                <Input
                  id="ef-mcuexp"
                  type="date"
                  className="font-mono"
                  value={f.mcuExp}
                  onChange={(e) => up("mcuExp", e.target.value)}
                />
              </Field>
              <Field label={t.kBlood} htmlFor="ef-blood">
                <Select
                  id="ef-blood"
                  value={f.blood}
                  onChange={(e) => up("blood", e.target.value)}
                >
                  <option value="">—</option>
                  {BLOOD_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t.kMedHistory}
                htmlFor="ef-medis"
                helper={t.helpMedis}
                className="col-span-full"
              >
                <Textarea
                  id="ef-medis"
                  placeholder={t.phMedis}
                  value={f.medical}
                  onChange={(e) => up("medical", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <Panel>
            <SectionTitle>
              <House />
              {t.secMess}
            </SectionTitle>
            <FormGrid>
              <Field label="Mess" htmlFor="ef-mess">
                <Select
                  id="ef-mess"
                  value={f.messId}
                  onChange={(e) => up("messId", e.target.value)}
                >
                  <option value="">{t.optNoMess}</option>
                  {(messes.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* Free text, deliberately (design D5): a block has no attributes
                  and participates in no matching, so validating it would cost a
                  table, a menu, a slug, and a grant to check a label. */}
              <Field label={t.kBlock} htmlFor="ef-blok">
                <Input
                  id="ef-blok"
                  value={f.block}
                  onChange={(e) => up("block", e.target.value)}
                />
              </Field>
              <Field label={t.kRoom} htmlFor="ef-kamar">
                <Input
                  id="ef-kamar"
                  className="font-mono"
                  value={f.room}
                  onChange={(e) => up("room", e.target.value)}
                />
              </Field>
              <Field label={t.kPhone} htmlFor="ef-hp">
                <Input
                  id="ef-hp"
                  className="font-mono"
                  value={f.phone}
                  onChange={(e) => up("phone", e.target.value)}
                />
              </Field>
              <Field
                label={t.kEmergency}
                htmlFor="ef-emg"
                className="col-span-full"
              >
                <Input
                  id="ef-emg"
                  value={f.emergency}
                  onChange={(e) => up("emergency", e.target.value)}
                />
              </Field>
            </FormGrid>
          </Panel>

          <div className="sticky bottom-4 z-20 flex items-center justify-end gap-3 rounded-panel px-6 py-4 glass-panel">
            {dirty ? (
              <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-(--text-tertiary)">
                <span className="size-[7px] rounded-full bg-(--color-warning)" />
                {t.efUnsaved}
              </span>
            ) : null}
            <Button type="button" variant="ghost" onClick={cancel}>
              {t.btnCancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t.efSaving : nik ? t.efSaveEdit : t.efSaveAdd}
            </Button>
          </div>
        </div>
      </form>

      <Dialog
        open={dirtyDlg}
        onClose={() => setDirtyDlg(false)}
        labelledBy="dirty-t"
      >
        <DialogIcon variant="warning">
          <TriangleAlert />
        </DialogIcon>
        <DialogTitle id="dirty-t">{t.dirtyTitle}</DialogTitle>
        <DialogBody>{t.dirtyBody}</DialogBody>
        <DialogActions>
          <Button variant="ghost" onClick={() => setDirtyDlg(false)}>
            {t.dirtyStay}
          </Button>
          <Button variant="destructive" onClick={() => router.back()}>
            {t.dirtyLeave}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Mounted per picked file rather than kept open and re-fed, so the zoom
          and the framing start fresh for each one without a reset effect. */}
      {cropSource ? (
        <EmployeePhotoCrop
          key={cropSource.file.name + cropSource.file.lastModified}
          source={cropSource}
          onCancel={closeCrop}
          onApply={stagePhoto}
        />
      ) : null}
    </div>
  );
}
