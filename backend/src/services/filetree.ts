import path from 'path';
import fs from 'fs';
import type { FileNode, FileContent } from '../types.js';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.next', 'dist', 'build',
  '.claude', '.venv', 'venv', '.idea', '.vscode',
]);

const LANG_MAP: Record<string, string> = {
  go: 'go', ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rs: 'rust', css: 'css', html: 'html', json: 'json',
  md: 'markdown', yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash',
  bash: 'bash', sql: 'sql', graphql: 'graphql', proto: 'protobuf',
  java: 'java', kt: 'kotlin', rb: 'ruby', c: 'c', cpp: 'cpp',
  h: 'c', hpp: 'cpp', swift: 'swift',
};

export function readFileTree(projectPath: string, maxDepth: number, maxEntries: number): FileNode {
  const stat = fs.statSync(projectPath);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${projectPath}`);

  let count = 0;

  function walk(dir: string, depth: number): FileNode {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { name: path.basename(dir), path: dir, isDir: true };
    }

    // Sort: dirs first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    const node: FileNode = { name: path.basename(dir), path: dir, isDir: true, children: [] };

    for (const e of entries) {
      if (count >= maxEntries) break;
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      count++;
      const childPath = path.join(dir, e.name);

      if (e.isDirectory() && depth < maxDepth) {
        node.children!.push(walk(childPath, depth + 1));
      } else {
        node.children!.push({ name: e.name, path: childPath, isDir: e.isDirectory() });
      }
    }
    return node;
  }

  return walk(projectPath, 1);
}

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB

export function readFileContent(projectRoot: string, relPath: string): FileContent {
  const cleanRoot = path.resolve(projectRoot);

  // If the path is already absolute, make it relative
  let normalized = relPath.replace(/\//g, path.sep);
  if (path.isAbsolute(normalized)) {
    const rel = path.relative(cleanRoot, normalized);
    relPath = rel.replace(/\\/g, '/');
    normalized = rel;
  }

  let absPath = path.resolve(path.join(cleanRoot, normalized));

  // Path traversal guard
  if (!absPath.toLowerCase().startsWith(cleanRoot.toLowerCase() + path.sep) &&
      absPath.toLowerCase() !== cleanRoot.toLowerCase()) {
    throw new Error(`path outside project: ${relPath}`);
  }

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) throw new Error(`path is a directory: ${relPath}`);

  const ext = path.extname(absPath).slice(1).toLowerCase();
  const fc: FileContent = {
    path: relPath,
    name: path.basename(absPath),
    content: '',
    language: LANG_MAP[ext] ?? '',
    size: stat.size,
    isBinary: false,
    truncated: false,
  };

  if (stat.size > MAX_FILE_SIZE) {
    const fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(MAX_FILE_SIZE);
    const bytesRead = fs.readSync(fd, buf, 0, MAX_FILE_SIZE, 0);
    fs.closeSync(fd);
    fc.content = buf.toString('utf8', 0, bytesRead);
    fc.truncated = true;
  } else {
    const data = fs.readFileSync(absPath);
    // Check if binary (contains null bytes in first 8KB)
    const check = data.subarray(0, 8192);
    if (check.includes(0)) {
      fc.isBinary = true;
      fc.content = '';
      return fc;
    }
    fc.content = data.toString('utf8');
  }
  return fc;
}
