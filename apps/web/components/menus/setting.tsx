"use client";

import * as React from "react";
import { Globe, Image as ImageIcon, Rows3 } from "lucide-react";

import type { AccessMode } from "@/lib/access";
import { useI18n } from "@/lib/i18n";
import {
  useTheme,
  type ThemePref,
} from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/ui/dropzone";
import { Field, FormGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { Segmented, SegmentedButton } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";

export function SettingMenu({ mode }: { mode: AccessMode }) {
  const { t } = useI18n();
  const canW = mode === "manage";

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.navSettings} sub={t.stSub} />
      <AppTab canW={canW} />
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
