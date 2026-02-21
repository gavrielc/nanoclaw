import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import * as JsonRenderCore from '@json-render/core';
import * as JsonRenderReact from '@json-render/react';
import { z } from 'zod';

import './styles.css';

type JsonRecord = Record<string, unknown>;

type GroupEntry = {
  jid: string;
  name: string;
  folder: string;
};

type CanvasStatePayload = {
  group: GroupEntry;
  groupFolder: string;
  spec: unknown;
  revision: number;
  updatedAt: string | null;
  canvasUrl?: string;
};

type CanvasNode = JsonRecord & {
  type?: string;
  key?: string;
  children?: CanvasNode[];
};

const PassthroughProvider = ({ children }: { children?: ReactNode }) => <>{children}</>;
const DataProvider = (JsonRenderReact as JsonRecord).DataProvider as
  | React.ComponentType<{ children?: ReactNode; initialData?: JsonRecord }>
  | undefined;
const ActionProvider = (JsonRenderReact as JsonRecord).ActionProvider as
  | React.ComponentType<{ children?: ReactNode; actions?: JsonRecord; handlers?: JsonRecord }>
  | undefined;
const VisibilityProvider = (JsonRenderReact as JsonRecord).VisibilityProvider as
  | React.ComponentType<{ children?: ReactNode }>
  | undefined;
const RendererFromLibrary = (JsonRenderReact as JsonRecord).Renderer as
  | React.ComponentType<{ tree: CanvasNode; registry?: JsonRecord; catalog?: JsonRecord }>
  | undefined;

const createCatalog = (JsonRenderCore as JsonRecord).createCatalog as
  | ((input: JsonRecord) => JsonRecord)
  | undefined;

const catalog = createCatalog
  ? createCatalog({
      components: {
        Container: { schema: z.object({ style: z.record(z.any()).optional() }).passthrough() },
        Heading: { schema: z.object({ text: z.string().optional(), level: z.number().optional() }).passthrough() },
        Text: { schema: z.object({ text: z.string().optional(), style: z.record(z.any()).optional() }).passthrough() },
        Button: { schema: z.object({ text: z.string().optional(), action: z.string().optional(), href: z.string().optional() }).passthrough() },
        Image: { schema: z.object({ src: z.string().optional(), alt: z.string().optional(), style: z.record(z.any()).optional() }).passthrough() },
        Stack: { schema: z.object({ style: z.record(z.any()).optional() }).passthrough() },
        List: { schema: z.object({ items: z.array(z.string()).optional(), ordered: z.boolean().optional() }).passthrough() },
      },
      actions: {
        open_url: {
          schema: z.object({
            url: z.string(),
          }),
        },
      },
      data: {},
    })
  : null;

const actionHandlers = {
  open_url: ({ url }: { url?: string }) => {
    if (!url) return;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },
};

function asStyle(style: unknown): React.CSSProperties {
  if (style && typeof style === 'object') {
    return style as React.CSSProperties;
  }
  return {};
}

function nodeText(node: CanvasNode): string {
  if (typeof node.text === 'string') return node.text;
  if (typeof node.label === 'string') return node.label;
  if (typeof node.title === 'string') return node.title;
  return '';
}

function normalizeSpec(spec: unknown): CanvasNode | null {
  if (!spec) return null;

  if (typeof spec !== 'object') {
    return {
      type: 'Text',
      key: 'root-text',
      text: String(spec),
    };
  }

  const obj = spec as CanvasNode;

  if (obj.tree && typeof obj.tree === 'object') {
    return normalizeSpec(obj.tree);
  }

  if (typeof obj.type === 'string') {
    return {
      ...obj,
      key: obj.key || 'root',
    };
  }

  return {
    type: 'Container',
    key: 'root-container',
    children: [
      {
        type: 'Text',
        key: 'raw-json',
        text: JSON.stringify(obj, null, 2),
        style: {
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          background: '#0f172a',
          color: '#e2e8f0',
          padding: '14px',
          borderRadius: '12px',
        },
      },
    ],
  };
}

function renderChildren(node: CanvasNode): ReactNode {
  const children = Array.isArray(node.children) ? node.children : [];
  return children.map((child, index) => (
    <RenderNode key={child.key || `${node.key || 'node'}-${index}`} node={child} />
  ));
}

