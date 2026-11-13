"use client";

import { useEffect, useRef, useState } from "react";
import { PERSON_COLOURS } from "@/lib/calendar";

import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { ChoiceButtons, Field, Input } from "@/components/ui";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/roles";
import { DEPARTMENT_LEVELS, LEVEL_TEAMS, OFFICE_TEAM_OF_ROLE, levelOfDepartment, roleTitleOf, storedDepartmentOf, type DepartmentLevel } from "@/lib/teams";

/* 13 November 2026 (Section 12): two clean levels - Department (Mechanical, Bodyshop, Office), then the Team inside it
 * (the Team box shows only that department's teams); fields that do not apply to the role are hidden; "Bodyshop
 * manager" is its own choice (stored as a workshop manager on the bodyshop side); the red "Choose a role." clears as
 * soon as something is picked. */
const HANDS_ON = ["technician", "team_leader", "workshop_manager", "bodyshop_manager", "qc_inspector"];
const OFFICE_ROLES = ["owner", "service_advisor", "accounts", "parts", "gate_in"];
const ROLE_CHOICES = ALL_ROLES.flatMap((r) =>
  r === "workshop_manager" ? [{ value: r as string, label: ROLE_LABELS[r] }, { value: "bodyshop_manager", label: "Bodyshop manager" }] : [{ value: r as string, label: ROLE_LABELS[r] }],
);

