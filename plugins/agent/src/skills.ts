import { normalizePath, TFile, type App } from 'obsidian';
import type { AgentData } from './data.ts';

export function discoverSkills(app: App, folders: string[]): TFile[] {
  const allowed = folders
    .map((folder) => folder.trim())
    .filter(Boolean)
    .map((folder) => normalizePath(folder))
    .filter(
      (folder) =>
        folder.length > 0 &&
        !folder.startsWith('/') &&
        folder.split('/').every((segment) => segment.length > 0 && !segment.startsWith('.')),
    );
  return app.vault.getMarkdownFiles().filter((file) => {
    if (file.name !== 'SKILL.md') return false;
    if (file.path.split('/').some((part) => part.startsWith('.'))) return false;
    return allowed.some((folder) => file.path.startsWith(`${folder}/`));
  });
}

export async function skillInstructions(app: App, data: AgentData): Promise<string> {
  const enabled = new Set(data.enabledSkills);
  const files = discoverSkills(app, data.skillFolders).filter((file) => enabled.has(file.path));
  const entries = await Promise.all(
    files.map(async (file) => {
      const content = await app.vault.cachedRead(file);
      return `Skill ${file.path}:\n${content.slice(0, 30000)}`;
    }),
  );
  return entries.join('\n\n');
}