function RenderNode({ node }: { node: CanvasNode }) {
  const type = node.type || 'Container';
  const style = asStyle(node.style);

  if (type === 'Heading') {
    const level = typeof node.level === 'number' ? Math.max(1, Math.min(6, node.level)) : 1;
    const text = nodeText(node);
    switch (level) {
      case 1:
        return <h1 style={style}>{text}</h1>;
      case 2:
        return <h2 style={style}>{text}</h2>;
      case 3:
        return <h3 style={style}>{text}</h3>;
      case 4:
        return <h4 style={style}>{text}</h4>;
      case 5:
        return <h5 style={style}>{text}</h5>;
      default:
        return <h6 style={style}>{text}</h6>;
    }
  }

  if (type === 'Text') {
    return <p style={style}>{nodeText(node)}</p>;
  }

  if (type === 'Image') {
    return (
      <img
        src={typeof node.src === 'string' ? node.src : ''}
        alt={typeof node.alt === 'string' ? node.alt : 'image'}
        style={style}
      />
    );
  }

  if (type === 'List') {
    const items = Array.isArray(node.items) ? node.items : [];
    if (node.ordered) {
      return (
        <ol style={style}>
          {items.map((item, index) => <li key={`${node.key || 'list'}-${index}`}>{String(item)}</li>)}
        </ol>
      );
    }
    return (
      <ul style={style}>
        {items.map((item, index) => <li key={`${node.key || 'list'}-${index}`}>{String(item)}</li>)}
      </ul>
    );
  }

  if (type === 'Button') {
    const text = nodeText(node) || 'Button';
    const href = typeof node.href === 'string' ? node.href : undefined;
    if (href) {
      return (
        <a href={href} target="_blank" rel="noreferrer" style={style}>
          {text}
        </a>
      );
    }
    return (
      <button
        style={style}
        onClick={() => actionHandlers.open_url({ url: typeof node.url === 'string' ? node.url : undefined })}
      >
        {text}
      </button>
    );
  }

  return <div style={style}>{renderChildren(node)}</div>;
}

function FallbackRenderer({ tree }: { tree: CanvasNode }) {
  return <RenderNode node={tree} />;
}

function CanvasRenderer({ tree }: { tree: CanvasNode }) {
  const Renderer = RendererFromLibrary || FallbackRenderer;
  const dataProvider = DataProvider || PassthroughProvider;
  const actionProvider = ActionProvider || PassthroughProvider;
  const visibilityProvider = VisibilityProvider || PassthroughProvider;

  const rendererProps: JsonRecord = {
    tree,
    registry: {
      Container: RenderNode,
      Heading: RenderNode,
      Text: RenderNode,
      Button: RenderNode,
      Image: RenderNode,
      Stack: RenderNode,
      List: RenderNode,
    },
  };

  if (catalog) {
    rendererProps.catalog = catalog;
  }

  return React.createElement(
    dataProvider,
    { initialData: {} },
    React.createElement(
      actionProvider,
      { actions: actionHandlers, handlers: actionHandlers },
      React.createElement(
        visibilityProvider,
        null,
        React.createElement(Renderer, rendererProps),
      ),
    ),
  );
}

function App() {
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [state, setState] = useState<CanvasStatePayload | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const response = await fetch('/api/canvas/groups');
        const payload = await response.json() as { groups: GroupEntry[] };
        const nextGroups = Array.isArray(payload.groups) ? payload.groups : [];
        setGroups(nextGroups);

        const requestedGroup = new URLSearchParams(window.location.search).get('group');
        const initialGroup = requestedGroup || nextGroups[0]?.folder || '';
        setSelectedGroup(initialGroup);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    loadGroups().catch(() => {
      // handled in loadGroups
    });
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;

    let cancelled = false;

    const loadState = async () => {
      try {
        const response = await fetch(`/api/canvas/${selectedGroup}/state`);
        const payload = await response.json() as CanvasStatePayload | { error?: string };
        if (cancelled) return;

        if (!response.ok) {
          const message =
            typeof (payload as { error?: string }).error === 'string'
              ? (payload as { error?: string }).error as string
              : `Failed to load canvas state (${response.status})`;
          setError(message);
          return;
        }

        setState(payload as CanvasStatePayload);
        setError('');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    loadState().catch(() => {
      // handled in loadState
    });
    const interval = setInterval(loadState, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedGroup]);

  const tree = useMemo(() => normalizeSpec(state?.spec), [state?.spec]);

  return (
    <div className="layout">
      <section className="panel">
        <header className="panel-header">
          <h1>Generative Canvas</h1>
          <div className="controls">
            <select
              value={selectedGroup}
              onChange={(event) => setSelectedGroup(event.target.value)}
            >
              {groups.map((group) => (
                <option key={group.jid} value={group.folder}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
        </header>
        <div className="canvas-body">
          {error ? <div className="placeholder">{error}</div> : null}
          {!error && tree ? <CanvasRenderer tree={tree} /> : null}
          {!error && !tree ? (
            <div className="placeholder">
              No canvas state yet. Ask NanoClaw to call
              {' '}
              <code>mcp__nanoclaw__update_canvas</code>
              {' '}
              with a <code>set_spec</code> payload.
            </div>
          ) : null}
        </div>
      </section>
      <aside className="panel sidebar">
        <header className="panel-header">
          <h2>State</h2>
          <p className="meta">
            rev
            {' '}
            {state?.revision ?? 0}
            {' · '}
            {state?.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : 'never'}
          </p>
        </header>
        <pre>{JSON.stringify(state?.spec ?? {}, null, 2)}</pre>
      </aside>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root mount element');
}

createRoot(rootEl).render(<App />);
