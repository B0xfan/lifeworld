// The undocumented parts of Obsidian's app object LifeWorld reads, typed for the lint only
// (never bundled). Each is read defensively in the code, since Obsidian can change them.
import 'obsidian';

declare module 'obsidian' {
  // Narrower than Obsidian's own `any`: these overloads come first, so frontmatter, saved data and
  // local storage read as unknown values the code checks before use (its runtime behaviour as before).
  interface FileManager {
    processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void, options?: DataWriteOptions): Promise<void>;
  }
  interface Plugin {
    loadData(): Promise<unknown>;
  }
  interface App {
    loadLocalStorage(key: string): unknown;
    internalPlugins?: { getEnabledPluginById?(id: string): { options?: Record<string, unknown> } | null; getPluginById?(id: string): { instance?: { revealInFolder?(file: TAbstractFile): void } } | null };
    plugins?: { plugins?: Record<string, unknown> };
    commands?: { commands?: Record<string, unknown>; executeCommandById(id: string): boolean };
    metadataTypeManager?: { getAssignedWidget?(name: string): unknown; setType?(name: string, type: string): unknown };
    setting: { open(): void; openTabById?(id: string): unknown };
    changeTheme?(id: string): void;
    updateTheme?(): void;
    dragManager?: { dragFile?(e: DragEvent, file: TFile): unknown; onDragStart(e: DragEvent, data: unknown): void; draggable?: { file?: TAbstractFile | null; type?: string } | null };
    importAttachments?(entries: { name: string; extension: string; filepath: string; data: Promise<ArrayBuffer> }[], folder: TFolder): Promise<(TFile | null)[]>;
  }
  interface Vault { getAbstractFileByPathInsensitive?(path: string): TAbstractFile | null; getConfig?(key: string): unknown; setConfig?(key: string, value: unknown): void; saveConfig?(): unknown }
  interface FileManager { promptForDeletion(file: TAbstractFile): Promise<void> }
  interface Menu { dom?: HTMLElement }
  interface MenuItem { setSubmenu?(): Menu }
  interface WorkspaceParent { children?: WorkspaceItem[]; selectTab?(leaf: WorkspaceLeaf): void }
  // Menu's own item and section lists (not in Obsidian's typings), read defensively.
  interface Menu { items?: unknown[]; sections?: string[]; lifeworldNoTn?: boolean }
}

declare global {
  // Electron's require, desktop only (the Things 3 source, behind a Mac desktop check).
  interface Window { require: (id: string) => unknown }
}
