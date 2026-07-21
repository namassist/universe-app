"use client";

import * as React from "react";
import { Globe, Image as ImageIcon, Menu, Music, Rows3 } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import {
  useTheme,
  type ThemePref,
} from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Checkbox, ToggleRow } from "@/components/ui/checkbox";
import { Dropzone } from "@/components/ui/dropzone";
import { Field, FormGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";

type StTab = "app" | "audio" | "menu";
type MenuVis = Record<
  "display" | "roster" | "employees" | "ftw" | "asset" | "master" | "users",
  boolean
>;

export function SettingMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const [stTab, setStTab] = React.useState<StTab>("app");
  const canW = mode === "manage";

  const tabs: { key: StTab; label: string }[] = [
    { key: "app", label: t.stTabApp },
    { key: "audio", label: t.stTabAudio },
    { key: "menu", label: t.stTabMenu },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navSettings} sub={t.stSub}>
        <Segmented role="tablist" aria-label="Settings">
          {tabs.map((tab) => (
            <SegmentedButton
              key={tab.key}
              role="tab"
              active={stTab === tab.key}
              aria-selected={stTab === tab.key}
              onClick={() => setStTab(tab.key)}
            >
              {tab.label}
            </SegmentedButton>
          ))}
        </Segmented>
      </PageTitle>

      {stTab === "app" ? (
        <AppTab canW={canW} />
      ) : stTab === "audio" ? (
        <AudioTab />
      ) : (
        <MenuTab canW={canW} />
      )}
    </div>
  );
}

