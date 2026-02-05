#!/usr/bin/env npx ts-node
/**
 * Debug CLI for iCloud Calendar integration
 * Run with: npx ts-node scripts/debug-calendar.ts
 *
 * Commands:
 *   list                    - List all calendars
 *   events <calendar> [days] - Get events from calendar (default: 7 days)
 *   test                    - Full connection test
 */

import { DAVClient } from 'tsdav';
import ical from 'node-ical';
import { config } from 'dotenv';

type VEvent = ical.VEvent;

// Load .env from project root
config();

const username = process.env.ICLOUD_USERNAME;
const password = process.env.ICLOUD_APP_PASSWORD;

interface CalendarFilter {
  name: string;
  urlFragment?: string;
}

/**
 * Parse ICLOUD_CALENDARS env var as comma-separated list.
 * Supports optional URL fragment syntax: "Name::urlFragment" for disambiguation.
 * Examples:
 *   "Personal,Work" - match by name only
 *   "Família::97B8F2C5,Tiago" - match "Família" with URL containing "97B8F2C5", and "Tiago" by name
 */
function parseEnabledCalendars(): CalendarFilter[] | null {
  const envValue = process.env.ICLOUD_CALENDARS;
  if (!envValue) return null;

  const filters: CalendarFilter[] = [];
  for (const entry of envValue.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const [name, urlFragment] = trimmed.split('::').map(s => s.trim());
    filters.push({
      name: name.toLowerCase(),
      urlFragment: urlFragment || undefined,
    });
  }

  return filters.length > 0 ? filters : null;
}

function matchesFilter(calendar: { displayName?: unknown; url: string }, filter: CalendarFilter): boolean {
  const displayName = calendar.displayName as string | undefined;
  if (!displayName || displayName.toLowerCase() !== filter.name) {
    return false;
  }
  if (filter.urlFragment && !calendar.url.includes(filter.urlFragment)) {
    return false;
  }
  return true;
}

const enabledCalendars = parseEnabledCalendars();

if (!username || !password) {
  console.error('Error: ICLOUD_USERNAME and ICLOUD_APP_PASSWORD must be set in .env');
  process.exit(1);
}

