import * as path from 'path';

/** True when the session cwd is the workspace, a descendant, or an ancestor. */
export function pathsShareWorkspace(cwd: string, workspaceFolders: string[]): boolean {
  if (!cwd || workspaceFolders.length === 0) { return true; }
  return workspaceFolders.some(folder => pathsAreRelated(cwd, folder));
}

export function pathsAreRelated(left: string, right: string): boolean {
  const leftStyle = pathStyle(left);
  const rightStyle = pathStyle(right);
  if (!leftStyle || leftStyle !== rightStyle) { return false; }
  const pathApi = leftStyle === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(left) || !pathApi.isAbsolute(right)) { return false; }
  const normalize = (value: string) => {
    const resolved = pathApi.normalize(value);
    return leftStyle === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const a = normalize(left);
  const b = normalize(right);
  return isSameOrChild(pathApi, a, b) || isSameOrChild(pathApi, b, a);
}

function isSameOrChild(pathApi: typeof path.win32 | typeof path.posix, parent: string, child: string): boolean {
  const relative = pathApi.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}

function pathStyle(value: string): 'win32' | 'posix' | undefined {
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) { return 'win32'; }
  if (value.startsWith('/')) { return 'posix'; }
  return undefined;
}