function AppTab({ canW }: { canW: boolean }) {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { pref, setTheme } = useTheme();

  const [name, setName] = React.useState("UNIVERSE");
  const [desc, setDesc] = React.useState(
    "Unggul Network for Integrated Vehicle Resource Smart Ecosystem"
  );
  const [g, setG] = React.useState({
    allocCreatePagi: "04:00",
    allocGeneratePagi: "05:00",
    allocCreateMalam: "16:00",
    allocGenerateMalam: "17:00",
    attGateStaf: "07:00",
  });
  const [logoName, setLogoName] = React.useState("");
  const [logoDrag, setLogoDrag] = React.useState(false);
  const [favName, setFavName] = React.useState("");
  const [favDrag, setFavDrag] = React.useState(false);
  const logoRef = React.useRef<HTMLInputElement>(null);
  const favRef = React.useRef<HTMLInputElement>(null);

  const themeOpts: { key: ThemePref; label: string }[] = [
    { key: "system", label: t.themeSystem },
    { key: "light", label: t.themeLight },
    { key: "dark", label: t.themeDark },
  ];

  const gateFields: { key: keyof typeof g; label: string }[] = [
    { key: "allocCreatePagi", label: t.stGateCreatePagi },
    { key: "allocGeneratePagi", label: t.stGateGenPagi },
    { key: "allocCreateMalam", label: t.stGateCreateMalam },
    { key: "allocGenerateMalam", label: t.stGateGenMalam },
    { key: "attGateStaf", label: t.stGateStaf },
  ];

  return (
    <Panel className="max-w-[760px]">
      <SectionTitle>
        <Rows3 />
        {t.stTabApp}
      </SectionTitle>
      <FormGrid>
        <Field
          label={t.stAppName}
          htmlFor="st-name"
          required
          helper={t.stAppNameHelp}
        >
          <Input
            id="st-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t.stTheme} helper={t.stThemeHelp}>
          <Segmented role="group" aria-label={t.stTheme}>
            {themeOpts.map((o) => (
              <SegmentedButton
                key={o.key}
                type="button"
                active={pref === o.key}
                onClick={() => setTheme(o.key)}
              >
                {o.label}
              </SegmentedButton>
            ))}
          </Segmented>
        </Field>
        <Field className="col-span-full" label={t.stAppDesc} htmlFor="st-desc">
          <Textarea
            id="st-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </Field>
        <Field label={t.stLogo}>
          <Dropzone
            icon={<ImageIcon />}
            title={logoName || t.stLogoPh}
            hint="PNG/SVG · 1:1"
            className="p-4"
            onPick={() => logoRef.current?.click()}
            onDropFile={setLogoName}
            dragging={logoDrag}
            onDragChange={setLogoDrag}
            aria-label={t.stLogo}
          />
          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setLogoName(e.target.files?.[0]?.name ?? "")}
          />
        </Field>
        <Field label={t.stFavicon}>
          <Dropzone
            icon={<Globe />}
            title={favName || t.stFavPh}
            hint="ICO/PNG · 32×32"
            className="p-4"
            onPick={() => favRef.current?.click()}
            onDropFile={setFavName}
            dragging={favDrag}
            onDragChange={setFavDrag}
            aria-label={t.stFavicon}
          />
          <input
            ref={favRef}
            type="file"
            accept="image/*,.ico"
            className="hidden"
            onChange={(e) => setFavName(e.target.files?.[0]?.name ?? "")}
          />
        </Field>
        <Field
          className="col-span-full"
          label={t.stGatesT}
          helper={t.stGatesHelp}
        >
          <div className="grid grid-cols-2 gap-4 min-[560px]:grid-cols-3">
            {gateFields.map((f) => (
              <label
                key={f.key}
                className="flex flex-col gap-1 text-xs text-(--text-tertiary)"
              >
                {f.label}
                <Input
                  type="time"
                  className="font-mono"
                  value={g[f.key]}
                  disabled={!canW}
                  onChange={(e) =>
                    setG((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
        </Field>
      </FormGrid>
      <div className="mt-5 flex justify-end">
        {canW ? (
          <Button onClick={() => pushToast("success", t.stSavedT, t.stSavedD)}>
            {t.stSave}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

function AudioTab() {
  const { t } = useI18n();
  return (
    <Panel className="max-w-[760px]">
      <SectionTitle>
        <Music />
        {t.stTabAudio}
      </SectionTitle>
      <p className="text-sm text-(--text-secondary)">{t.stSub}</p>
    </Panel>
  );
}

function MenuTab({ canW }: { canW: boolean }) {
  const { t } = useI18n();
  const [menuVis, setMenuVis] = React.useState<MenuVis>({
    display: true,
    roster: true,
    employees: true,
    ftw: true,
    asset: true,
    master: true,
    users: true,
  });

  const rows: { key: keyof MenuVis; label: string; sub?: string }[] = [
    {
      key: "display",
      label: t.navDisplay,
      sub: `${t.navDispAtt}, ${t.navDispFleet}`,
    },
    {
      key: "roster",
      label: t.navRoster,
      sub: "Upload, revisi, approval, attendance",
    },
    { key: "employees", label: t.navEmployees },
    { key: "ftw", label: t.navFtw },
    { key: "asset", label: t.navAsset },
    { key: "master", label: t.navMaster },
    { key: "users", label: t.navUsers },
  ];
  const locked = [t.navDashboard, t.navSettings];

  return (
    <Panel className="max-w-[640px]">
      <SectionTitle>
        <Menu />
        {t.stTabMenu}
      </SectionTitle>
      <p className="mb-5 text-sm text-(--text-secondary)">{t.stMenuHelp}</p>
      <div className="flex flex-col gap-2">
        <LockedRow label={locked[0]!} caption={t.stMenuLocked} />
        {rows.map((m) => (
          <ToggleRow key={m.key} className="justify-between">
            <span className="inline-flex items-center gap-3">
              <b className="text-sm font-semibold">{m.label}</b>
              {m.sub ? (
                <span className="text-xs text-(--text-tertiary)">{m.sub}</span>
              ) : null}
            </span>
            <Checkbox
              checked={menuVis[m.key]}
              disabled={!canW}
              onChange={(e) =>
                setMenuVis((prev) => ({ ...prev, [m.key]: e.target.checked }))
              }
            />
          </ToggleRow>
        ))}
        <LockedRow label={locked[1]!} caption={t.stMenuLocked} />
      </div>
    </Panel>
  );
}

function LockedRow({ label, caption }: { label: string; caption: string }) {
  return (
    <ToggleRow className="justify-between">
      <span className="inline-flex items-center gap-3">
        <b className="text-sm font-semibold">{label}</b>
        <span className="text-xs text-(--text-tertiary)">{caption}</span>
      </span>
      <Checkbox checked disabled readOnly />
    </ToggleRow>
  );
}