async function main() {
  const command = process.argv[2] || 'test';

  console.log('Connecting to iCloud CalDAV...');
  console.log(`  Username: ${username}`);
  console.log(`  Timezone: ${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  if (enabledCalendars) {
    const filterDesc = enabledCalendars.map(f => f.urlFragment ? `${f.name}::${f.urlFragment}` : f.name).join(', ');
    console.log(`  Enabled calendars filter: ${filterDesc}`);
  }
  console.log('');

  const client = new DAVClient({
    serverUrl: 'https://caldav.icloud.com',
    credentials: { username, password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });

  try {
    await client.login();
    console.log('Connected successfully!\n');
  } catch (err) {
    console.error('Connection failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const allCalendars = await client.fetchCalendars();
  console.log(`Found ${allCalendars.length} calendars total:\n`);

  for (const cal of allCalendars) {
    const name = cal.displayName || '(unnamed)';
    const enabled = !enabledCalendars || enabledCalendars.some(f => matchesFilter(cal, f));
    console.log(`  ${enabled ? '[x]' : '[ ]'} ${name}`);
    console.log(`      URL: ${cal.url}`);
    console.log(`      ctag: ${cal.ctag}`);
    console.log('');
  }

  // Filter to enabled calendars
  const calendars = enabledCalendars
    ? allCalendars.filter(c => enabledCalendars.some(f => matchesFilter(c, f)))
    : allCalendars;

  if (command === 'list') {
    return;
  }

  if (command === 'events') {
    const calendarName = process.argv[3];
    const days = parseInt(process.argv[4] || '7', 10);

    if (!calendarName) {
      console.error('Usage: debug-calendar.ts events <calendar-name-or-url> [days]');
      process.exit(1);
    }

    // Try URL match first, then name match
    let calendar = calendars.find(c => c.url === calendarName);
    if (!calendar) {
      // Find all matching by name
      const matches = calendars.filter(c => {
        const name = c.displayName as string | undefined;
        return name?.toLowerCase() === calendarName.toLowerCase();
      });
      if (matches.length > 1) {
        console.log(`Multiple calendars match "${calendarName}":`);
        for (const m of matches) {
          console.log(`  - ${m.url}`);
        }
        console.log('\nTrying each one...\n');
        for (const m of matches) {
          console.log(`\n--- ${m.url} ---`);
          await fetchEvents(client, m, days);
        }
        return;
      }
      calendar = matches[0];
    }

    if (!calendar) {
      console.error(`Calendar not found: "${calendarName}"`);
      console.error('Available calendars:', calendars.map(c => c.displayName).join(', '));
      process.exit(1);
    }

    await fetchEvents(client, calendar, days);
    return;
  }

  if (command === 'raw') {
    // Show raw ICS data for recurring events
    const calendarName = process.argv[3];
    const days = parseInt(process.argv[4] || '1', 10);

    if (!calendarName) {
      console.error('Usage: debug-calendar.ts raw <calendar-name> [days]');
      process.exit(1);
    }

    const calendar = calendars.find(c => {
      const name = c.displayName as string | undefined;
      return name?.toLowerCase() === calendarName.toLowerCase();
    });

    if (!calendar) {
      console.error(`Calendar not found: "${calendarName}"`);
      process.exit(1);
    }

    const now = new Date();
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    console.log(`Fetching raw ICS from ${startDate.toISOString()} to ${endDate.toISOString()}\n`);

    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: startDate.toISOString(), end: endDate.toISOString() },
    });

    for (const obj of objects) {
      console.log(`=== ${obj.url} ===`);
      console.log(obj.data || '(no data)');
      console.log('');
    }
    return;
  }

  if (command === 'search') {
    // Search for events matching a keyword across ALL calendars
    const keyword = process.argv[3];
    const days = parseInt(process.argv[4] || '7', 10);

    if (!keyword) {
      console.error('Usage: debug-calendar.ts search <keyword> [days]');
      process.exit(1);
    }

    console.log(`Searching for "${keyword}" across ALL calendars (${days} days)...\n`);

    const now = new Date();
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    const lowerKeyword = keyword.toLowerCase();

    for (const cal of allCalendars) {
      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      });

      for (const obj of objects) {
        if (!obj.data) continue;
        if (obj.data.toLowerCase().includes(lowerKeyword)) {
          console.log(`=== Found in: ${cal.displayName} ===`);
          console.log(`URL: ${obj.url}`);
          // Extract key fields
          const lines = obj.data.split(/\r?\n/);
          for (const line of lines) {
            if (line.startsWith('SUMMARY') || line.startsWith('DTSTART') || line.startsWith('DTEND') || line.startsWith('RRULE')) {
              console.log(`  ${line}`);
            }
          }
          console.log('');
        }
      }
    }
    console.log('Search complete.');
    return;
  }

  if (command === 'delete') {
    // Delete an event by URL
    const eventUrl = process.argv[3];

    if (!eventUrl) {
      console.error('Usage: debug-calendar.ts delete <event-url>');
      console.error('Example: debug-calendar.ts delete https://caldav.icloud.com/.../event.ics');
      process.exit(1);
    }

    console.log(`Deleting event: ${eventUrl}`);

    try {
      await client.deleteCalendarObject({
        calendarObject: { url: eventUrl },
      });
      console.log('Event deleted successfully.');
    } catch (err) {
      console.error('Failed to delete:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
    return;
  }

  if (command === 'create') {
    // Create a new event (optionally recurring)
    // Usage: debug-calendar.ts create <calendar> <summary> <start> <end> [rrule]
    // Example: debug-calendar.ts create Família "💪 Gym" "2026-02-10T13:00" "2026-02-10T14:00" "FREQ=WEEKLY"
    const calendarName = process.argv[3];
    const summary = process.argv[4];
    const startStr = process.argv[5];
    const endStr = process.argv[6];
    const rrule = process.argv[7]; // Optional

    if (!calendarName || !summary || !startStr || !endStr) {
      console.error('Usage: debug-calendar.ts create <calendar> <summary> <start> <end> [rrule]');
      console.error('Example: debug-calendar.ts create Família "💪 Gym" "2026-02-10T13:00" "2026-02-10T14:00" "FREQ=WEEKLY"');
      console.error('RRULE examples: FREQ=WEEKLY, FREQ=DAILY, FREQ=WEEKLY;BYDAY=TU,SA');
      process.exit(1);
    }

    const calendar = calendars.find(c => {
      const name = c.displayName as string | undefined;
      return name?.toLowerCase() === calendarName.toLowerCase();
    });

    if (!calendar) {
      console.error(`Calendar not found: "${calendarName}"`);
      console.error('Available calendars:', calendars.map(c => c.displayName).join(', '));
      process.exit(1);
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error('Invalid date format. Use ISO 8601 (e.g., "2026-02-10T13:00")');
      process.exit(1);
    }

    // Generate ICS
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@nanoclaw`;
    const now = new Date();

    const formatDateTimeUtc = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const escapeIcsText = (text: string): string =>
      text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NanoClaw//Calendar//EN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatDateTimeUtc(now)}`,
      `DTSTART:${formatDateTimeUtc(startDate)}`,
      `DTEND:${formatDateTimeUtc(endDate)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
    ];

    if (rrule) {
      lines.push(`RRULE:${rrule}`);
    }

    lines.push('END:VEVENT', 'END:VCALENDAR');
    const icsData = lines.join('\r\n');

    console.log(`Creating event in ${calendar.displayName}:`);
    console.log(`  Summary: ${summary}`);
    console.log(`  Start: ${startDate}`);
    console.log(`  End: ${endDate}`);
    if (rrule) console.log(`  RRULE: ${rrule}`);
    console.log('');

    try {
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.ics`;
      await client.createCalendarObject({
        calendar,
        filename,
        iCalString: icsData,
      });
      console.log('Event created successfully.');
      console.log(`URL: ${calendar.url}${filename}`);
    } catch (err) {
      console.error('Failed to create:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
    return;
  }

  if (command === 'test') {
    // Test fetching events from each enabled calendar
    console.log('--- Testing Event Fetch ---\n');

    for (const calendar of calendars) {
      console.log(`\nCalendar: ${calendar.displayName}`);
      console.log('='.repeat(40));
      await fetchEvents(client, calendar, 7);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error('Commands: list, events <calendar> [days], test');
}

async function fetchEvents(client: DAVClient, calendar: any, days: number) {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);

  console.log(`  Fetching events from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`  (${days} days starting from local midnight)\n`);

  try {
    // Fetch ALL calendar objects without time range filter.
    // This is necessary because recurring events with RECURRENCE-ID overrides
    // (moved instances) won't be returned by CalDAV time-range queries if the
    // master event started outside the query window.
    const objects = await client.fetchCalendarObjects({ calendar });

    console.log(`  Found ${objects.length} calendar objects\n`);

    if (objects.length === 0) {
      // Try without time range to see if there are any events at all
      console.log('  Trying fetch without time range...');
      const allObjects = await client.fetchCalendarObjects({ calendar });
      console.log(`  Calendar has ${allObjects.length} total objects\n`);

      if (allObjects.length > 0) {
        console.log('  First 3 events (any date):');
        for (const obj of allObjects.slice(0, 3)) {
          if (obj.data) {
            const parsed = ical.sync.parseICS(obj.data);
            for (const [key, component] of Object.entries(parsed)) {
              if ((component as any).type === 'VEVENT') {
                const event = component as VEvent;
                console.log(`    - ${event.summary}`);
                console.log(`      Start: ${event.start}`);
                console.log(`      End: ${event.end}`);
                console.log(`      URL: ${obj.url}`);
              }
            }
          }
        }
      }
      return;
    }

    // Collect all expanded instances
    const allInstances: Array<{ instance: any; url: string }> = [];

    // Expand with a wider window to catch RECURRENCE-ID overrides.
    // When an instance of a recurring event is moved (e.g., from Tuesday to Friday),
    // node-ical's expandRecurringEvent only includes the override if the ORIGINAL
    // recurrence date is within the query window. So we expand with extra padding
    // and then filter the results to the actual requested window.
    const paddingMs = 7 * 24 * 60 * 60 * 1000; // 7 days padding
    const expandFrom = new Date(startDate.getTime() - paddingMs);
    const expandTo = new Date(endDate.getTime() + paddingMs);

    for (const obj of objects) {
      if (!obj.data) continue;

      try {
        const parsed = ical.sync.parseICS(obj.data);
        for (const [key, component] of Object.entries(parsed)) {
          if ((component as any).type === 'VEVENT') {
            const event = component as VEvent;

            // Expand recurring events with wider window
            const instances = ical.expandRecurringEvent(event, {
              from: expandFrom,
              to: expandTo,
              includeOverrides: true,
              excludeExdates: true,
              expandOngoing: true,
            });

            for (const instance of instances) {
              // Filter to requested window
              const instStart = instance.start instanceof Date ? instance.start : new Date(String(instance.start));
              const instEnd = instance.end instanceof Date ? instance.end : new Date(String(instance.end));
              if (instEnd <= startDate || instStart >= endDate) {
                continue;
              }
              allInstances.push({ instance, url: obj.url });
            }
          }
        }
      } catch (err) {
        console.error(`  Failed to parse: ${err}`);
      }
    }

    // Sort by start time
    allInstances.sort((a, b) => {
      const aStart = a.instance.start instanceof Date ? a.instance.start : new Date(String(a.instance.start));
      const bStart = b.instance.start instanceof Date ? b.instance.start : new Date(String(b.instance.start));
      return aStart.getTime() - bStart.getTime();
    });

    // Display
    for (const { instance, url } of allInstances) {
      const getStr = (v: any): string => {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object' && 'val' in v) return v.val;
        return String(v);
      };

      console.log(`  - ${getStr(instance.summary) || '(no title)'}`);
      console.log(`    Start: ${instance.start}`);
      console.log(`    End: ${instance.end}`);
      const location = getStr(instance.event?.location);
      if (location) console.log(`    Location: ${location}`);
      if (instance.isRecurring) console.log(`    (recurring instance)`);
      console.log(`    URL: ${url}`);
      console.log('');
    }
  } catch (err) {
    console.error(`  Error fetching events: ${err instanceof Error ? err.message : err}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
