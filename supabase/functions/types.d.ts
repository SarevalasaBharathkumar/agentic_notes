/// <reference lib="dom" />

// Map the remote esm.sh import to local types so VS Code/TS can resolve it.
declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

// Minimal Deno globals used by Supabase Edge Functions for editor typechecking.
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
  const env: {
    get(name: string): string | undefined;
  };
}