function Tiles({ options, value, onPick, hook }: { options: { value: string; label: string; hint?: string }[]; value: string; onPick: (v: string) => void; hook: string }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5" data-choice-strip {...{ [`data-${hook}`]: value }}>
      {options.map((o) => (
        <label key={o.value || "none"} className="cursor-pointer" data-choice-option>
          <input type="radio" name={`${hook}-tile`} checked={value === o.value} onChange={() => onPick(o.value)} className="peer sr-only" data-pick={o.value} />
          <span className="flex h-full min-h-11 flex-col items-center justify-center rounded-control border border-line-strong bg-white px-3 py-2 text-center text-sm font-semibold peer-checked:border-ink peer-checked:bg-ink peer-checked:text-on-dark peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ink/30">
            {o.label}
            {o.hint ? <span className="text-xs font-medium opacity-70">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function StaffFields({ v, mode }: { v: Record<string, string>; mode: "create" | "edit" }) {
  const startRole =
    v.role_id === "workshop_manager" && roleTitleOf({ role_id: v.role_id, department_id: v.department_id, team: v.team }, "") === "Bodyshop manager" ? "bodyshop_manager" : (v.role_id ?? "");
  const [role, setRole] = useState(startRole);
  const [level, setLevel] = useState<string>(startRole === "bodyshop_manager" ? "bodyshop" : (v.department_level || levelOfDepartment(v.department_id) || ""));
  const [team, setTeam] = useState(v.team ?? "");
  const lv = (level || null) as DepartmentLevel | null;
  const pickRole = (r: string) => {
    setRole(r);
    if (r === "bodyshop_manager") {
      setLevel("bodyshop");
      if (!LEVEL_TEAMS.bodyshop.some((t) => t.key === team)) setTeam("dismantle_refit");
    } else if (OFFICE_ROLES.includes(r) && !level) setLevel("office");
  };
  const pickLevel = (l: string) => {
    setLevel(l);
    if (!LEVEL_TEAMS[l as DepartmentLevel]?.some((t) => t.key === team)) setTeam("");
  };
  const realRole = role === "bodyshop_manager" ? "workshop_manager" : role;
  const handsOn = HANDS_ON.includes(role);
  const teams = lv && lv !== "office" ? LEVEL_TEAMS[lv] : [];
  // React 19 resets the form after the action: keep the chosen tiles and hidden values as the form's defaults.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelectorAll<HTMLInputElement>("input[type=hidden], input[type=radio][data-pick]").forEach((i) => {
      if (i.type === "radio") i.defaultChecked = i.checked;
      else i.defaultValue = i.value;
    });
  });
  return (
    <div ref={root} className="contents">
      <input type="hidden" name="role_id" value={realRole} />
      <input type="hidden" name="department_level" value={level} />
      <input type="hidden" name="department_id" value={lv ? storedDepartmentOf(lv, team) : ""} />
      <input type="hidden" name="team" value={lv === "office" ? "" : team} />

      <Field label="Role">
        <Tiles options={ROLE_CHOICES} value={role} onPick={pickRole} hook="role-choice" />
      </Field>

      <Field label="Department">
        <Tiles options={DEPARTMENT_LEVELS.map((d) => ({ value: d.key, label: d.label }))} value={level} onPick={pickLevel} hook="department-choice" />
      </Field>
      {lv === "office" ? (
        <p className="text-sm text-muted" data-office-team>
          Team: <b className="text-ink">{OFFICE_TEAM_OF_ROLE[realRole] ?? "Office"}</b> (Office teams follow the role)
        </p>
      ) : lv ? (
        <Field label={`Team inside ${lv === "bodyshop" ? "Bodyshop" : "Mechanical"}`} hint="Groups this person under a team on the To-assign page and the tablets.">
          <Tiles options={[{ value: "", label: "None" }, ...teams.map((t) => ({ value: t.key, label: t.label }))]} value={team} onPick={setTeam} hook="team-choice" />
        </Field>
      ) : null}

      {role === "owner" || role === "service_advisor" ? (
        <Field label="Colour on the calendar" hint="Shows whose booking it is.">
          <div className="flex flex-wrap gap-2" data-colour-field>
            {PERSON_COLOURS.map((c) => (
              <label key={c.value} className="cursor-pointer" title={c.label}>
                <input type="radio" name="colour" value={c.value} defaultChecked={v.colour === c.value} className="peer sr-only" />
                <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-transparent peer-checked:border-ink peer-focus-visible:ring-2 peer-focus-visible:ring-ink/30">
                  <span className="block h-7 w-7 rounded-full" style={{ background: c.value }} />
                </span>
              </label>
            ))}
            <label className="cursor-pointer" title="No colour">
              <input type="radio" name="colour" value="" defaultChecked={!v.colour} className="peer sr-only" />
              <span className="flex h-11 min-w-11 items-center justify-center rounded-full border-2 border-transparent px-2 text-xs font-semibold text-muted peer-checked:border-ink">None</span>
            </label>
          </div>
        </Field>
      ) : (
        <input type="hidden" name="colour" value={v.colour ?? ""} />
      )}

      {handsOn ? (
        <Field label="Own break (optional)" hint="Leave empty for the department's break from Settings.">
          <div className="flex items-center gap-2" data-break-field>
            <Input name="break_start" type="time" defaultValue={v.break_start} className="w-36" />
            <span className="text-sm text-muted">to</span>
            <Input name="break_end" type="time" defaultValue={v.break_end} className="w-36" />
          </div>
        </Field>
      ) : (
        <>
          <input type="hidden" name="break_start" value={v.break_start ?? ""} />
          <input type="hidden" name="break_end" value={v.break_end ?? ""} />
        </>
      )}

      {mode === "create" ? (
        <Field label="How this person logs in">
          <ChoiceButtons
            name="login_type"
            columns={3}
            defaultValue={v.login_type}
            options={[
              { value: "password", label: "PC login", hint: "Email and password" },
              { value: "pin", label: "Handheld login", hint: "Name and PIN on a registered device" },
              { value: "both", label: "Both", hint: "PC and any registered handheld" },
            ]}
          />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Email" hint="Needed for PC login and Both. Optional for handheld-only users." optional>
          <Input name="email" type="email" inputMode="email" defaultValue={v.email} />
        </Field>
        <Field label="Phone" optional>
          <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone} />
        </Field>
        <Field label="Employee number" optional>
          <Input name="employee_number" defaultValue={v.employee_number} />
        </Field>
        {mode === "create" ? (
          <Field label="4-digit PIN" hint="Needed for handheld login and Both. The PIN is scrambled before it is stored.">
            <Input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="1234" defaultValue={v.pin} autoComplete="off" />
          </Field>
        ) : null}
      </div>

      {role === "accounts" ? (
        <label className="flex items-center gap-3 min-h-11 cursor-pointer" data-head-accountant-field>
          <input type="checkbox" name="is_head_accountant" defaultChecked={v.is_head_accountant === "on"} className="h-5 w-5 accent-ink" />
          <span className="text-sm font-semibold">Head accountant (can approve LPOs later)</span>
        </label>
      ) : null}
    </div>
  );
}

export function StaffForm({
  action,
  initialValues,
  mode,
}: {
  action: FormAction;
  initialValues?: Record<string, string>;
  mode: "create" | "edit";
}) {
  return (
    <ActionForm action={action} initialValues={initialValues} clearErrorOnChange>
      {(v) => (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name">
              <Input name="full_name" defaultValue={v.full_name} required minLength={2} autoFocus={mode === "create"} />
            </Field>
            <Field label="Short name" hint="What appears on screens and tablet tiles, e.g. Rashid">
              <Input name="display_name" defaultValue={v.display_name} required />
            </Field>
          </div>

          <StaffFields v={v} mode={mode} />

          <div className="flex gap-2">
            <SubmitButton>{mode === "create" ? "Add staff member" : "Save changes"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
