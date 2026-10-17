/**
 * `ncl templates list`: the templates an agent can be created from. Local by
 * default (no network); `--registry` reads the public library's index from
 * one fixed URL, so nothing the caller typed is sent anywhere. Read-only,
 * which is why group-scoped agents may run it.
 */
import { TEMPLATES_DIR } from '../../config.js';
import {
  fetchTemplateIndex,
  hasLocalTemplate,
  listTemplatesFromDir,
  templateDescription,
} from '../../templates/registry.js';
import { registerResource } from '../crud.js';

interface TemplateRow {
  ref: string;
  name: string;
  description: string;
  /** Library rows only: a copy is already on this machine. */
  local?: boolean;
}

registerResource({
  name: 'template',
  plural: 'templates',
  // There is no templates table; with no generic operations nothing reads it.
  table: 'templates',
  description: 'Agent templates: what create_agent and `groups create --template` can build from.',
  idColumn: 'ref',
  columns: [],
  operations: {},
  customOperations: {
    list: {
      access: 'open',
      description:
        'List agent templates. Without flags, the templates on this machine (no network). ' +
        'With --registry, the public template library.',
      args: [{ name: 'registry', type: 'boolean', description: 'List the public template library instead.' }],
      examples: ['ncl templates list', 'ncl templates list --registry'],
      handler: async (args): Promise<TemplateRow[]> => {
        if (args.registry) {
          return (await fetchTemplateIndex()).map((t) => ({ ...t, local: hasLocalTemplate(t.ref) }));
        }
        return listTemplatesFromDir(TEMPLATES_DIR)
          .filter((t) => t.ref !== '.')
          .map((t) => ({ ...t, description: templateDescription(t.ref) ?? '' }));
      },
      formatHuman: (data) => {
        const rows = data as TemplateRow[];
        if (rows.length === 0) return 'No templates.';
        return rows.map((r) => `${r.ref}${r.local ? ' [on this machine]' : ''} - ${r.description}`).join('\n');
      },
    },
  },
});
