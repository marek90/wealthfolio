import { useMemo, useState } from "react";
import type { CreateAgentAccessTokenInput } from "@/adapters";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Checkbox } from "@wealthfolio/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wealthfolio/ui/components/ui/dialog";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Input } from "@wealthfolio/ui/components/ui/input";
import { Label } from "@wealthfolio/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@wealthfolio/ui/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wealthfolio/ui/components/ui/select";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";
import { buildClientConfig, CLIENT_PRESETS } from "../mcp-client-config";
import { applyScopeDependencies, SCOPE_PRESETS, SCOPES, type ScopeKey } from "../scopes";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "none", label: "No expiry" },
] as const;

const CUSTOM = "custom";
const DEFAULT_PRESET = SCOPE_PRESETS[0].key;

interface PatCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Creates the token and resolves with the secret (shown once). */
  onCreate: (input: CreateAgentAccessTokenInput) => Promise<string>;
  isCreating: boolean;
  /** MCP server URL used to render a ready-to-paste client config (optional). */
  serverUrl?: string;
}

export function PatCreateDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
  serverUrl,
}: PatCreateDialogProps) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  const [presetKey, setPresetKey] = useState<string>(DEFAULT_PRESET);
  const [customScopes, setCustomScopes] = useState<Set<ScopeKey>>(new Set());
  const [newToken, setNewToken] = useState<string | null>(null);
  const [configPresetId, setConfigPresetId] = useState(CLIENT_PRESETS[0].id);

  const selectedScopes = useMemo<ScopeKey[]>(() => {
    if (presetKey === CUSTOM) {
      return applyScopeDependencies(customScopes);
    }
    const preset = SCOPE_PRESETS.find((entry) => entry.key === presetKey);
    return preset ? preset.scopes : [];
  }, [presetKey, customScopes]);

  const reset = () => {
    setName("");
    setExpiry("90");
    setPresetKey(DEFAULT_PRESET);
    setCustomScopes(new Set());
    setNewToken(null);
    setConfigPresetId(CLIENT_PRESETS[0].id);
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) reset();
    onOpenChange(value);
  };

  const toggleScope = (key: ScopeKey, checked: boolean) => {
    setCustomScopes((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return new Set(applyScopeDependencies(next));
    });
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || selectedScopes.length === 0) return;
    const expiresAt =
      expiry === "none"
        ? undefined
        : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
    try {
      setNewToken(await onCreate({ name: trimmed, expiresAt, scopes: selectedScopes }));
    } catch (_error) {
      // Error toast is handled by the mutation; keep the dialog open.
    }
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: `Could not copy ${label}.`,
        variant: "destructive",
      });
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const configJson =
    newToken && serverUrl ? buildClientConfig(configPresetId, serverUrl, newToken) : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {newToken === null ? (
          <>
            <DialogHeader>
              <DialogTitle>New access token</DialogTitle>
              <DialogDescription>
                Choose the scopes an MCP client may use with this token.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 pr-1">
              <div className="space-y-1">
                <Label htmlFor="pat-name">Name</Label>
                <Input
                  id="pat-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Claude Desktop"
                />
              </div>

              <div className="space-y-1">
                <Label>Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Scopes</Label>
                <RadioGroup value={presetKey} onValueChange={setPresetKey} className="gap-2">
                  {SCOPE_PRESETS.map((preset) => (
                    <div key={preset.key} className="flex items-center gap-2">
                      <RadioGroupItem value={preset.key} id={`preset-${preset.key}`} />
                      <Label htmlFor={`preset-${preset.key}`} className="font-normal">
                        {preset.label}
                      </Label>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value={CUSTOM} id="preset-custom" />
                    <Label htmlFor="preset-custom" className="font-normal">
                      Custom
                    </Label>
                  </div>
                </RadioGroup>

                {presetKey === CUSTOM && (
                  <div className="border-border mt-1 space-y-2 rounded-md border p-3">
                    {SCOPES.map((scope) => {
                      const checked = selectedScopes.includes(scope.key);
                      // draft is locked-checked while write is selected.
                      const lockedByWrite =
                        scope.key === "activities:draft" &&
                        selectedScopes.includes("activities:write");
                      return (
                        <div key={scope.key} className="flex items-start gap-2">
                          <Checkbox
                            id={`scope-${scope.key}`}
                            className="mt-0.5"
                            checked={checked}
                            disabled={lockedByWrite}
                            onCheckedChange={(value) => toggleScope(scope.key, value === true)}
                          />
                          <div className="space-y-0.5">
                            <Label htmlFor={`scope-${scope.key}`} className="font-normal">
                              {scope.label}
                            </Label>
                            <p className="text-muted-foreground text-xs">{scope.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={!name.trim() || selectedScopes.length === 0 || isCreating}
              >
                {isCreating ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
              <DialogDescription>
                Copy this token now — you won&apos;t see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Access token</Label>
                <div className="flex items-center gap-2">
                  <p className="bg-muted flex-1 select-all truncate rounded-md px-3 py-2 font-mono text-xs">
                    {newToken}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleCopy(newToken, "Token")}
                  >
                    <Icons.Copy className="h-4 w-4" />
                    <span className="sr-only">Copy token</span>
                  </Button>
                </div>
              </div>

              {serverUrl && (
                <div className="space-y-1.5">
                  <Label htmlFor="pat-client-preset">Client configuration</Label>
                  <p className="text-muted-foreground text-sm">
                    Ready-to-paste config for your client. It contains the access token.
                  </p>
                  <Select value={configPresetId} onValueChange={setConfigPresetId}>
                    <SelectTrigger id="pat-client-preset" className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CLIENT_PRESETS.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-start gap-2">
                    <pre className="bg-muted text-muted-foreground flex-1 overflow-x-auto rounded-md px-3 py-2 font-mono text-xs">
                      {configJson}
                    </pre>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleCopy(configJson, "Client configuration")}
                    >
                      <Icons.Copy className="h-4 w-4" />
                      <span className="sr-only">Copy client configuration</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
