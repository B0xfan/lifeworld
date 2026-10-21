// Types for the type-aware lint (tsconfig.json); never bundled. The source stays plain JS and
// names these in JSDoc. Global on purpose: every file can name them without an import.

/** A note's frontmatter (or any parsed YAML/JSON object): keys known only at run time. */
type Fm = Record<string, unknown>;

/** A repeat rule read by parseRRule (src/core/dates.js). */
interface RRule {
  freq?: string; dtstart?: string | null; interval: number;
  byday: { n: number; wd: number }[] | null; bymonthday: number[] | null; bymonth: number[] | null; bysetpos: number[] | null;
  count: number | null; until: string | null; wkst: number; exdates: string[];
}

/** A task note as every part reads it (taskFromFrontmatter, src/core/tasks.js). */
interface TaskItem {
  path: string; title: string; status: string; priority: string; due: string | null;
  plannedDay: string | null; plannedHalf: 'am' | 'pm' | null; plannedOrder: number; time: string | null;
  reminder: number | null; project: string | null; recurrenceRaw: string | null; recurrence: RRule | null;
  completeInstances: string[]; skippedInstances: string[]; blockedBy: string[];
}

/** The four parts by their old plugin ids (src/core/parts.js). */
interface PartTypes {
  'a4-projects': import('./projects/main').default;
  'a4-today': import('./today/main').default;
  'a4-planner': import('./planner/main').default;
  'a4-sidebar': import('./sidebar/main').default;
}

/** Obsidian's bundled moment. Its typings import moment as a namespace, which TypeScript does not let
 * code call; the code calls it, so it is cast to moment's own function type where used. */
type MomentFn = typeof import('moment');

/** What quick add read from a typed line (understand, src/core/quickadd.js). */
interface Understood {
  title?: string; priority: string | null; due?: string | null; start?: string; plannedDay?: string | null; plannedHalf?: 'am' | 'pm' | null;
  recurrence?: string; repeatText?: string; time?: string; startTime?: string;
}

/** A new task as quick add hands it over (quickAddPlan): TaskNotes' own fields plus extra frontmatter. */
interface NewTaskInput {
  title?: string; priority?: string; due?: string | null; scheduled?: string | null; recurrence?: string;
  status?: string; contexts?: string[]; projects?: string[]; tags?: string[]; details?: string; reminders?: unknown[];
  customFrontmatter?: Fm; [key: string]: unknown;
}

/** A saved calendar link (src/core/calendars.js). */
interface CalLink { id: string; url: string; name: string; named?: boolean }
/** One calendar event, the shape the calendar note and the calendar links both give. */
interface CalEvent { date: string; time: string | null; end: string | null; all_day: boolean; summary: string; calendar: string }

/** Weather settings after normalizeWeather (src/core/weather.js). */
interface WeatherSettings { place: { name: string; lat: number; lon: number } | null; span: 'hours' | 'days'; units: 'c' | 'f'; tides: boolean; tideSrc: 'om' | 'sg' }
/** The weather shape both the weather note and Open-Meteo give the Today strip. */
interface WeatherData {
  temp?: number; weathercode?: number; description: string; high: number | null; low: number | null; rain_chance: number | null;
  sunrise: string; sunset: string; updated: string; next: string[]; day: string; timezone: string | null; tides_today?: { type: string; time: string }[];
}
/** The parts of Open-Meteo's forecast answer LifeWorld reads (open-meteo.com/en/docs). */
interface OpenMeteoForecast {
  timezone?: string;
  current?: { time?: string; temperature_2m?: number; weather_code?: number };
  hourly?: { time?: string[]; temperature_2m?: number[] };
  daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[]; sunrise?: string[]; sunset?: string[] };
}

/** One checkbox line read by parseCheckbox (src/core/sources.js). */
interface CheckboxLine {
  prefix: string; bullet: string; mark: string; open: boolean; body: string; title: string;
  due: string | null; scheduled: string | null; start: string | null; created: string | null; done: string | null; cancelled: string | null;
  priority: string; repeat: string; blockId: string; [sign: string]: unknown;
}
/** Where a task from another app or a checkbox line lives (extItem's `ext`). */
interface ExtInfo { source: string; id: string; url: string | null; file?: string; line?: number; text?: string; start?: string | null; doneDay?: string | null; created?: string | null; recurring?: boolean; list?: string | null }
/** A task item from a source (extItem): the task note shape plus where it lives. */
interface ExtItem extends TaskItem { projectKey: string | null; projectLink: string | null; repeats: boolean; ext: ExtInfo }
/** What a task source needs from the plugin that owns it (Projects). */
interface SourceHost { app: import('obsidian').App; settings: { cbTag: string; cuList: string }; projectNoteKeys?: () => Map<string, string> }
/** An error this code throws: a status from a web answer, or a plain sentence to show. */
type AppError = Error & { status?: number; plain?: string };

/** A task status or priority as the engine knows it (engineConfig, src/projects/main.js). */
interface StatusDef { value: string; label: string; isCompleted: boolean; autoArchive: boolean; autoArchiveDelay: number; order?: number }
interface PriorityDef { value: string; label: string; weight: number }
/** The task engine's settings (engineConfig): TaskNotes' field names, statuses, priorities and defaults. */
interface EngineCfg {
  F: Record<string, string>; statuses: StatusDef[]; priorities: PriorityDef[];
  tasksFolder: string; archiveFolder: string; moveArchivedTasks: boolean; taskTag: string; defaultStatus: string; defaultPriority: string;
  storeTitleInFilename: boolean; maintainDueOffset: boolean; defaultTags: string; defaultProjects: string; defaultContexts: string;
}
/** The repeat-relevant part of a task note, as TaskNotes' TaskInfo holds it (tnTaskOf). */
interface TnTask {
  recurrence?: string; recurrence_anchor?: string; scheduled?: string; due?: string; dateCreated?: string;
  complete_instances: string[]; skipped_instances: string[]; googleCalendarExceptionOriginalScheduled?: string;
}

