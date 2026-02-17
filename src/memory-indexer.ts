import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { GROUPS_DIR } from './config.js';
import {
  deleteMemoryChunksByFile,
  MemoryChunk,
  upsertMemoryChunk,
} from './db.js';
import { logger } from './logger.js';

const INDEX_INTERVAL = 30_000; // 30 seconds
const TARGET_CHUNK_TOKENS = 400; // ~400 tokens per chunk
const CHARS_PER_TOKEN = 4; // rough estimate
const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN;

// Track file mtimes to avoid re-indexing unchanged files
const fileMtimes = new Map<string, number>();

let running = false;

export function startMemoryIndexer(): void {
  if (running) return;
  running = true;
  logger.info('Memory indexer started');
  indexLoop();
}

function indexLoop(): void {
  try {
    indexAllGroups();
  } catch (err) {
    logger.error({ err }, 'Memory indexer error');
  }
  setTimeout(indexLoop, INDEX_INTERVAL);
}

function indexAllGroups(): void {
  let groupDirs: string[];
  try {
    groupDirs = fs
      .readdirSync(GROUPS_DIR)
      .filter((f) => {
        const fullPath = path.join(GROUPS_DIR, f);
        return fs.statSync(fullPath).isDirectory();
      });
  } catch {
    return;
  }

  for (const groupFolder of groupDirs) {
    const groupPath = path.join(GROUPS_DIR, groupFolder);
    const dirsToIndex = [
      path.join(groupPath, 'memory'),
      path.join(groupPath, 'conversations'),
    ];

    for (const dir of dirsToIndex) {
      if (!fs.existsSync(dir)) continue;
      indexDirectory(dir, groupFolder);
    }
  }
}

function indexDirectory(dir: string, groupFolder: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      indexDirectory(fullPath, groupFolder);
      continue;
    }

    if (!entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) continue;

    try {
      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;
      const cached = fileMtimes.get(fullPath);

      if (cached && cached >= mtime) continue; // unchanged

      indexFile(fullPath, groupFolder);
      fileMtimes.set(fullPath, mtime);
    } catch {
      // file may have been deleted between readdir and stat
    }
  }
}

function indexFile(filePath: string, groupFolder: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) return;

  // Relative path from groups dir for storage
  const sourceFile = path.relative(GROUPS_DIR, filePath);

  // Delete existing chunks for this file before re-indexing
  deleteMemoryChunksByFile(sourceFile, groupFolder);

  const chunks = chunkText(content);
  const now = new Date().toISOString();

  for (const chunk of chunks) {
    const id = crypto
      .createHash('sha256')
      .update(`${groupFolder}:${sourceFile}:${chunk.lineStart}:${chunk.lineEnd}`)
      .digest('hex')
      .slice(0, 16);

    const memChunk: MemoryChunk = {
      id,
      group_folder: groupFolder,
      source_file: sourceFile,
      content: chunk.text,
      line_start: chunk.lineStart,
      line_end: chunk.lineEnd,
      created_at: now,
      updated_at: now,
    };

    upsertMemoryChunk(memChunk);
  }

  logger.debug(
    { file: sourceFile, groupFolder, chunks: chunks.length },
    'Indexed memory file',
  );
}

interface TextChunk {
  text: string;
  lineStart: number;
  lineEnd: number;
}

function chunkText(content: string): TextChunk[] {
  const paragraphs = content.split(/\n\n+/);
  const chunks: TextChunk[] = [];
  let currentText = '';
  let currentLineStart = 1;
  let lineCounter = 1;

  for (const para of paragraphs) {
    const paraLines = para.split('\n').length;
    const paraStart = lineCounter;

    if (currentText.length + para.length > TARGET_CHUNK_CHARS && currentText) {
      // Flush current chunk
      chunks.push({
        text: currentText.trim(),
        lineStart: currentLineStart,
        lineEnd: lineCounter - 1,
      });
      currentText = '';
      currentLineStart = paraStart;
    }

    // If a single paragraph exceeds target, split it
    if (para.length > TARGET_CHUNK_CHARS * 1.5) {
      if (currentText) {
        chunks.push({
          text: currentText.trim(),
          lineStart: currentLineStart,
          lineEnd: paraStart - 1,
        });
        currentText = '';
      }

      const lines = para.split('\n');
      let subChunk = '';
      let subStart = paraStart;

      for (let i = 0; i < lines.length; i++) {
        if (subChunk.length + lines[i].length > TARGET_CHUNK_CHARS && subChunk) {
          chunks.push({
            text: subChunk.trim(),
            lineStart: subStart,
            lineEnd: paraStart + i - 1,
          });
          subChunk = '';
          subStart = paraStart + i;
        }
        subChunk += (subChunk ? '\n' : '') + lines[i];
      }

      if (subChunk.trim()) {
        chunks.push({
          text: subChunk.trim(),
          lineStart: subStart,
          lineEnd: paraStart + lines.length - 1,
        });
      }

      currentLineStart = paraStart + paraLines;
    } else {
      currentText += (currentText ? '\n\n' : '') + para;
    }

    lineCounter = paraStart + paraLines;
    // Account for the blank line(s) between paragraphs
    lineCounter++;
  }

  if (currentText.trim()) {
    chunks.push({
      text: currentText.trim(),
      lineStart: currentLineStart,
      lineEnd: lineCounter - 1,
    });
  }

  return chunks;
}
