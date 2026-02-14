#!/usr/bin/env tsx

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

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
  console.log('\n=== Trello Integration Setup ===\n');

  console.log('Dieses Script hilft dir, Trello API Credentials einzurichten.\n');

  console.log('Schritt 1: API Key erhalten');
  console.log('  1. Öffne: https://trello.com/power-ups/admin');
  console.log('  2. Klicke "New" um ein Power-Up zu erstellen');
  console.log('  3. Kopiere den API Key\n');

  const apiKey = await question('Dein Trello API Key: ');

  if (!apiKey.trim()) {
    console.error('\n❌ API Key ist erforderlich');
    process.exit(1);
  }

  console.log('\nSchritt 2: Token erhalten');
  console.log('  1. Öffne diesen Link in deinem Browser:');
  console.log(`     https://trello.com/1/authorize?expiration=never&name=NanoClaw&scope=read,write&response_type=token&key=${apiKey}`);
  console.log('  2. Authorisiere die App');
  console.log('  3. Kopiere das Token\n');

  const token = await question('Dein Trello Token: ');

  if (!token.trim()) {
    console.error('\n❌ Token ist erforderlich');
    process.exit(1);
  }

  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  // Remove existing Trello credentials if any
  envContent = envContent
    .split('\n')
    .filter((line) => !line.startsWith('TRELLO_API_KEY=') && !line.startsWith('TRELLO_TOKEN='))
    .join('\n');

  // Add new credentials
  envContent += `\n\n# Trello Integration\nTRELLO_API_KEY=${apiKey.trim()}\nTRELLO_TOKEN=${token.trim()}\n`;

  fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');

  console.log('\n✅ Credentials gespeichert in .env');
  console.log('\nNächste Schritte:');
  console.log('  1. Board erstellen: npx tsx .claude/skills/add-trello/scripts/create-board.ts');
  console.log('  2. Container rebuilden: ./container/build.sh');
  console.log('  3. Host rebuilden: npm run build');
  console.log('  4. Service neustarten: launchctl kickstart -k gui/$(id -u)/com.nanoclaw\n');

  rl.close();
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