/** A task as Projects reads it (readTask): the shared task fields plus what Projects shows. */
interface ProjTask extends TaskItem {
  archived: boolean; projectLink: string | null; projectKey: string | null; completedDate: string | null; dateCreated: string | null;
  modified: string | null; start: string | null; scheduled: string | null; dueTime: string | null; startTime: string | null; reminderSet: number | null;
  steps?: { total: number; done: number }; openBlockers?: { path: string; title: string }[]; blocks?: { path: string; title: string }[]; ext?: ExtInfo; repeats?: boolean; weeklyGoal?: boolean;
}
/** A project note (readProject); area fields are set by linkAreas. */
interface ProjNote {
  path: string; name: string; key: string; sphere: string; status: string; parentArea: string | null; goal: string | null; client: string | null;
  endDate: string | null; why: string; storedFrom: string; area?: string; areaName?: string; areaPath?: string; areaBad?: string; isArea?: false; mtime?: number;
}
/** An area note (readArea). */
interface AreaNote { path: string; name: string; key: string; isArea: true; sphere: string; goal: string | null; client: string | null; mtime?: number }

/** An auto-archive entry (TaskNotes' AutoArchiveService queue shape). */
interface ArchiveEntry { taskPath: string; statusChangeTimestamp?: number; archiveAfterTimestamp: number; statusValue?: string }
/** Projects' own settings after normalizeSettings (src/projects/main.js). */
interface ProjSettings {
  source: string; cbTag: string; cuList: string; hideProps: boolean; tnSnapshot: Fm | null; archiveQueue: ArchiveEntry[];
  ui: { closedOpen: boolean; doneOpen: Record<string, boolean>; later: Record<string, boolean>; someday: Record<string, boolean>; view: 'board' | 'list'; kind: string };
  activity: { at: number; text: string }[];
}
/** The TaskNotes plugin, as far as LifeWorld reads it (its live settings). */
interface TaskNotesPlugin { settings?: Fm; api?: TaskApi }
/** What a write returns: its result and how to take it back. */
interface Undoable<R> { result: R; undo: () => Promise<void> }

/** A task as the TaskNotes-shaped API reports it (TaskEngine.makeApi, TaskNotes' own api). */
interface ApiTaskInfo { path?: string; id?: string; title?: string; status?: string; complete_instances?: string[] }
/** The TaskNotes-shaped task API Today and the Planner call (TaskEngine.makeApi, or TaskNotes' own). */
interface TaskApi {
  apiVersion: number; source?: string; hasCapability(c: string): boolean; lifecycle?: { isReady(): boolean };
  tasks: { complete(path: string): Promise<ApiTaskInfo>; uncomplete(path: string): Promise<ApiTaskInfo>; create(data: NewTaskInput): Promise<ApiTaskInfo> };
  recurring: { toggleCompleteInstance(path: string, day?: unknown): Promise<ApiTaskInfo> };
}

/** A task as the Planner draws it (plannerItem, src/planner/main.js; or a source's item). */
interface PlanItem extends TaskItem {
  projectKey: string | null; projectLink: string | null; weeklyGoal: boolean; ext?: ExtInfo; repeats?: boolean;
  blockers?: { path: string; title: string }[];
}
/** A priority row as the Planner draws it (priorityTable). */
interface PlanPriority { value: string; label: string; weight: number; bars: number; top: boolean; rank: number }
/** One calendar event as the Planner draws it (eventsForDay). */
interface PlanEvent { date: string | null; time: string | null; end: string | null; allDay: boolean; summary: string; calendar: string }

/** The Sidebar's own content (src/core/vault.js sidebarContent). */
interface SidebarContent {
  brand: string; life: string; groups: { id: string; label: string; folders: string[] }[]; icons: Record<string, string>; labels: Record<string, string>;
  noCount: string[]; rooms: { prefix: string; name: string; icon: string }[]; basesSkip: string[];
}
/** Sort settings (normalizeSort, src/sidebar/main.js). */
interface SortSettings { dates: 'first' | 'last'; text: 'az' | 'za'; folders: boolean; newestFirstIn: string[]; perFolder: Record<string, string> }
/** An add-on's Sidebar addition (LifeWorld's addSidebarItem and friends). */
interface SidebarExtra { id?: string; item?: string; command?: string; label?: string; icon?: string; before?: string; onClick?: () => unknown; draw?: (el: HTMLElement) => unknown }

/** A task as the Today page draws it (taskFromFrontmatter's item, or a source's). */
interface TodayItem extends TaskItem { projectLink?: unknown; projectKey?: string | null; ext?: ExtInfo; repeats?: boolean; blockers?: { path: string; title: string }[] }
/** The Today page's look (accent colour and handwriting font). */
interface TodayLook { accent: string; font: string }

/** A part as LifeWorld (src/main.js) handles it: the plugin plus the optional hooks some parts have. */
type PartPlugin = import('obsidian').Plugin & {
  pagesOff?: boolean; calendarSync?: unknown; settingTab?: PartSettingTab | null;
  extrasChanged?: () => unknown; onVaultChange?: () => unknown; onExternalSettingsChange?: () => Promise<unknown>;
  cards?: { refreshAll(): void }; settings?: { source?: string };
};
/** A part's settings page, drawn inside LifeWorld's own. */
type PartSettingTab = import('obsidian').PluginSettingTab & { calHost?: HTMLElement; renderCalendars?: () => void; hide?: () => void };
