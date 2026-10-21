// Loads every season in src/data/seasons/, newest first.
// A season marked `draft: true` appears in `npm run dev` (and in the admin)
// but is never built into the live site.

export interface KV { k: string; v: string }
export interface Change { before: string; after: string; delta: string; deltaLabel: string }
export interface Subsystem {
  n: string; name: string; shot: string; marker: { x: string; y: string };
  photo?: string | null; body: string; detail?: string; specs: KV[];
}
export interface SubVersion {
  id: string; date: string; title: string; summary: string;
  points?: KV[];              // the overview, as short labelled lines under the summary
  photo?: string | null; specs?: KV[]; changes?: Change[];
  subsystems?: Subsystem[];   // a revision's own parts, marked on its own photograph
}
export interface Version extends SubVersion {
  specs: KV[]; subsystems: Subsystem[]; subversions?: SubVersion[];
}
export interface Season {
  years: string; game: string; draft?: boolean; summary: string;
  aims?: { aim: string; done?: boolean }[];   // what the team set out to do; done = met
  record: KV[];
  awards: { name: string; event: string; note: string; image?: string }[];
  events: { date: string; name: string; venue: string; result: string; note?: string }[];
  robot: { software: string; versions: Version[] };
}

/** One stop on the version slider: a major version or one of its sub-versions. */
export interface Step {
  id: string;            // "V2.1"
  major: string;         // "V2"
  isSub: boolean;
  date: string; title: string; summary: string;
  photo: string | null;  // falls back to the parent version's photo
  specs: KV[];           // parent specs, with this step's values overriding by label
  changes: Change[];
  subsystems: Subsystem[];   // the parts marked on this step's photograph
  points: KV[];
}

export interface SeasonView extends Season {
  slug: string;          // "2025-26", used in URLs and element ids
  steps: Step[];
}

const files = import.meta.glob<{ default: Season }>('../data/seasons/*.json', { eager: true });

const slugOf = (years: string) =>
  years.replace(/\[|\]/g, '').replace(/[–—]/g, '-').replace(/[^0-9A-Za-z-]+/g, '-').toLowerCase();

function mergeSpecs(base: KV[], over: KV[] = []): KV[] {
  const out = base.map((s) => ({ ...s }));
  for (const o of over) {
    const hit = out.find((s) => s.k === o.k);
    if (hit) hit.v = o.v; else out.push({ ...o });
  }
  return out;
}

function stepsOf(season: Season): Step[] {
  const steps: Step[] = [];
  for (const v of season.robot?.versions ?? []) {
    steps.push({
      id: v.id, major: v.id, isSub: false, date: v.date, title: v.title, summary: v.summary,
      photo: v.photo ?? null, specs: v.specs ?? [], changes: v.changes ?? [],
      subsystems: v.subsystems ?? [], points: v.points ?? [],
    });
    for (const s of v.subversions ?? []) {
      steps.push({
        id: s.id, major: v.id, isSub: true, date: s.date, title: s.title, summary: s.summary,
        photo: s.photo ?? v.photo ?? null, specs: mergeSpecs(v.specs ?? [], s.specs), changes: s.changes ?? [],
        // markers belong to a photograph, so they are never inherited from the parent
        subsystems: s.subsystems ?? [], points: s.points ?? [],
      });
    }
  }
  return steps;
}

export const seasons: SeasonView[] = Object.values(files)
  .map((m) => m.default)
  .filter((s) => import.meta.env.DEV || !s.draft)
  .sort((a, b) => b.years.localeCompare(a.years))
  .map((s) => ({ ...s, slug: slugOf(s.years), steps: stepsOf(s) }));

/** The newest season: what the switches open on. */
export const current: SeasonView = seasons[0];

/** The newest season with results in it. A season that has only just started
    has no record, awards or robot yet, so the home page's record plate, robot
    and awards come from here rather than from an empty new season. */
export const lastCompleted: SeasonView =
  seasons.find((s) => s.events.length > 0 || s.awards.length > 0) ?? current;

/** Seasons that have a robot to show. */
export const seasonsWithRobot: SeasonView[] = seasons.filter((s) => s.steps.length > 0);

/** The newest step of a season, revision or not: the robot as it last competed.
    This is what the home page shows. */
export const latestVersion = (s: SeasonView): Step | undefined => s.steps[s.steps.length - 1];
