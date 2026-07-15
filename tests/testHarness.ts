import { build } from 'esbuild';

export async function loadBundledModule<T>(entrySource: string): Promise<T> {
  const result = await build({
    stdin: {
      contents: entrySource,
      resolveDir: process.cwd(),
      sourcefile: 'weatherpure-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'silent',
  });

  const output = result.outputFiles[0];
  if (!output) throw new Error('Test bundle produced no output');
  const encoded = Buffer.from(output.text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`) as Promise<T>;
}

export function blockUnexpectedNetwork(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    throw new Error(`Unexpected network access blocked: ${target}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export interface ResponseState {
  statusCode: number | null;
  body: unknown;
  ended: boolean;
  headers: Map<string, string>;
}

export function createResponseDouble(): {
  response: {
    status(code: number): unknown;
    setHeader(name: string, value: string): unknown;
    json(body: unknown): void;
    end(): void;
  };
  state: ResponseState;
} {
  const state: ResponseState = {
    statusCode: null,
    body: undefined,
    ended: false,
    headers: new Map(),
  };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    setHeader(name: string, value: string) {
      state.headers.set(name, value);
      return response;
    },
    json(body: unknown) {
      state.body = body;
    },
    end() {
      state.ended = true;
    },
  };
  return { response, state };
}
