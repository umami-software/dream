import {
  Archive,
  Monitor,
  Moon,
  Plug,
  RotateCcw,
  RotateCw,
  Sun,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import anthropicLogo from "@/assets/anthropic.svg";
import openAiLogo from "@/assets/openai.svg";
import openCodeLogo from "@/assets/opencode.svg";
import { CursorIcon, GrokIcon } from "@/components/ai-elements/provider-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_LOCALES, type AppLocale, LOCALE_LABELS } from "@/i18n/config";
import { getDesktopApi } from "@/lib/electron";
import {
  getModelOptionsForProvider,
  getModelsForProvider,
  resolveModelSpeedForModel,
  resolveReasoningEffortForModel,
} from "@/lib/ide-defaults";
import { getModelReasoningEfforts, getModelSpeedTiers } from "@/lib/models";
import { ACCENT_COLORS, BASE_COLORS, useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import type {
  AccentColor,
  BaseColor,
  ModelSpeed,
  ReasoningEffort,
  TerminalShellOption,
} from "@/types/ide";
import packageJson from "../../../package.json";
import { useIdeStore } from "./ide-store";
import {
  ALL_PROVIDERS,
  getProviderLabel,
  MODEL_SPEED_OPTIONS,
  REASONING_EFFORT_OPTIONS,
} from "./ide-types";

import {
  formatDeletedDate,
  ProviderStatusCard,
  SettingsControlRow,
  SettingsGroup,
  SettingsSwitchRow,
} from "./settings";

const getAccentColorSwatch = (color: AccentColor) =>
  color === "black-white"
    ? "linear-gradient(135deg, var(--foreground) 0 50%, var(--background) 50% 100%)"
    : `var(--color-${color}-500)`;

const BASE_COLOR_SWATCHES: Record<BaseColor, string> = {
  gray: "oklch(0.551 0.027 264.364)",
  neutral: "oklch(0.556 0 0)",
  slate: "oklch(0.554 0.046 257.417)",
  stone: "oklch(0.553 0.013 58.071)",
  zinc: "oklch(0.552 0.016 285.938)",
};

const getBaseColorSwatch = (color: BaseColor) => BASE_COLOR_SWATCHES[color];
const appVersion = packageJson.version;

const getShellExecutableName = (value: string) => {
  const match = value.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const command = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return command.split(/[\\/]/).pop()?.toLowerCase() ?? "";
};

const findTerminalShellOption = (
  options: TerminalShellOption[],
  shellPath: string,
) => {
  const exactMatch = options.find((option) => option.shellPath === shellPath);
  if (exactMatch || !shellPath) {
    return exactMatch ?? null;
  }

  const configuredExecutable = getShellExecutableName(shellPath);
  const executableAliases = [
    new Set(["powershell", "powershell.exe"]),
    new Set(["pwsh", "pwsh.exe"]),
  ];

  return (
    options.find((option) => {
      const optionExecutable = getShellExecutableName(option.shellPath);
      if (
        executableAliases.some(
          (aliases) =>
            aliases.has(configuredExecutable) && aliases.has(optionExecutable),
        )
      ) {
        return true;
      }

      return configuredExecutable === optionExecutable;
    }) ?? null
  );
};

export const SettingsDialog = () => {
  const commonT = useTranslations("common");
  const localeT = useTranslations("locale");
  const modelT = useTranslations("models");
  const providerT = useTranslations("provider");
  const settingsT = useTranslations("settings");
  const themeT = useTranslations("theme");
  const uiT = useTranslations("ui");
  const getColorLabel = (color: AccentColor | BaseColor) =>
    uiT(`colors.${color === "black-white" ? "blackWhite" : color}`);
  const settings = useIdeStore((s) => s.settings);
  const settingsOpen = useIdeStore((s) => s.settingsOpen);
  const settingsSection = useIdeStore((s) => s.settingsSection);
  const providerModels = useIdeStore((s) => s.providerModels);
  const chats = useIdeStore((s) => s.chats);
  const projects = useIdeStore((s) => s.projects);
  const closedProjects = useIdeStore((s) => s.closedProjects);

  const setSettings = useIdeStore((s) => s.setSettings);
  const setSettingsOpen = useIdeStore((s) => s.setSettingsOpen);
  const setSettingsSection = useIdeStore((s) => s.setSettingsSection);
  const toggleProviderModel = useIdeStore((s) => s.toggleProviderModel);
  const refreshProviderModels = useIdeStore((s) => s.refreshProviderModels);
  const archiveInactiveChats = useIdeStore((s) => s.archiveInactiveChats);
  const permanentlyDeleteChats = useIdeStore((s) => s.permanentlyDeleteChats);
  const restoreChats = useIdeStore((s) => s.restoreChats);

  const accentColor = useUiStore((s) => s.accentColor);
  const baseColor = useUiStore((s) => s.baseColor);
  const setAccentColor = useUiStore((s) => s.setAccentColor);
  const setBaseColor = useUiStore((s) => s.setBaseColor);
  const { setTheme, theme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [terminalShellOptions, setTerminalShellOptions] = useState<
    TerminalShellOption[]
  >([]);
  const [selectedDeletedChatIds, setSelectedDeletedChatIds] = useState<
    string[]
  >([]);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    let cancelled = false;

    const loadTerminalShells = async () => {
      const desktopApi = getDesktopApi();
      if (!desktopApi) {
        return;
      }

      const shells = await desktopApi.detectTerminalShells();
      if (!cancelled) {
        setTerminalShellOptions(shells);
        setSettings((previous) => {
          const matchedShell = findTerminalShellOption(
            shells,
            previous.shellPath,
          );
          const normalizedShellPath =
            matchedShell?.shellPath ?? shells[0]?.shellPath;
          if (
            !previous.shellPath ||
            !normalizedShellPath ||
            normalizedShellPath === previous.shellPath
          ) {
            return previous;
          }

          return {
            ...previous,
            shellPath: normalizedShellPath,
          };
        });
      }
    };

    void loadTerminalShells();

    return () => {
      cancelled = true;
    };
  }, [setSettings, settingsOpen]);

  const selectedTerminalShell =
    findTerminalShellOption(terminalShellOptions, settings.shellPath) ??
    terminalShellOptions[0] ??
    null;

  const openAiModels = useMemo(
    () => getModelsForProvider("openai", settings),
    [settings],
  );
  const anthropicModels = useMemo(
    () => getModelsForProvider("anthropic", settings),
    [settings],
  );
  const openCodeModels = useMemo(
    () => getModelsForProvider("opencode", settings),
    [settings],
  );
  const cursorModels = useMemo(
    () => getModelsForProvider("cursor", settings),
    [settings],
  );
  const grokModels = useMemo(
    () => getModelsForProvider("grok", settings),
    [settings],
  );
  const availableOpenAiModels = providerModels.openai.models;
  const availableAnthropicModels = providerModels.anthropic.models;
  const availableOpenCodeModels = providerModels.opencode.models;
  const availableCursorModels = providerModels.cursor.models;
  const availableGrokModels = providerModels.grok.models;

  const openAiModelOptions = useMemo(
    () => getModelOptionsForProvider("openai", settings, availableOpenAiModels),
    [availableOpenAiModels, settings],
  );
  const anthropicModelOptions = useMemo(
    () =>
      getModelOptionsForProvider(
        "anthropic",
        settings,
        availableAnthropicModels,
      ),
    [availableAnthropicModels, settings],
  );
  const openCodeModelOptions = useMemo(
    () =>
      getModelOptionsForProvider("opencode", settings, availableOpenCodeModels),
    [availableOpenCodeModels, settings],
  );
  const cursorModelOptions = useMemo(
    () => getModelOptionsForProvider("cursor", settings, availableCursorModels),
    [availableCursorModels, settings],
  );
  const grokModelOptions = useMemo(
    () => getModelOptionsForProvider("grok", settings, availableGrokModels),
    [availableGrokModels, settings],
  );
  const groupedDefaultModelOptions = useMemo(
    () =>
      [
        { models: openAiModelOptions, provider: "openai" as const },
        { models: anthropicModelOptions, provider: "anthropic" as const },
        { models: openCodeModelOptions, provider: "opencode" as const },
        { models: cursorModelOptions, provider: "cursor" as const },
        { models: grokModelOptions, provider: "grok" as const },
      ].filter((group) => group.models.length > 0),
    [
      anthropicModelOptions,
      cursorModelOptions,
      grokModelOptions,
      openAiModelOptions,
      openCodeModelOptions,
    ],
  );

  const selectedDefaultModel = useMemo(() => {
    const enabledModelIds = groupedDefaultModelOptions.flatMap((group) =>
      group.models.map((model) => model.id),
    );

    if (enabledModelIds.includes(settings.defaultModel)) {
      return settings.defaultModel;
    }

    return enabledModelIds[0] ?? "";
  }, [groupedDefaultModelOptions, settings.defaultModel]);
  const selectedGitGenerationModel = useMemo(() => {
    const enabledModelIds = groupedDefaultModelOptions.flatMap((group) =>
      group.models.map((model) => model.id),
    );

    if (enabledModelIds.includes(settings.defaultGitGenerationModel)) {
      return settings.defaultGitGenerationModel;
    }

    if (enabledModelIds.includes(settings.defaultModel)) {
      return settings.defaultModel;
    }

    return enabledModelIds[0] ?? "";
  }, [
    groupedDefaultModelOptions,
    settings.defaultGitGenerationModel,
    settings.defaultModel,
  ]);

  const getDefaultModelEntry = (modelId: string) => {
    for (const group of groupedDefaultModelOptions) {
      const model = group.models.find((item) => item.id === modelId);
      if (model) {
        return { model, provider: group.provider };
      }
    }

    return null;
  };

  const getDefaultModelCapabilities = (
    entry: ReturnType<typeof getDefaultModelEntry>,
  ) => {
    if (!entry) {
      return {
        reasoningEfforts: [] as ReasoningEffort[],
        speedTiers: [] as ModelSpeed[],
      };
    }

    return {
      reasoningEfforts: entry.model.reasoningEfforts?.length
        ? entry.model.reasoningEfforts
        : getModelReasoningEfforts(entry.provider, entry.model.id),
      speedTiers: entry.model.speedTiers?.length
        ? entry.model.speedTiers
        : getModelSpeedTiers(entry.provider, entry.model.id),
    };
  };

  const selectedDefaultModelEntry = getDefaultModelEntry(selectedDefaultModel);
  const selectedDefaultModelOption = selectedDefaultModelEntry?.model ?? null;
  const selectedGitGenerationModelOption =
    getDefaultModelEntry(selectedGitGenerationModel)?.model ?? null;
  const defaultModelCapabilities = getDefaultModelCapabilities(
    selectedDefaultModelEntry,
  );
  const defaultModelSpeedOptions = MODEL_SPEED_OPTIONS.filter((option) =>
    defaultModelCapabilities.speedTiers.includes(option.value),
  );
  const selectedDefaultModelSpeed = resolveModelSpeedForModel(
    settings.defaultModelSpeed,
    defaultModelCapabilities.speedTiers,
  );
  const selectedDefaultModelSpeedLabel = modelT(selectedDefaultModelSpeed);
  const defaultReasoningEffortOptions = REASONING_EFFORT_OPTIONS.filter(
    (option) =>
      defaultModelCapabilities.reasoningEfforts.includes(option.value),
  );
  const selectedDefaultReasoningEffort =
    defaultModelCapabilities.reasoningEfforts.length > 0
      ? (resolveReasoningEffortForModel(
          settings.defaultReasoningEffort,
          defaultModelCapabilities.reasoningEfforts,
        ) ?? "medium")
      : null;
  const selectedDefaultReasoningLabel =
    selectedDefaultReasoningEffort !== null
      ? modelT(selectedDefaultReasoningEffort)
      : settingsT("effort");

  const installedProviderCount = ALL_PROVIDERS.filter(
    (provider) => providerModels[provider].installed,
  ).length;
  const projectsById = useMemo(
    () =>
      new Map(
        [...projects, ...closedProjects].map((project) => [
          project.id,
          project,
        ]),
      ),
    [closedProjects, projects],
  );
  const deletedChats = useMemo(
    () =>
      [...chats]
        .filter((chat) => chat.deletedAt !== null)
        .sort(
          (left, right) =>
            Date.parse(right.deletedAt ?? "") -
            Date.parse(left.deletedAt ?? ""),
        ),
    [chats],
  );
  const selectedDeletedChatIdSet = useMemo(
    () => new Set(selectedDeletedChatIds),
    [selectedDeletedChatIds],
  );
  const allDeletedChatsSelected =
    deletedChats.length > 0 &&
    selectedDeletedChatIds.length === deletedChats.length;
  const someDeletedChatsSelected =
    selectedDeletedChatIds.length > 0 && !allDeletedChatsSelected;

  useEffect(() => {
    setSelectedDeletedChatIds((previous) => {
      const deletedChatIds = new Set(deletedChats.map((chat) => chat.id));
      const next = previous.filter((chatId) => deletedChatIds.has(chatId));
      return next.length === previous.length ? previous : next;
    });
  }, [deletedChats]);

  const toggleDeletedChatSelection = (chatId: string, checked: boolean) => {
    setSelectedDeletedChatIds((previous) => {
      if (checked) {
        return previous.includes(chatId) ? previous : [...previous, chatId];
      }

      return previous.filter((id) => id !== chatId);
    });
  };

  const toggleAllDeletedChatSelection = (checked: boolean) => {
    setSelectedDeletedChatIds(
      checked ? deletedChats.map((chat) => chat.id) : [],
    );
  };

  const handleRestoreSelectedChats = () => {
    restoreChats(selectedDeletedChatIds);
    setSelectedDeletedChatIds([]);
  };

  const handlePermanentlyDeleteSelectedChats = () => {
    permanentlyDeleteChats(selectedDeletedChatIds);
    setSelectedDeletedChatIds([]);
  };
  const handleArchiveInactiveChats = () => {
    archiveInactiveChats();
  };
  const handleRefreshOpenAiProvider = () => {
    void refreshProviderModels({ force: true, provider: "openai" });
  };
  const handleRefreshAnthropicProvider = () => {
    void refreshProviderModels({ force: true, provider: "anthropic" });
  };

  const handleRefreshOpenCodeProvider = () => {
    void refreshProviderModels({ force: true, provider: "opencode" });
  };

  const handleRefreshCursorProvider = () => {
    void refreshProviderModels({ force: true, provider: "cursor" });
  };

  const handleRefreshGrokProvider = () => {
    void refreshProviderModels({ force: true, provider: "grok" });
  };
  const getProviderError = (error: string | null) =>
    error ? uiT("unableToFetchModels") : null;

  return (
    <Dialog onOpenChange={setSettingsOpen} open={settingsOpen}>
      <DialogContent className="!flex h-[min(86vh,780px)] w-[95vw] max-w-[1320px] !flex-col gap-0 overflow-hidden p-0 sm:max-w-[1320px]">
        <DialogHeader className="px-6 py-3.5 text-left">
          <DialogTitle className="text-base leading-6">
            {commonT("settings")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-64 shrink-0 flex-col p-3">
            <div className="space-y-1">
              <button
                className={cn(
                  "w-full rounded-md border border-transparent px-3 py-2 text-left font-medium text-sm outline-none transition-colors focus-visible:border-ring",
                  settingsSection === "appearance"
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSettingsSection("appearance")}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <Monitor className="size-4" />
                  {commonT("general")}
                </span>
              </button>
              <button
                className={cn(
                  "w-full rounded-md border border-transparent px-3 py-2 text-left font-medium text-sm outline-none transition-colors focus-visible:border-ring",
                  settingsSection === "providers"
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSettingsSection("providers")}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <Plug className="size-4" />
                  {commonT("providers")}
                </span>
              </button>
              <button
                className={cn(
                  "w-full rounded-md border border-transparent px-3 py-2 text-left font-medium text-sm outline-none transition-colors focus-visible:border-ring",
                  settingsSection === "chats"
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setSettingsSection("chats")}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <Archive className="size-4" />
                  {settingsT("archivedChats")}
                </span>
              </button>
            </div>
            <div className="mt-auto px-3 py-2 font-mono text-muted-foreground text-xs">
              v{appVersion}
            </div>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="space-y-4 p-3">
              {settingsSection === "appearance" ? (
                <div className="space-y-4">
                  <SettingsControlRow
                    controlClassName="md:w-[34rem]"
                    description={localeT("description")}
                    label={commonT("language")}
                  >
                    <Select
                      onValueChange={(value) =>
                        setSettings((previous) => ({
                          ...previous,
                          locale: value as AppLocale,
                        }))
                      }
                      value={settings.locale}
                    >
                      <SelectTrigger className="w-full md:w-72">
                        <SelectValue>
                          {LOCALE_LABELS[settings.locale]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end" alignItemWithTrigger={false}>
                        {APP_LOCALES.map((locale) => (
                          <SelectItem key={locale} value={locale}>
                            {LOCALE_LABELS[locale]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingsControlRow>

                  <SettingsControlRow
                    description={<p>{settingsT("terminalDescription")}</p>}
                    label={commonT("terminal")}
                  >
                    <Select
                      disabled={terminalShellOptions.length === 0}
                      onValueChange={(value) => {
                        if (!value) {
                          return;
                        }

                        setSettings((previous) => ({
                          ...previous,
                          shellPath: value,
                        }));
                      }}
                      value={selectedTerminalShell?.shellPath ?? null}
                    >
                      <SelectTrigger
                        aria-label={settingsT("shellPath")}
                        className="w-full md:w-72"
                      >
                        <SelectValue>
                          {selectedTerminalShell?.label ??
                            settingsT("shellPath")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end" alignItemWithTrigger={false}>
                        {terminalShellOptions.map((shell) => (
                          <SelectItem key={shell.id} value={shell.shellPath}>
                            {shell.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingsControlRow>

                  <SettingsGroup label={themeT("appearance")}>
                    <SettingsControlRow
                      description={themeT("themeDescription")}
                      label={themeT("theme")}
                    >
                      <Tabs
                        className="w-full"
                        onValueChange={(value) => {
                          if (value) {
                            setTheme(value);
                          }
                        }}
                        value={themeMounted ? (theme ?? "dark") : "dark"}
                      >
                        <TabsList
                          className="w-full justify-start"
                          id="theme-tabs"
                        >
                          <TabsTrigger value="system">
                            <Monitor className="size-4" />
                            {themeT("system")}
                          </TabsTrigger>
                          <TabsTrigger value="light">
                            <Sun className="size-4" />
                            {themeT("light")}
                          </TabsTrigger>
                          <TabsTrigger value="dark">
                            <Moon className="size-4" />
                            {themeT("dark")}
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </SettingsControlRow>

                    <SettingsControlRow
                      controlClassName="md:w-[34rem]"
                      description={themeT("baseColorDescription")}
                      label={themeT("baseColor")}
                    >
                      <div className="flex justify-end gap-2">
                        {BASE_COLORS.map((color) => {
                          const selected = baseColor === color;

                          return (
                            <button
                              aria-label={getColorLabel(color)}
                              aria-pressed={selected}
                              className={cn(
                                "size-6 rounded-full border border-border shadow-xs outline-none transition-all hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                selected
                                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                                  : "ring-1 ring-transparent",
                              )}
                              key={color}
                              onClick={() => setBaseColor(color)}
                              style={{
                                background: getBaseColorSwatch(color),
                              }}
                              title={getColorLabel(color)}
                              type="button"
                            />
                          );
                        })}
                      </div>
                    </SettingsControlRow>

                    <SettingsControlRow
                      controlClassName="md:w-[34rem]"
                      description={themeT("accentColorDescription")}
                      label={themeT("accentColor")}
                    >
                      <div className="grid grid-cols-9 gap-2">
                        {ACCENT_COLORS.map((color) => {
                          const selected = accentColor === color;

                          return (
                            <button
                              aria-label={getColorLabel(color)}
                              aria-pressed={selected}
                              className={cn(
                                "size-6 rounded-full border border-border shadow-xs outline-none transition-all hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                selected
                                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                                  : "ring-1 ring-transparent",
                              )}
                              key={color}
                              onClick={() => setAccentColor(color)}
                              style={{
                                background: getAccentColorSwatch(color),
                              }}
                              title={getColorLabel(color)}
                              type="button"
                            />
                          );
                        })}
                      </div>
                    </SettingsControlRow>
                  </SettingsGroup>

                  <SettingsGroup label={settingsT("chatMessages")}>
                    <SettingsSwitchRow
                      checked={settings.showReasoningSummaries}
                      description={settingsT(
                        "showReasoningSummariesDescription",
                      )}
                      label={settingsT("showReasoningSummaries")}
                      onCheckedChange={(checked) =>
                        setSettings((previous) => ({
                          ...previous,
                          showReasoningSummaries: checked,
                        }))
                      }
                    />
                    <SettingsSwitchRow
                      checked={settings.groupToolCalls}
                      description={settingsT("groupToolCallsDescription")}
                      label={settingsT("groupToolCalls")}
                      onCheckedChange={(checked) =>
                        setSettings((previous) => ({
                          ...previous,
                          groupToolCalls: checked,
                        }))
                      }
                    />
                    <SettingsSwitchRow
                      checked={settings.changeCheckpoints}
                      description={settingsT("changeCheckpointsDescription")}
                      label={settingsT("changeCheckpoints")}
                      onCheckedChange={(checked) =>
                        setSettings((previous) => ({
                          ...previous,
                          changeCheckpoints: checked,
                        }))
                      }
                    />
                    <SettingsSwitchRow
                      checked={settings.expandToolCalls}
                      description={settingsT("expandToolCallsDescription")}
                      label={settingsT("expandToolCalls")}
                      onCheckedChange={(checked) =>
                        setSettings((previous) => ({
                          ...previous,
                          expandToolCalls: checked,
                        }))
                      }
                    />
                  </SettingsGroup>

                  <SettingsGroup label={settingsT("models")}>
                    <SettingsControlRow
                      controlClassName="md:w-[34rem]"
                      description={settingsT(
                        "defaultModelForNewChatsDescription",
                      )}
                      label={settingsT("defaultModelForNewChats")}
                    >
                      <div className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <Select
                          onValueChange={(value) => {
                            const defaultModel = value ?? "";
                            const capabilities = getDefaultModelCapabilities(
                              getDefaultModelEntry(defaultModel),
                            );

                            setSettings((previous) => ({
                              ...previous,
                              defaultModel,
                              defaultModelSpeed: resolveModelSpeedForModel(
                                previous.defaultModelSpeed,
                                capabilities.speedTiers,
                              ),
                              defaultReasoningEffort:
                                resolveReasoningEffortForModel(
                                  previous.defaultReasoningEffort,
                                  capabilities.reasoningEfforts,
                                ),
                            }));
                          }}
                          value={selectedDefaultModel}
                        >
                          <SelectTrigger
                            className="w-full"
                            disabled={groupedDefaultModelOptions.length === 0}
                            id="default-model"
                          >
                            <SelectValue
                              placeholder={settingsT("enableModelFirst")}
                            >
                              {selectedDefaultModelOption?.label}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="min-w-72">
                            {groupedDefaultModelOptions.map((group) => (
                              <SelectGroup key={group.provider}>
                                {groupedDefaultModelOptions.length > 1 ? (
                                  <SelectLabel>
                                    {getProviderLabel(group.provider)}
                                  </SelectLabel>
                                ) : null}
                                {group.models.map((model) => (
                                  <SelectItem key={model.id} value={model.id}>
                                    {model.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>

                        {defaultReasoningEffortOptions.length > 0 &&
                        selectedDefaultReasoningEffort ? (
                          <Select
                            onValueChange={(value) =>
                              setSettings((previous) => ({
                                ...previous,
                                defaultReasoningEffort:
                                  value === "medium"
                                    ? null
                                    : (value as ReasoningEffort),
                              }))
                            }
                            value={selectedDefaultReasoningEffort}
                          >
                            <SelectTrigger
                              aria-label={settingsT("effort")}
                              className="w-full sm:w-32"
                            >
                              <SelectValue>
                                {selectedDefaultReasoningLabel}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>{settingsT("effort")}</SelectLabel>
                                {defaultReasoningEffortOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {modelT(option.value)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : null}

                        {defaultModelSpeedOptions.length > 0 ? (
                          <Select
                            onValueChange={(value) =>
                              setSettings((previous) => ({
                                ...previous,
                                defaultModelSpeed: value as ModelSpeed,
                              }))
                            }
                            value={selectedDefaultModelSpeed}
                          >
                            <SelectTrigger
                              aria-label={settingsT("speed")}
                              className="w-full sm:w-32"
                            >
                              <SelectValue>
                                {selectedDefaultModelSpeedLabel}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>{settingsT("speed")}</SelectLabel>
                                {defaultModelSpeedOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {modelT(option.value)}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : null}
                      </div>
                    </SettingsControlRow>

                    <SettingsControlRow
                      controlClassName="md:w-[34rem] md:justify-end"
                      description={settingsT(
                        "defaultModelForCommitsDescription",
                      )}
                      label={settingsT("defaultModelForCommits")}
                    >
                      <Select
                        onValueChange={(value) =>
                          setSettings((previous) => ({
                            ...previous,
                            defaultGitGenerationModel: value ?? "",
                          }))
                        }
                        value={selectedGitGenerationModel}
                      >
                        <SelectTrigger
                          className="w-full md:w-72"
                          disabled={groupedDefaultModelOptions.length === 0}
                          id="default-git-generation-model"
                        >
                          <SelectValue
                            placeholder={settingsT("enableModelFirst")}
                          >
                            {selectedGitGenerationModelOption?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="min-w-72">
                          {groupedDefaultModelOptions.map((group) => (
                            <SelectGroup key={group.provider}>
                              {groupedDefaultModelOptions.length > 1 ? (
                                <SelectLabel>
                                  {getProviderLabel(group.provider)}
                                </SelectLabel>
                              ) : null}
                              {group.models.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingsControlRow>
                  </SettingsGroup>
                </div>
              ) : null}

              {settingsSection === "providers" ? (
                <div className="space-y-4 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="font-medium text-sm">
                        {commonT("providers")}
                      </h3>
                      {providerModels.fetchedAt ? (
                        <p className="text-muted-foreground text-xs">
                          {settingsT("lastChecked", {
                            date: new Date(
                              providerModels.fetchedAt,
                            ).toLocaleString(),
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {installedProviderCount === 0 ? (
                    <p className="rounded-md px-3 py-2 text-muted-foreground text-sm">
                      {settingsT("installProviders")}
                    </p>
                  ) : null}

                  <div className="grid gap-3">
                    <ProviderStatusCard
                      action={
                        <Button
                          aria-label={settingsT("refreshProvider", {
                            provider: providerT("openai"),
                          })}
                          disabled={providerModels.openai.loading}
                          onClick={handleRefreshOpenAiProvider}
                          size="icon-xs"
                          title={settingsT("refreshProvider", {
                            provider: providerT("openai"),
                          })}
                          type="button"
                          variant="ghost"
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      error={getProviderError(providerModels.openai.error)}
                      installed={providerModels.openai.installed}
                      label="OpenAI"
                      logoSrc={openAiLogo}
                      loading={providerModels.openai.loading}
                      runtimeLabel={providerT("codexCli")}
                      version={providerModels.openai.version}
                    >
                      <div className="space-y-1.5 rounded-md p-1">
                        {availableOpenAiModels.length === 0 ? (
                          <p className="px-2 py-1.5 text-muted-foreground text-sm">
                            {settingsT("noCliModels")}
                          </p>
                        ) : (
                          availableOpenAiModels.map((model) => {
                            const isSelected = openAiModels.includes(model.id);

                            return (
                              <div
                                className="flex items-center justify-between rounded-sm px-1.5 py-1 hover:bg-muted"
                                key={model.id}
                              >
                                <Label
                                  className={cn(
                                    "truncate pr-3 text-sm",
                                    isSelected
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {model.label}
                                </Label>
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked !== isSelected) {
                                      toggleProviderModel(
                                        "openai",
                                        model.id,
                                        checked,
                                      );
                                    }
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ProviderStatusCard>
                    <ProviderStatusCard
                      action={
                        <Button
                          aria-label={settingsT("refreshProvider", {
                            provider: providerT("anthropic"),
                          })}
                          disabled={providerModels.anthropic.loading}
                          onClick={handleRefreshAnthropicProvider}
                          size="icon-xs"
                          title={settingsT("refreshProvider", {
                            provider: providerT("anthropic"),
                          })}
                          type="button"
                          variant="ghost"
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      error={getProviderError(providerModels.anthropic.error)}
                      installed={providerModels.anthropic.installed}
                      label="Anthropic"
                      logoSrc={anthropicLogo}
                      loading={providerModels.anthropic.loading}
                      runtimeLabel={providerT("claudeCodeCli")}
                      version={providerModels.anthropic.version}
                    >
                      <div className="space-y-1.5 rounded-md p-1">
                        {availableAnthropicModels.length === 0 ? (
                          <p className="px-2 py-1.5 text-muted-foreground text-sm">
                            {settingsT("noCliModels")}
                          </p>
                        ) : (
                          availableAnthropicModels.map((model) => {
                            const isSelected = anthropicModels.includes(
                              model.id,
                            );

                            return (
                              <div
                                className="flex items-center justify-between rounded-sm px-1.5 py-1 hover:bg-muted"
                                key={model.id}
                              >
                                <Label
                                  className={cn(
                                    "truncate pr-3 text-sm",
                                    isSelected
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {model.label}
                                </Label>
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked !== isSelected) {
                                      toggleProviderModel(
                                        "anthropic",
                                        model.id,
                                        checked,
                                      );
                                    }
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ProviderStatusCard>
                    <ProviderStatusCard
                      action={
                        <Button
                          aria-label={settingsT("refreshProvider", {
                            provider: providerT("opencode"),
                          })}
                          disabled={providerModels.opencode.loading}
                          onClick={handleRefreshOpenCodeProvider}
                          size="icon-xs"
                          title={settingsT("refreshProvider", {
                            provider: providerT("opencode"),
                          })}
                          type="button"
                          variant="ghost"
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      error={getProviderError(providerModels.opencode.error)}
                      installed={providerModels.opencode.installed}
                      label="OpenCode"
                      logoSrc={openCodeLogo}
                      loading={providerModels.opencode.loading}
                      runtimeLabel={providerT("opencodeCli")}
                      version={providerModels.opencode.version}
                    >
                      <div className="space-y-1.5 rounded-md p-1">
                        {availableOpenCodeModels.length === 0 ? (
                          <p className="px-2 py-1.5 text-muted-foreground text-sm">
                            {settingsT("noOpenCodeModels")}
                          </p>
                        ) : (
                          availableOpenCodeModels.map((model) => {
                            const isSelected = openCodeModels.includes(
                              model.id,
                            );

                            return (
                              <div
                                className="flex items-center justify-between rounded-sm px-1.5 py-1 hover:bg-muted"
                                key={model.id}
                              >
                                <Label
                                  className={cn(
                                    "truncate pr-3 text-sm",
                                    isSelected
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {model.label}
                                </Label>
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked !== isSelected) {
                                      toggleProviderModel(
                                        "opencode",
                                        model.id,
                                        checked,
                                      );
                                    }
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ProviderStatusCard>
                    <ProviderStatusCard
                      action={
                        <Button
                          aria-label={settingsT("refreshProvider", {
                            provider: providerT("cursor"),
                          })}
                          disabled={providerModels.cursor.loading}
                          onClick={handleRefreshCursorProvider}
                          size="icon-xs"
                          title={settingsT("refreshProvider", {
                            provider: providerT("cursor"),
                          })}
                          type="button"
                          variant="ghost"
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      error={getProviderError(providerModels.cursor.error)}
                      icon={
                        <CursorIcon
                          aria-hidden="true"
                          className="size-4 text-foreground"
                          role="presentation"
                        />
                      }
                      installed={providerModels.cursor.installed}
                      label="Cursor"
                      loading={providerModels.cursor.loading}
                      runtimeLabel={providerT("cursorAgentCli")}
                      version={providerModels.cursor.version}
                    >
                      <div className="space-y-1.5 rounded-md p-1">
                        {availableCursorModels.length === 0 ? (
                          <p className="px-2 py-1.5 text-muted-foreground text-sm">
                            {settingsT("noCliModels")}
                          </p>
                        ) : (
                          availableCursorModels.map((model) => {
                            const isSelected = cursorModels.includes(model.id);

                            return (
                              <div
                                className="flex items-center justify-between rounded-sm px-1.5 py-1 hover:bg-muted"
                                key={model.id}
                              >
                                <Label
                                  className={cn(
                                    "truncate pr-3 text-sm",
                                    isSelected
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {model.label}
                                </Label>
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked !== isSelected) {
                                      toggleProviderModel(
                                        "cursor",
                                        model.id,
                                        checked,
                                      );
                                    }
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ProviderStatusCard>
                    <ProviderStatusCard
                      action={
                        <Button
                          aria-label={settingsT("refreshProvider", {
                            provider: "Grok Build",
                          })}
                          disabled={providerModels.grok.loading}
                          onClick={handleRefreshGrokProvider}
                          size="icon-xs"
                          title={settingsT("refreshProvider", {
                            provider: "Grok Build",
                          })}
                          type="button"
                          variant="ghost"
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      error={getProviderError(providerModels.grok.error)}
                      icon={
                        <GrokIcon
                          aria-hidden="true"
                          className="size-4 text-foreground"
                          role="presentation"
                        />
                      }
                      installed={providerModels.grok.installed}
                      label="Grok Build"
                      loading={providerModels.grok.loading}
                      runtimeLabel="Grok Build CLI"
                      version={providerModels.grok.version}
                    >
                      <div className="space-y-1.5 rounded-md p-1">
                        {availableGrokModels.length === 0 ? (
                          <p className="px-2 py-1.5 text-muted-foreground text-sm">
                            {settingsT("noCliModels")}
                          </p>
                        ) : (
                          availableGrokModels.map((model) => {
                            const isSelected = grokModels.includes(model.id);

                            return (
                              <div
                                className="flex items-center justify-between rounded-sm px-1.5 py-1 hover:bg-muted"
                                key={model.id}
                              >
                                <Label
                                  className={cn(
                                    "truncate pr-3 text-sm",
                                    isSelected
                                      ? "text-foreground"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {model.label}
                                </Label>
                                <Switch
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    if (checked !== isSelected) {
                                      toggleProviderModel(
                                        "grok",
                                        model.id,
                                        checked,
                                      );
                                    }
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ProviderStatusCard>
                  </div>
                </div>
              ) : null}

              {settingsSection === "chats" ? (
                <div className="space-y-4 rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="font-medium text-sm">
                        {settingsT("archivedChats")}
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        {settingsT("archivedChatCount", {
                          count: deletedChats.length,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={selectedDeletedChatIds.length === 0}
                        onClick={handleRestoreSelectedChats}
                        type="button"
                        variant="outline"
                      >
                        <RotateCcw className="size-4" />
                        {commonT("restore")}
                      </Button>
                      <Button
                        disabled={selectedDeletedChatIds.length === 0}
                        onClick={handlePermanentlyDeleteSelectedChats}
                        type="button"
                        variant="destructive"
                      >
                        <Trash2 className="size-4" />
                        {commonT("delete")}
                      </Button>
                    </div>
                  </div>

                  {deletedChats.length === 0 ? (
                    <div className="flex min-h-[280px] items-center justify-center rounded-md border border-surface-200 dark:border-surface-800">
                      <p className="text-muted-foreground text-sm">
                        {settingsT("noArchivedChats")}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-surface-200 dark:border-surface-800">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">
                              <Checkbox
                                aria-label={settingsT("selectAllArchivedChats")}
                                checked={allDeletedChatsSelected}
                                indeterminate={someDeletedChatsSelected}
                                onCheckedChange={(checked) =>
                                  toggleAllDeletedChatSelection(checked)
                                }
                              />
                            </TableHead>
                            <TableHead>{commonT("chat")}</TableHead>
                            <TableHead>{commonT("project")}</TableHead>
                            <TableHead className="text-right">
                              {commonT("archived")}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deletedChats.map((chat) => {
                            const project = projectsById.get(chat.projectId);
                            const checked = selectedDeletedChatIdSet.has(
                              chat.id,
                            );

                            return (
                              <TableRow key={chat.id}>
                                <TableCell>
                                  <Checkbox
                                    aria-label={settingsT(
                                      "selectArchivedChat",
                                      {
                                        title: chat.title,
                                      },
                                    )}
                                    checked={checked}
                                    onCheckedChange={(nextChecked) =>
                                      toggleDeletedChatSelection(
                                        chat.id,
                                        nextChecked === true,
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell className="max-w-[320px] truncate font-medium">
                                  {chat.title}
                                </TableCell>
                                <TableCell className="max-w-[280px] truncate text-muted-foreground">
                                  {project?.name ?? commonT("unknownProject")}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {formatDeletedDate(chat.deletedAt ?? "")}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <SettingsControlRow
                    controlClassName="md:w-[34rem]"
                    description={settingsT("archiveInactiveChatsDescription")}
                    label={settingsT("archiveChatsAfterDays")}
                  >
                    <div className="flex w-full flex-col items-end gap-2 sm:flex-row sm:justify-end">
                      <Input
                        aria-label={settingsT("archiveDays")}
                        className="w-20"
                        inputMode="numeric"
                        onBlur={(event) => {
                          if (event.currentTarget.value !== "") {
                            return;
                          }

                          setSettings((previous) => ({
                            ...previous,
                            archiveChatsAfterDays: 30,
                          }));
                        }}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;
                          if (!/^\d+$/.test(nextValue)) {
                            return;
                          }

                          setSettings((previous) => ({
                            ...previous,
                            archiveChatsAfterDays: Math.max(
                              1,
                              Number.parseInt(nextValue, 10),
                            ),
                          }));
                        }}
                        pattern="[0-9]*"
                        type="text"
                        value={settings.archiveChatsAfterDays}
                      />
                      <Button
                        onClick={handleArchiveInactiveChats}
                        type="button"
                        variant="outline"
                      >
                        <Archive className="size-4" />
                        {settingsT("archiveNow")}
                      </Button>
                    </div>
                  </SettingsControlRow>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
