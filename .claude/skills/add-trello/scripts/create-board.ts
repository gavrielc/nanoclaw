#!/usr/bin/env tsx

import * as readline from 'readline';
import { trelloAPI } from '../lib/trello-api.js';
import { saveConfig, LIST_NAMES, loadCredentials } from '../lib/config.js';
import type { ListKey } from '../lib/config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function main() {
  console.log('\n=== Trello Board Setup ===\n');

  // Check credentials
  const creds = loadCredentials();
  if (!creds) {
    console.error('❌ Trello credentials nicht gefunden.');
    console.error('Bitte führe zuerst aus: npx tsx .claude/skills/add-trello/scripts/setup.ts\n');
    process.exit(1);
  }

  console.log('Möchtest du ein neues Board erstellen oder ein existierendes nutzen?\n');
  console.log('1. Neues Board erstellen (empfohlen)');
  console.log('2. Existierendes Board nutzen');

  const choice = await question('\nDeine Wahl (1 oder 2): ');

  let boardId: string;
  let boardName: string;
  let boardUrl: string;

  if (choice.trim() === '1') {
    // Create new board
    const name = await question('\nBoard Name (Standard: "NanoClaw Tasks"): ');
    boardName = name.trim() || 'NanoClaw Tasks';

    console.log(`\nErstelle Board "${boardName}"...`);
    const result = await trelloAPI.createBoard(boardName);

    if (!result.success || !result.data) {
      console.error(`❌ Fehler beim Erstellen des Boards: ${result.error}`);
      process.exit(1);
    }

    boardId = result.data.id;
    boardUrl = result.data.url;
    console.log(`✅ Board erstellt: ${boardUrl}`);
  } else {
    // Use existing board
    console.log('\nÖffne dein Trello Board in Browser und kopiere die Board-ID aus der URL:');
    console.log('Beispiel: https://trello.com/b/BOARD_ID/board-name\n');

    boardId = await question('Board ID: ');
    if (!boardId.trim()) {
      console.error('❌ Board ID ist erforderlich');
      process.exit(1);
    }
    boardId = boardId.trim();

    // Get board info
    const boardResult = await trelloAPI.getBoard();
    if (!boardResult.success || !boardResult.data) {
      console.error(`❌ Board nicht gefunden: ${boardResult.error}`);
      process.exit(1);
    }

    boardName = boardResult.data.name;
    boardUrl = boardResult.data.url;
    console.log(`✅ Board gefunden: ${boardName}`);
  }

  // Create lists
  console.log('\nErstelle Listen...');
  const lists: Record<string, string> = {};

  for (const [key, name] of Object.entries(LIST_NAMES)) {
    console.log(`  Creating: ${name}`);
    const result = await trelloAPI.createList(name);

    if (!result.success || !result.data) {
      console.error(`❌ Fehler beim Erstellen der Liste "${name}": ${result.error}`);
      process.exit(1);
    }

    lists[key] = result.data.id;
  }

  console.log('✅ Alle Listen erstellt');

  // Ask for "Heute" limit
  const limitStr = await question('\nMax. Anzahl Karten in "Heute" (Standard: 5): ');
  const heuteMax = parseInt(limitStr.trim() || '5', 10);

  // Save config
  const config = {
    boardId,
    boardName,
    boardUrl,
    lists: lists as Record<ListKey, string>,
    limits: {
      heuteMax,
    },
  };

  saveConfig(config);
  console.log('\n✅ Konfiguration gespeichert in data/trello-config.json');

  console.log('\n=== Setup abgeschlossen ===\n');
  console.log(`Board: ${boardName}`);
  console.log(`URL: ${boardUrl}`);
  console.log('\nListen:');
  for (const [key, name] of Object.entries(LIST_NAMES)) {
    console.log(`  • ${name}`);
  }
  console.log(`\n"Heute" Limit: ${heuteMax} Karten`);

  console.log('\n📋 Teile das Board mit deiner Freundin:');
  console.log(`  1. Öffne: ${boardUrl}`);
  console.log('  2. Klicke "Share" (oben rechts)');
  console.log('  3. Gib ihre Email ein\n');

  console.log('Nächste Schritte:');
  console.log('  1. Container rebuilden: ./container/build.sh');
  console.log('  2. Host rebuilden: npm run build');
  console.log('  3. Service neustarten: launchctl kickstart -k gui/$(id -u)/com.nanoclaw\n');

  rl.close();
}

main().catch((err) => {
  console.error('Board setup failed:', err);
  rl.close();
  process.exit(1);
});
