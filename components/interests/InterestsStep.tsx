"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CHIPS,
  GROUPS,
  GROUP_KEYS,
  activeGroups,
  customKey,
  emptyMix,
  initialMix,
  reconcileMix,
  setGroupShare,
  type CustomChip,
  type Group,
  type Mix,
} from "@/lib/interests";
import type { InterestsState, RequirementRule } from "@/lib/schemas";
import { saveInterestsAction } from "@/app/trip/[id]/actions";

const GROUP_COLOR: Record<Group, string> = {
  outdoors: "bg-emerald-500",
  city: "bg-sky-500",
  food: "bg-amber-500",
  nightlife: "bg-violet-500",
  wellness: "bg-rose-400",
};

const REQUIREMENT_EXAMPLES = ["At least two hikes", "One really nice dinner", "No clubbing", "Slow mornings — nothing before 10am"];

const RULE_ICON: Record<RequirementRule["kind"], string> = {
  min_count: "✓",
  must_include: "📍",
  max_count: "≤",
  exclude: "✕",
  time_pref: "🕙",
  other: "•",
};

export function InterestsStep({
  tripId,
  initial,
  family,
  destinationName,
}: {
  tripId: string;
  initial: InterestsState | null;
  family: boolean;
  destinationName: string | null;
}) {
  const router = useRouter();
  const [chips, setChips] = useState<string[]>(initial?.chips ?? (family ? ["kid_friendly"] : []));
  const [custom, setCustom] = useState<CustomChip[]>(initial?.custom ?? []);
  const [mix, setMix] = useState<Mix>(initial?.mix ?? emptyMix());
  const [requirements, setRequirements] = useState<string[]>(initial?.requirements.length ? initial.requirements : [""]);
  const [customDraft, setCustomDraft] = useState("");
  const [customGroup, setCustomGroup] = useState<Group>("city");
  const [saved, setSaved] = useState<InterestsState | null>(initial);
  const [dirty, setDirty] = useState(false);
  // Until the traveler moves a slider, the mix follows how many chips they picked per group.
  const [mixTouched, setMixTouched] = useState(Boolean(initial));
  const nextMix = (nextChips: string[], nextCustom: CustomChip[]) =>
    mixTouched ? reconcileMix(mix, activeGroups(nextChips, nextCustom)) : initialMix(nextChips, nextCustom);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = activeGroups(chips, custom);

  const touch = () => {
    setDirty(true);
    setError(null);
  };

  const toggleChip = (key: string) => {
    const next = chips.includes(key) ? chips.filter((k) => k !== key) : [...chips, key];
    setChips(next);
    setMix(nextMix(next, custom));
    touch();
  };

  const addCustom = () => {
    const label = customDraft.trim();
    if (!label) return;
    const key = customKey(label);
    if (!custom.some((c) => c.key === key) && custom.length < 12) {
      const nextCustom = [...custom, { key, label, group: customGroup }];
      const nextChips = [...chips, key];
      setCustom(nextCustom);
      setChips(nextChips);
      setMix(nextMix(nextChips, nextCustom));
      touch();
    }
    setCustomDraft("");
  };

  const removeCustom = (key: string) => {
    const nextCustom = custom.filter((c) => c.key !== key);
    const nextChips = chips.filter((k) => k !== key);
    setCustom(nextCustom);
    setChips(nextChips);
    setMix(nextMix(nextChips, nextCustom));
    touch();
  };

  const save = () => {
    startTransition(async () => {
      const res = await saveInterestsAction({ tripId, chips, custom, mix, requirements });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The server may have adjusted chips/mix to honor hard requirements.
      setChips(res.interests.chips);
      setMix(res.interests.mix);
      setSaved(res.interests);
      setDirty(false);
      if (!res.interests.rules.length && !res.interests.notices.length) router.push(`/trip/${tripId}/discover`);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-label="Interests">
        <div>
          <h2 className="text-lg font-medium">What are you into{destinationName ? ` in ${destinationName.split(",")[0]}` : ""}?</h2>
          <p className="text-sm text-slate-600">Pick everything that sounds like you. This drives what we research and how your days are filled.</p>
        </div>

        {GROUP_KEYS.map((g) => {
          const groupChips = [...CHIPS.filter((c) => c.group === g), ...custom.filter((c) => c.group === g)];
          return (
            <div key={g} className="space-y-1.5">
              <div className="text-sm font-medium text-slate-700">
                {GROUPS[g].emoji} {GROUPS[g].label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groupChips.map((c) =>
                  c.key.startsWith("custom_") ? (
                    <span key={c.key} className="inline-flex items-center gap-0.5">
                      <ChipButton label={c.label} on={chips.includes(c.key)} onClick={() => toggleChip(c.key)} />
                      <button
                        type="button"
                        aria-label={`Delete ${c.label}`}
                        onClick={() => removeCustom(c.key)}
                        className="px-1 text-sm text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <ChipButton key={c.key} label={c.label} on={chips.includes(c.key)} onClick={() => toggleChip(c.key)} />
                  ),
                )}
              </div>
            </div>
          );
        })}

        <div className="space-y-1.5">
          <div className="text-sm font-medium text-slate-700">✳️ Good to know</div>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.filter((c) => c.group === "modifier").map((c) => (
              <ChipButton key={c.key} label={c.label} on={chips.includes(c.key)} onClick={() => toggleChip(c.key)} />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <input
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            maxLength={40}
            placeholder="Add your own, e.g. Vintage shops"
            aria-label="Custom interest"
            className="min-w-0 basis-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:basis-auto sm:flex-1"
          />
          <select
            value={customGroup}
            onChange={(e) => setCustomGroup(e.target.value as Group)}
            aria-label="Custom interest group"
            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            {GROUP_KEYS.map((g) => (
              <option key={g} value={g}>
                {GROUPS[g].label}
              </option>
            ))}
          </select>
          <button type="button" onClick={addCustom} className="rounded-lg bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">
            Add
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-label="Your mix">
        <div>
          <h2 className="text-lg font-medium">Your mix</h2>
          <p className="text-sm text-slate-600">How you&apos;d like your time split. Moving one slider rebalances the others.</p>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-slate-500">Pick some interests above to set your mix.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              {groups.map((g) => (
                <div key={g} className={GROUP_COLOR[g]} style={{ width: `${mix[g]}%` }} />
              ))}
            </div>
            <p className="text-sm font-medium" data-testid="mix-summary">
              {groups.map((g) => `${GROUPS[g].label} ${mix[g]}%`).join(" / ")}
            </p>
            <div className="space-y-3">
              {groups.map((g) => (
                <label key={g} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0">
                    {GROUPS[g].emoji} {GROUPS[g].label}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={mix[g]}
                    disabled={groups.length === 1}
                    aria-label={`${GROUPS[g].label} share`}
                    onChange={(e) => {
                      setMix(setGroupShare(mix, groups, g, Number(e.target.value)));
                      setMixTouched(true);
                      touch();
                    }}
                    className="flex-1"
                  />
                  <span className="w-10 text-right font-mono">{mix[g]}%</span>
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-label="Hard requirements">
        <div>
          <h2 className="text-lg font-medium">Hard requirements <span className="font-normal text-slate-500">(optional)</span></h2>
          <p className="text-sm text-slate-600">Must-haves and deal-breakers, in your own words. Every plan we make will respect them.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REQUIREMENT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                const filled = requirements.filter((r) => r.trim());
                if (!filled.includes(ex) && filled.length < 10) setRequirements([...filled, ex]);
                touch();
              }}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
            >
              + {ex}
            </button>
          ))}
        </div>
        <ul className="space-y-2">
          {requirements.map((r, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={r}
                onChange={(e) => {
                  setRequirements(requirements.map((x, j) => (j === i ? e.target.value : x)));
                  touch();
                }}
                maxLength={200}
                placeholder='e.g. "at least two hikes"'
                aria-label={`Requirement ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                aria-label={`Remove requirement ${i + 1}`}
                onClick={() => {
                  const next = requirements.filter((_, j) => j !== i);
                  setRequirements(next.length ? next : [""]);
                  touch();
                }}
                className="text-slate-400 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        {requirements.length < 10 && (
          <button type="button" onClick={() => setRequirements([...requirements, ""])} className="text-sm text-slate-700 underline">
            + Add another
          </button>
        )}
      </section>

      {saved && !dirty && (saved.rules.length > 0 || saved.notices.length > 0) && (
        <section className="space-y-3 rounded-xl bg-emerald-50 p-5 ring-1 ring-emerald-200" aria-label="How we understood you">
          <h2 className="font-medium">Here&apos;s how we understood your requirements</h2>
          <ul className="space-y-1 text-sm">
            {saved.rules.map((r) => (
              <li key={r.text}>
                <span className="mr-1.5 inline-block w-4 text-center">{RULE_ICON[r.kind]}</span>
                <strong>{r.summary}</strong> <span className="text-slate-500">— “{r.text}”</span>
              </li>
            ))}
          </ul>
          {saved.notices.length > 0 && (
            <ul className="space-y-1 text-sm text-emerald-900">
              {saved.notices.map((n) => (
                <li key={n}>ℹ️ {n}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-600">Not right? Reword a requirement above and save again.</p>
          <Link
            href={`/trip/${tripId}/discover`}
            className="inline-block rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-700"
          >
            Continue to discovery →
          </Link>
        </section>
      )}

      {error && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      )}

      {(dirty || !saved) && (
        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <button
            type="button"
            onClick={save}
            disabled={pending || groups.length === 0}
            className="w-full rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700 disabled:opacity-50 sm:w-auto"
          >
            {pending ? "Saving…" : "Save and continue →"}
          </button>
        </div>
      )}
      {saved && !dirty && !saved.rules.length && !saved.notices.length && (
        <Link href={`/trip/${tripId}/discover`} className="inline-block rounded-lg bg-slate-900 px-5 py-2 text-white hover:bg-slate-700">
          Continue to discovery →
        </Link>
      )}
    </div>
  );
}

function ChipButton({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
        on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
      }`}
    >
      {on && "✓ "}
      {label}
    </button>
  );
}
