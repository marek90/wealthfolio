// Ready-to-paste MCP client configuration snippets. Shared by the connect-client
// card and the token-created dialog so both render identical configs.

export interface ClientPreset {
  id: string;
  label: string;
  build: (url: string, token: string) => unknown;
}

export const CLIENT_PRESETS: ClientPreset[] = [
  {
    id: "mcp-servers",
    label: "Claude / Cursor (mcpServers)",
    build: (url, token) => ({
      mcpServers: {
        wealthfolio: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
  },
  {
    id: "jan",
    label: "Jan",
    build: (url, token) => ({
      Wealthfolio: {
        active: true,
        args: [],
        command: "",
        env: {},
        headers: { Authorization: `Bearer ${token}` },
        type: "http",
        url,
      },
    }),
  },
  {
    id: "generic",
    label: "Generic HTTP",
    build: (url, token) => ({
      url,
      headers: { Authorization: `Bearer ${token}` },
    }),
  },
];

/** Serialized config JSON for a preset, or "" when inputs are missing. */
export function buildClientConfig(presetId: string, url: string, token: string): string {
  const preset = CLIENT_PRESETS.find((entry) => entry.id === presetId) ?? CLIENT_PRESETS[0];
  if (!url || !token) return "";
  return JSON.stringify(preset.build(url, token), null, 2);
}
