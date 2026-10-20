import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SecretInput } from "./SecretInput";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings } from "./useScopedSettings";
import { SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";

export function RoerSettings() {
  const { environment, scope } = useSettingsScope();
  if (scope.kind !== "environment" || !environment) {
    return (
      <SettingsSection title="Roer" id="roer">
        <SettingsScopeNotice target="environment">
          Choose one environment to link it to Roer.
        </SettingsScopeNotice>
      </SettingsSection>
    );
  }
  return <RoerForm key={environment.environmentId} />;
}

function RoerForm() {
  const { environment } = useSettingsScope();
  const saved = useScopedSettings((settings) => settings.roer);
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const environmentId = environment?.environmentId ?? null;
  // Changing the link is a settings write; moving threads later needs the operate grant on top.
  const canEdit = useAtomValue(serverEnvironment.checkOtlpEndpoint.permissionAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  const tokenSaved = saved.token.length > 0;
  const nextUrl = (url ?? saved.url).trim();
  const changed = nextUrl !== saved.url || token !== "";

  const save = async (patch: { url?: string; token?: string }) => {
    if (!environmentId || saving) return;
    setSaving(true);
    setMessage(null);
    const result = await updateSettings({ environmentId, input: { patch: { roer: patch } } });
    setSaving(false);
    if (result._tag === "Success") {
      setUrl(null);
      setToken("");
      setMessage("Saved.");
    }
  };

  return (
    <SettingsSection title="Roer" id="roer">
      <form
        className="grid gap-4 px-4 py-4 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save({ url: nextUrl, ...(token !== "" ? { token } : {}) });
        }}
      >
        <p className="text-xs text-muted-foreground">
          Move a thread to Roer's cloud worker when you close your laptop, and bring it back with
          all its changes. Mate must run on this machine. Leave both empty to turn this off.
        </p>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            This connection lacks permission to change settings on{" "}
            {environment?.label ?? "the selected environment"}.
          </p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="roer-url">Roer URL</Label>
          <Input
            id="roer-url"
            size="sm"
            type="url"
            placeholder="https://roer.example.com"
            value={url ?? saved.url}
            disabled={saving || !canEdit}
            onChange={(event) => {
              setUrl(event.target.value);
              setMessage(null);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="roer-token">Token</Label>
          <SecretInput
            id="roer-token"
            size="sm"
            configured={tokenSaved}
            value={token}
            disabled={saving || !canEdit}
            onChange={(event) => {
              setToken(event.target.value);
              setMessage(null);
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
          <div className="flex shrink-0 gap-2">
            {(saved.url !== "" || tokenSaved) && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={saving || !canEdit}
                onClick={() => void save({ url: "", token: "" })}
              >
                Unlink
              </Button>
            )}
            <Button type="submit" size="xs" disabled={!changed || saving || !canEdit}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}
