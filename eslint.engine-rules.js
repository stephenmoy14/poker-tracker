// Rules that keep src/engine/ pure: no React, no browser APIs, no database
// code, and no imports from the app or sync layers. The engine must run the
// same in the browser, in tests and on a server.

const why = "The engine must stay pure TypeScript (see DESIGN.md).";

export const engineRules = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        { group: ["react", "react/*", "react-dom", "react-dom/*"], message: `No React in the engine. ${why}` },
        { group: ["@supabase/*", "pg", "postgres"], message: `No database code in the engine. ${why}` },
        { group: ["**/app/**", "**/app", "**/sync/**", "**/sync"], message: `The engine can't import from the app or sync layers. ${why}` },
      ],
    },
  ],
  "no-restricted-globals": [
    "error",
    ...[
      "window", "document", "navigator", "location", "history",
      "localStorage", "sessionStorage", "indexedDB",
      "fetch", "XMLHttpRequest", "WebSocket", "BroadcastChannel",
      "crypto", "setTimeout", "setInterval", "requestAnimationFrame",
      "alert", "confirm", "prompt",
    ].map((name) => ({ name, message: `No browser APIs in the engine. ${why}` })),
  ],
  "no-restricted-syntax": [
    "error",
    { selector: "MetaProperty[meta.name='import'][property.name='meta']", message: `No import.meta (env vars) in the engine. ${why}` },
    { selector: "MemberExpression[object.name='globalThis']", message: `No globalThis in the engine. ${why}` },
  ],
};
