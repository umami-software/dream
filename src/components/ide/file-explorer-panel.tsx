import {
  FileTree as PierreFileTree,
  useFileTree,
  useFileTreeSearch,
} from "@pierre/trees/react";
import {
  Ellipsis,
  FileIcon,
  Files,
  Maximize2,
  Minimize2,
  RotateCw,
  Save,
  Search,
  TextWrap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { BundledLanguage } from "shiki";
import {
  CodeBlockContainer,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { getDesktopApi } from "@/lib/electron";
import {
  type FileBuffersState,
  fileBuffersReducer,
  getFileBufferKey,
} from "./file-buffers";
import {
  type FileTabsState,
  fileTabsReducer,
  getProjectFileTabs,
} from "./file-tabs";
import { AppShellPlaceholder, PanelResizeHandle } from "./ide-helpers";
import { useIdeStore } from "./ide-store";
import { useMaterialFileTreeIcons } from "./material-file-icon";
import {
  ProjectDirectoryLoader,
  type ProjectDirectoryResponse,
  resolveSelectedProjectFile,
  toProjectTreePath,
} from "./project-directory-loader";
import { ProjectFileSearchIndex } from "./project-file-search-index";
import { RightPanelHeaderIconButton } from "./right-panel-header-icon-button";
import { type StandardTabItem, StandardTabs } from "./standard-tabs";

const FILE_TREE_MIN_WIDTH_PX = 250;
const FILE_TREE_MAX_WIDTH_RATIO = 0.5;
const FILE_TREE_ITEM_HEIGHT_PX = 24;
// Flat path index used to back tree search. Paths only, gitignore-aware, and
// fetched at most once per project until the panel is refreshed.
const PROJECT_SEARCH_INDEX_LIMIT = 50_000;
// Upper bound on how many matching paths get injected into the tree per query.
const PROJECT_SEARCH_INJECT_LIMIT = 200;
const PROJECT_SEARCH_DEBOUNCE_MS = 120;

const FileCodeEditor = lazy(() => import("./file-code-editor"));

export interface FileExplorerPanelProps {
  active?: boolean;
  expanded?: boolean;
  onClosePanel: () => void;
  onToggleExpanded?: () => void;
  projectId?: string | null;
}

type ProjectFileReadResponse = {
  content: string;
  filePath: string;
  lineEnding: "crlf" | "lf";
  readOnlyReason: string | null;
  writable: boolean;
};

type ProjectFileWriteResponse = Pick<
  ProjectFileReadResponse,
  "content" | "filePath" | "lineEnding"
>;

interface ProjectFileMetadata {
  lineEnding: "crlf" | "lf";
  readOnlyReason: string | null;
  writable: boolean;
}

const isFilePreviewUnavailableStatus = (status: number) =>
  status === 413 || status === 415;

interface ProjectFileTreeProps {
  active: boolean;
  onSelectedFileMissing: (path: string) => void;
  projectPath: string;
  refreshVersion: number;
  selectedFilePath: string | null;
  onSelectFile: (path: string | null) => void;
  // Fired on double-click / Enter. Mirrors VS Code: a single click previews
  // the file in a reusable tab, while this promotes it to a persistent tab.
  onPinFile: (path: string) => void;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
]);

const isImageFile = (filePath: string): boolean => {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
};

const getProjectFileRawUrl = (projectPath: string, filePath: string) =>
  `/api/project-file-raw?projectPath=${encodeURIComponent(projectPath)}&filePath=${encodeURIComponent(filePath)}`;

const inferLanguage = (filePath: string): BundledLanguage => {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  const languages: Record<string, BundledLanguage> = {
    c: "c",
    cpp: "cpp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rs: "rust",
    sh: "bash",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    txt: "log",
    yml: "yaml",
    yaml: "yaml",
  };

  return languages[extension] ?? "log";
};

const readResponseText = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  const text = await response.text();
  return text.trim() || fallback;
};

const isMissingPathError = (message: string | null) =>
  Boolean(message && /ENOENT|no such file or directory/i.test(message));

const FILE_TREE_UNSAFE_CSS = `
  :host {
    font-size: 12px;
    line-height: 18px;
  }

  [data-type="item"] {
    border: 0;
    border-radius: 4px;
    box-shadow: none;
    font-family: var(--trees-font-family);
    outline: none;
  }

  [data-type="item"]::before,
  [data-type="item"][data-item-focused="true"]::before,
  [data-type="item"][data-item-selected="true"]::before,
  [data-type="item"]:focus-visible::before {
    content: none;
    display: none;
    border: 0;
    box-shadow: none;
    outline: none;
  }

  [data-file-tree-virtualized-scroll]::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  [data-file-tree-virtualized-scroll]::-webkit-scrollbar-thumb {
    background-color: var(--trees-theme-scrollbar-thumb);
    border: 2px solid transparent;
    border-radius: 999px;
    background-clip: padding-box;
  }
`;

const fileTreeStyle = {
  "--trees-font-family-override":
    'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  "--trees-focus-ring-offset-override": "0px",
  "--trees-focus-ring-width-override": "0px",
  "--trees-padding-inline-override": "24px",
  "--trees-selected-focused-border-color-override": "transparent",
  "--trees-scrollbar-gutter-override": "10px",
  "--trees-theme-focus-ring": "var(--ring)",
  "--trees-theme-input-bg": "var(--background)",
  "--trees-theme-input-border": "var(--border)",
  "--trees-theme-list-active-selection-bg": "var(--accent)",
  "--trees-theme-list-active-selection-fg": "var(--accent-foreground)",
  "--trees-theme-list-hover-bg": "var(--accent)",
  "--trees-theme-scrollbar-thumb": "var(--border)",
  "--trees-theme-sidebar-bg": "var(--background)",
  "--trees-theme-sidebar-border": "var(--border)",
  "--trees-theme-sidebar-fg": "var(--foreground)",
  "--truncate-marker-background-color": "var(--background)",
  backgroundColor: "var(--background)",
  borderColor: "transparent",
  color: "var(--foreground)",
  colorScheme: "light dark",
  display: "block",
  height: "100%",
  width: "100%",
} as CSSProperties;

const ProjectFileTree = ({
  active,
  onPinFile,
  onSelectedFileMissing,
  onSelectFile,
  projectPath,
  refreshVersion,
  selectedFilePath,
}: ProjectFileTreeProps) => {
  const panelsT = useTranslations("panels");
  const knownFilesRef = useRef<ReadonlySet<string>>(new Set());
  const onSelectFileRef = useRef(onSelectFile);
  const onPinFileRef = useRef(onPinFile);
  const onSelectedFileMissingRef = useRef(onSelectedFileMissing);
  const selectedFilePathRef = useRef(selectedFilePath);
  const materialFileTreeIcons = useMaterialFileTreeIcons();
  const [rootStatus, setRootStatus] = useState<
    "idle" | "loading" | "ready" | "empty" | "error"
  >("idle");
  const [directoryErrors, setDirectoryErrors] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    selectedFilePathRef.current = selectedFilePath;
  }, [selectedFilePath]);

  useEffect(() => {
    onSelectFileRef.current = onSelectFile;
  }, [onSelectFile]);

  useEffect(() => {
    onPinFileRef.current = onPinFile;
  }, [onPinFile]);

  useEffect(() => {
    onSelectedFileMissingRef.current = onSelectedFileMissing;
  }, [onSelectedFileMissing]);

  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const selectedPath = selectedPaths[0] ?? null;
      const nextFile = resolveSelectedProjectFile(
        selectedFilePathRef.current,
        selectedPath,
        knownFilesRef.current,
      );
      if (nextFile !== selectedFilePathRef.current) {
        onSelectFileRef.current(nextFile);
      }
    },
    [],
  );

  const searchChangeRef = useRef<(value: string | null) => void>(() => {});

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: false,
    icons: materialFileTreeIcons,
    initialExpansion: "closed",
    itemHeight: FILE_TREE_ITEM_HEIGHT_PX,
    onSearchChange: (value) => searchChangeRef.current(value),
    onSelectionChange: handleSelectionChange,
    paths: [],
    // The tree's search filters the paths present in the model. The model is
    // populated lazily, so typing consults a flat, cached path index (see the
    // injection effect below) and injects only matching paths. Search never
    // triggers per-directory filesystem traversal.
    //
    // The built-in search input (`search: true`) is intentionally disabled:
    // it closes the search on blur regardless of `searchBlurBehavior`. We
    // render our own input bound to the model via useFileTreeSearch instead,
    // so the filter persists until the user explicitly clears it.
    search: false,
    stickyFolders: false,
    unsafeCSS: FILE_TREE_UNSAFE_CSS,
  });

  const treeSearch = useFileTreeSearch(model);

  const searchIndex = useMemo(
    () =>
      new ProjectFileSearchIndex({
        fetchFiles: async () => {
          const response = await fetch("/api/project-files", {
            body: JSON.stringify({
              directory: ".",
              maxResults: PROJECT_SEARCH_INDEX_LIMIT,
              projectPath,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });

          if (!response.ok) {
            throw new Error(
              await readResponseText(
                response,
                `Request failed (${response.status}).`,
              ),
            );
          }

          const payload = (await response.json()) as { files?: string[] };
          return payload.files ?? [];
        },
      }),
    [projectPath],
  );

  const loader = useMemo(
    () =>
      new ProjectDirectoryLoader({
        fetchDirectory: async (directory) => {
          const response = await fetch("/api/project-directory", {
            body: JSON.stringify({ directory, projectPath }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });

          if (!response.ok) {
            throw new Error(
              await readResponseText(
                response,
                `Request failed (${response.status}).`,
              ),
            );
          }

          return (await response.json()) as ProjectDirectoryResponse;
        },
        onDirectoryError: (directory, error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to load project files.";
          setDirectoryErrors((current) => ({
            ...current,
            [directory]: message,
          }));
          if (directory === ".") {
            setRootStatus("error");
          }
        },
        onDirectoryLoaded: (response) => {
          // Skip paths already present in the model (e.g. injected by search,
          // or ancestors implicitly created by them): adding an existing path
          // throws "Path already exists".
          const operations = response.entries
            .map((entry) => toProjectTreePath(entry))
            .filter((path) => !model.getItem(path))
            .map((path) => ({ path, type: "add" as const }));
          if (operations.length > 0) {
            model.batch(operations);
          }
          const nextKnownFiles = new Set(knownFilesRef.current);
          for (const entry of response.entries) {
            if (entry.kind !== "directory") {
              nextKnownFiles.add(entry.path);
            }
          }
          knownFilesRef.current = nextKnownFiles;
          setDirectoryErrors((current) => {
            if (!current[response.directory]) {
              return current;
            }
            const next = { ...current };
            delete next[response.directory];
            return next;
          });
          if (response.directory === ".") {
            setRootStatus(response.entries.length === 0 ? "empty" : "ready");
          }
        },
      }),
    [model, projectPath],
  );

  useEffect(() => {
    model.setIcons(materialFileTreeIcons);
  }, [materialFileTreeIcons, model]);

  useEffect(() => {
    const syncExpandedDirectories = () => {
      // Search maintains its own projected expansion state. Never interpret
      // those changes as user requests to traverse the filesystem.
      if (model.isSearchOpen()) {
        return;
      }
      const expandedDirectories: string[] = [];
      for (const directory of loader.knownDirectories) {
        if (directory === ".") {
          continue;
        }
        const item = model.getItem(`${directory}/`);
        if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) {
          expandedDirectories.push(directory);
        }
      }
      void loader.syncExpandedDirectories(expandedDirectories);
    };

    syncExpandedDirectories();
    return model.subscribe(syncExpandedDirectories);
  }, [loader, model]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const injectSearchMatches = async (query: string) => {
      const generation = searchIndex.generation;
      const loaded = await searchIndex.ensureLoaded();
      if (
        !loaded ||
        disposed ||
        generation !== searchIndex.generation ||
        model.getSearchValue() !== query
      ) {
        return;
      }

      const matches = searchIndex.search(query, PROJECT_SEARCH_INJECT_LIMIT);
      const pathsToAdd = matches.filter((path) => !model.getItem(path));
      if (pathsToAdd.length === 0) {
        return;
      }

      loader.registerPaths(pathsToAdd);
      const nextKnownFiles = new Set(knownFilesRef.current);
      for (const path of pathsToAdd) {
        nextKnownFiles.add(path);
      }
      knownFilesRef.current = nextKnownFiles;
      model.batch(pathsToAdd.map((path) => ({ path, type: "add" as const })));
    };

    searchChangeRef.current = (value) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!value) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void injectSearchMatches(value);
      }, PROJECT_SEARCH_DEBOUNCE_MS);
    };

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      searchChangeRef.current = () => {};
    };
  }, [loader, model, searchIndex]);

  const loadedDirectoryVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      return;
    }
    const directoryVersion = `${projectPath}\0${refreshVersion}`;
    // Key on the loader's own state rather than only on the version ref:
    // StrictMode's simulated unmount (and @pierre/trees swapping its model on
    // remount) invalidates the loader after the first request fires, which
    // would otherwise leave the tree stuck on the loading spinner.
    if (
      loadedDirectoryVersionRef.current === directoryVersion &&
      (loader.isLoaded(".") || loader.isLoading("."))
    ) {
      return;
    }
    loadedDirectoryVersionRef.current = directoryVersion;
    loader.invalidate();
    searchIndex.invalidate();
    knownFilesRef.current = new Set();
    model.resetPaths([]);
    setDirectoryErrors({});
    setRootStatus("loading");
    void loader.load(".").catch(() => undefined);
  }, [active, loader, model, projectPath, refreshVersion, searchIndex]);

  useEffect(
    () => () => {
      loader.invalidate();
      searchIndex.invalidate();
    },
    [loader, searchIndex],
  );

  useEffect(() => {
    void refreshVersion;
    for (const path of model.getSelectedPaths()) {
      if (path !== selectedFilePath) {
        model.getItem(path)?.deselect();
      }
    }

    if (!active || !selectedFilePath) {
      return;
    }

    const generation = loader.generation;
    let cancelled = false;
    void loader
      .revealFile(selectedFilePath, {
        expandDirectory: (directory) => {
          const item = model.getItem(`${directory}/`);
          if (item?.isDirectory() && "expand" in item) {
            item.expand();
          }
        },
        revealFile: (filePath) => {
          for (const selectedPath of model.getSelectedPaths()) {
            if (selectedPath !== filePath) {
              model.getItem(selectedPath)?.deselect();
            }
          }
          model.getItem(filePath)?.select();
          model.focusPath(filePath);
        },
      })
      .then((revealed) => {
        if (
          !revealed &&
          !cancelled &&
          generation === loader.generation &&
          loader.isLoaded(".")
        ) {
          onSelectedFileMissingRef.current(selectedFilePath);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [active, loader, model, refreshVersion, selectedFilePath]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectionSyncFrameRef = useRef<number | null>(null);

  const syncSelectionFromModel = useCallback(() => {
    const selectedPath = model.getSelectedPaths()[0] ?? null;
    const nextFile = resolveSelectedProjectFile(
      selectedFilePathRef.current,
      selectedPath,
      knownFilesRef.current,
    );
    if (nextFile !== selectedFilePathRef.current) {
      onSelectFileRef.current(nextFile);
    }
  }, [model]);

  const pinSelectedFile = useCallback(() => {
    const selectedPath = model.getSelectedPaths()[0] ?? null;
    if (selectedPath && knownFilesRef.current.has(selectedPath)) {
      onPinFileRef.current(selectedPath);
    }
  }, [model]);

  const scheduleSelectionSync = useCallback(() => {
    if (selectionSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionSyncFrameRef.current);
    }

    selectionSyncFrameRef.current = window.requestAnimationFrame(() => {
      selectionSyncFrameRef.current = null;
      syncSelectionFromModel();
    });
  }, [syncSelectionFromModel]);

  useEffect(
    () => () => {
      if (selectionSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionSyncFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const host = wrapper.querySelector("file-tree-container");
    const scrollEl = host?.shadowRoot?.querySelector<HTMLElement>(
      "[data-file-tree-virtualized-scroll]",
    );
    if (!scrollEl) return;

    const SCROLL_MULTIPLIER = 3;

    const handleWheel = (event: WheelEvent) => {
      // Only boost standard pixel-mode wheel events (deltaMode 0)
      if (event.deltaMode !== 0) return;
      event.preventDefault();
      scrollEl.scrollTop += event.deltaY * SCROLL_MULTIPLIER;
      scrollEl.scrollLeft += event.deltaX * SCROLL_MULTIPLIER;
    };

    scrollEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      scrollEl.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const nestedErrors = Object.entries(directoryErrors).filter(
    ([directory]) => directory !== ".",
  );

  if (rootStatus === "idle" || rootStatus === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  if (rootStatus === "error") {
    const rootError =
      directoryErrors["."] ?? panelsT("failedToLoadProjectFiles");
    return (
      <div className="p-3">
        {isMissingPathError(rootError) ? (
          <div className="rounded-md border border-surface-200 dark:border-surface-800 bg-background px-3 py-3">
            <div className="font-medium text-foreground text-sm">
              {panelsT("projectFolderNotFound")}
            </div>
            <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {projectPath}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-destructive-border bg-destructive-surface-muted px-3 py-2 text-destructive text-xs">
            {rootError}
          </div>
        )}
      </div>
    );
  }

  if (rootStatus === "empty") {
    return (
      <div className="h-full p-3">
        <AppShellPlaceholder message={panelsT("noProjectFiles")} />
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="flex h-full flex-col"
      onClickCapture={scheduleSelectionSync}
      onDoubleClickCapture={pinSelectedFile}
      onKeyUpCapture={(event) => {
        scheduleSelectionSync();
        if (
          event.key === "Enter" &&
          !(event.target instanceof HTMLInputElement)
        ) {
          pinSelectedFile();
        }
      }}
    >
      <div className="shrink-0 px-3 pt-3 pb-2">
        <SearchInput
          aria-label={panelsT("searchFiles")}
          clearLabel={panelsT("clearSearch")}
          onClear={() => treeSearch.close()}
          onValueChange={(value) => {
            if (treeSearch.isOpen) {
              treeSearch.setValue(value);
            } else {
              treeSearch.open(value);
            }
          }}
          placeholder={panelsT("searchFiles")}
          value={treeSearch.isOpen ? treeSearch.value : ""}
        />
      </div>
      {nestedErrors.length > 0 ? (
        <div className="shrink-0 space-y-1 p-2 pb-0">
          {nestedErrors.map(([directory, message]) => (
            <div
              className="flex items-center gap-2 rounded-md border border-destructive-border bg-destructive-surface-muted px-2 py-1.5 text-destructive text-xs"
              key={directory}
            >
              <span className="min-w-0 flex-1 truncate" title={message}>
                {directory}: {message}
              </span>
              <button
                aria-label={`Retry loading ${directory}`}
                className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                onClick={() =>
                  void loader.load(directory).catch(() => undefined)
                }
                type="button"
              >
                <RotateCw className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <PierreFileTree
          aria-label={panelsT("projectFiles")}
          model={model}
          style={fileTreeStyle}
        />
      </div>
    </div>
  );
};

const FileExplorerPanelImpl = ({
  active = true,
  expanded = false,
  onClosePanel,
  onToggleExpanded,
  projectId: requestedProjectId,
}: FileExplorerPanelProps) => {
  const commonT = useTranslations("common");
  const panelsT = useTranslations("panels");
  const uiT = useTranslations("ui");
  const activeProject = useIdeStore((s) =>
    requestedProjectId
      ? (s.projects.find((project) => project.id === requestedProjectId) ??
        null)
      : s.getActiveProject(),
  );
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const treePaneRef = useRef<HTMLDivElement | null>(null);
  const treeWidthRef = useRef<number | null>(null);
  const previousProjectFilesRefreshKeyByProjectRef = useRef<
    Record<string, number>
  >({});

  const [fileTabs, dispatchFileTab] = useReducer(
    fileTabsReducer,
    {} as FileTabsState,
  );
  const [fileBuffers, dispatchFileBuffer] = useReducer(
    fileBuffersReducer,
    {} as FileBuffersState,
  );
  const [fileMetadata, setFileMetadata] = useState<
    Record<string, ProjectFileMetadata>
  >({});
  const [filePreviewMessagesByProject, setFilePreviewMessagesByProject] =
    useState<Record<string, Record<string, string>>>({});
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<
    string | null
  >(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [editorSearchRequest, setEditorSearchRequest] = useState(0);
  const [isEditorSearchOpen, setIsEditorSearchOpen] = useState(false);
  const selectedImagePreviewUrlRef = useRef<string | null>(null);

  const replaceSelectedImagePreviewUrl = useCallback((url: string | null) => {
    setSelectedImagePreviewUrl(url);

    const previousUrl = selectedImagePreviewUrlRef.current;
    if (previousUrl && previousUrl !== url) {
      URL.revokeObjectURL(previousUrl);
    }
    selectedImagePreviewUrlRef.current = url;
  }, []);

  const projectId = activeProject?.id ?? null;
  const projectPath = activeProject?.path ?? null;
  const wordWrapEnabled = activeProject?.ui.fileEditorWordWrap ?? false;
  const projectFilesRefreshKey = useIdeStore((s) =>
    projectId ? (s.projectFilesRefreshKeys[projectId] ?? 0) : 0,
  );
  const fileOpenRequest = useIdeStore((s) =>
    projectId ? (s.projectFileOpenRequests[projectId] ?? null) : null,
  );
  const fileOpenRequestPath = fileOpenRequest?.filePath ?? null;
  const fileOpenRequestKey = fileOpenRequest
    ? `${fileOpenRequest.requestId}:${fileOpenRequest.filePath}`
    : "";
  const projectFileTabs = getProjectFileTabs(fileTabs, projectId);
  const selectedFilePath = projectFileTabs.activePath;
  const selectedFileBufferKey =
    projectId && selectedFilePath
      ? getFileBufferKey(projectId, selectedFilePath)
      : null;
  const selectedFileBuffer = selectedFileBufferKey
    ? (fileBuffers[selectedFileBufferKey] ?? null)
    : null;
  const selectedFileMetadata = selectedFileBufferKey
    ? (fileMetadata[selectedFileBufferKey] ?? null)
    : null;
  const selectedFilePreviewMessage =
    projectId && selectedFilePath
      ? (filePreviewMessagesByProject[projectId]?.[selectedFilePath] ?? null)
      : null;
  const dirtyBufferCount = useMemo(
    () =>
      projectId
        ? Object.entries(fileBuffers).filter(
            ([key, buffer]) =>
              key.startsWith(`${projectId}\0`) &&
              buffer.draftContent !== buffer.diskContent,
          ).length
        : 0,
    [fileBuffers, projectId],
  );
  useEffect(
    () => () => {
      if (selectedImagePreviewUrlRef.current) {
        URL.revokeObjectURL(selectedImagePreviewUrlRef.current);
        selectedImagePreviewUrlRef.current = null;
      }
    },
    [],
  );

  const handleOpenProjectPath = useCallback(async () => {
    if (!projectPath) {
      return;
    }

    await getDesktopApi()?.openInEditor({
      editorId: "file-explorer",
      projectPath,
    });
  }, [projectPath]);

  const handleRefreshFiles = useCallback(() => {
    if (!projectId) {
      return;
    }
    useIdeStore.getState().bumpProjectFilesRefreshKey(projectId);
  }, [projectId]);

  const handleWordWrapChange = useCallback(
    (enabled: boolean) => {
      if (!projectId) {
        return;
      }

      useIdeStore.getState().updateProject(projectId, (project) => ({
        ...project,
        ui: {
          ...project.ui,
          fileEditorWordWrap: enabled,
        },
      }));
    },
    [projectId],
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!projectId || !projectPath) {
      return;
    }

    const previousRefreshKey =
      previousProjectFilesRefreshKeyByProjectRef.current[projectId];
    const refreshChanged =
      previousRefreshKey !== undefined &&
      previousRefreshKey !== projectFilesRefreshKey;
    previousProjectFilesRefreshKeyByProjectRef.current[projectId] =
      projectFilesRefreshKey;

    if (refreshChanged) {
      dispatchFileBuffer({ type: "refresh-project", projectId });
      setFilePreviewMessagesByProject((current) => {
        if (!current[projectId]) {
          return current;
        }

        const next = { ...current };
        delete next[projectId];
        return next;
      });
    }
  }, [active, projectFilesRefreshKey, projectId, projectPath]);

  useEffect(() => {
    void fileOpenRequestKey;
    if (!active || !projectId || !fileOpenRequestPath) {
      return;
    }

    dispatchFileTab({ type: "preview", projectId, path: fileOpenRequestPath });
    setFileError(null);
  }, [active, fileOpenRequestKey, fileOpenRequestPath, projectId]);

  useEffect(() => {
    void projectFilesRefreshKey;
    if (!projectId || !projectPath || !selectedFilePath) {
      return;
    }

    if (isImageFile(selectedFilePath)) {
      return;
    }

    const bufferKey = getFileBufferKey(projectId, selectedFilePath);
    if (fileBuffers[bufferKey]) {
      return;
    }

    if (
      filePreviewMessagesByProject[projectId]?.[selectedFilePath] !== undefined
    ) {
      return;
    }

    let cancelled = false;

    const loadSelectedFile = async () => {
      setFileLoading(true);
      setFileError(null);

      try {
        const response = await fetch("/api/project-file", {
          body: JSON.stringify({
            filePath: selectedFilePath,
            projectPath,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        if (isFilePreviewUnavailableStatus(response.status) && !cancelled) {
          const message = await readResponseText(
            response,
            uiT("requestFailedStatus", { status: response.status }),
          );
          setFilePreviewMessagesByProject((current) => ({
            ...current,
            [projectId]: {
              ...(current[projectId] ?? {}),
              [selectedFilePath]: message,
            },
          }));
          return;
        }

        if (!response.ok) {
          throw new Error(
            await readResponseText(
              response,
              uiT("requestFailedStatus", { status: response.status }),
            ),
          );
        }

        const payload = (await response.json()) as ProjectFileReadResponse;
        if (cancelled) {
          return;
        }

        const loadedBufferKey = getFileBufferKey(projectId, payload.filePath);
        dispatchFileBuffer({
          type: "load",
          key: loadedBufferKey,
          content: payload.content,
        });
        setFileMetadata((current) => ({
          ...current,
          [loadedBufferKey]: {
            lineEnding: payload.lineEnding,
            readOnlyReason: payload.readOnlyReason,
            writable: payload.writable,
          },
        }));
      } catch (error) {
        if (!cancelled) {
          setFileError(
            error instanceof Error
              ? error.message
              : panelsT("failedToReadFile"),
          );
        }
      } finally {
        if (!cancelled) {
          setFileLoading(false);
        }
      }
    };

    void loadSelectedFile();

    return () => {
      cancelled = true;
    };
  }, [
    fileBuffers,
    filePreviewMessagesByProject,
    panelsT,
    projectId,
    projectPath,
    projectFilesRefreshKey,
    selectedFilePath,
    uiT,
  ]);

  useEffect(() => {
    if (!projectId || !projectPath || !selectedFilePath) {
      replaceSelectedImagePreviewUrl(null);
      return;
    }

    if (!isImageFile(selectedFilePath)) {
      replaceSelectedImagePreviewUrl(null);
      return;
    }

    let cancelled = false;

    const loadSelectedImage = async () => {
      setFileLoading(true);
      setFileError(null);
      replaceSelectedImagePreviewUrl(null);

      try {
        const response = await fetch(
          getProjectFileRawUrl(projectPath, selectedFilePath),
        );

        if (!response.ok) {
          throw new Error(
            await readResponseText(
              response,
              uiT("requestFailedStatus", { status: response.status }),
            ),
          );
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        replaceSelectedImagePreviewUrl(objectUrl);
      } catch (error) {
        if (!cancelled) {
          setFileError(
            error instanceof Error
              ? error.message
              : panelsT("failedToReadImage"),
          );
        }
      } finally {
        if (!cancelled) {
          setFileLoading(false);
        }
      }
    };

    void loadSelectedImage();

    return () => {
      cancelled = true;
    };
  }, [
    panelsT,
    projectId,
    projectPath,
    replaceSelectedImagePreviewUrl,
    selectedFilePath,
    uiT,
  ]);

  const resetEditorChrome = useCallback(() => {
    setFileError(null);
    setEditorSearchRequest(0);
    setIsEditorSearchOpen(false);
  }, []);

  const handleSelectFile = useCallback(
    (path: string | null) => {
      if (!projectId || !path) {
        return;
      }

      dispatchFileTab({ type: "preview", projectId, path });
      resetEditorChrome();
    },
    [projectId, resetEditorChrome],
  );

  const handlePinFile = useCallback(
    (path: string) => {
      if (!projectId) {
        return;
      }

      dispatchFileTab({ type: "pin", projectId, path });
      resetEditorChrome();
    },
    [projectId, resetEditorChrome],
  );

  const handleActivateTab = useCallback(
    (path: string) => {
      if (!projectId) {
        return;
      }

      dispatchFileTab({ type: "activate", projectId, path });
      resetEditorChrome();
    },
    [projectId, resetEditorChrome],
  );

  const handleCloseTab = useCallback(
    (path: string) => {
      if (!projectId) {
        return;
      }

      dispatchFileTab({ type: "close", projectId, path });
      resetEditorChrome();
    },
    [projectId, resetEditorChrome],
  );

  const handleReorderTabs = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!projectId) {
        return;
      }

      dispatchFileTab({ type: "reorder", projectId, fromIndex, toIndex });
    },
    [projectId],
  );

  const handleSelectedFileMissing = useCallback(
    (path: string) => {
      if (!projectId) {
        return;
      }
      dispatchFileTab({ type: "close", projectId, path });
    },
    [projectId],
  );

  // Editing a preview tab promotes it to a persistent tab so the draft can't
  // be silently swapped out by the next single-click (VS Code behaviour).
  const activeTabIsPreview = projectFileTabs.tabs.some(
    (tab) => tab.path === selectedFilePath && !tab.pinned,
  );
  const activeBufferIsDirty = Boolean(
    selectedFileBuffer &&
      selectedFileBuffer.draftContent !== selectedFileBuffer.diskContent,
  );
  useEffect(() => {
    if (!projectId || !selectedFilePath) {
      return;
    }
    if (activeTabIsPreview && activeBufferIsDirty) {
      dispatchFileTab({ type: "pin", projectId, path: selectedFilePath });
    }
  }, [activeBufferIsDirty, activeTabIsPreview, projectId, selectedFilePath]);

  const fileTabItems = useMemo<StandardTabItem[]>(
    () =>
      projectId
        ? projectFileTabs.tabs.map((tab) => {
            const buffer = fileBuffers[getFileBufferKey(projectId, tab.path)];
            const isDirty = Boolean(
              buffer && buffer.draftContent !== buffer.diskContent,
            );

            return {
              id: tab.path,
              label: tab.path.split("/").pop() ?? tab.path,
              labelClassName: tab.pinned ? undefined : "italic",
              leading: isDirty ? (
                <span
                  className="size-2 shrink-0 rounded-full bg-amber-500"
                  title="Unsaved changes"
                />
              ) : (
                <FileIcon
                  className="shrink-0 text-muted-foreground"
                  size={12}
                />
              ),
            };
          })
        : [],
    [fileBuffers, projectFileTabs.tabs, projectId],
  );

  const handleDiscardChanges = useCallback(() => {
    if (selectedFileBufferKey) {
      dispatchFileBuffer({ type: "discard", key: selectedFileBufferKey });
    }
  }, [selectedFileBufferKey]);

  const handleReloadFromDisk = useCallback(() => {
    if (!selectedFileBufferKey) {
      return;
    }

    dispatchFileBuffer({ type: "invalidate", key: selectedFileBufferKey });
    setFileMetadata((current) => {
      if (!current[selectedFileBufferKey]) {
        return current;
      }
      const next = { ...current };
      delete next[selectedFileBufferKey];
      return next;
    });
    setFileError(null);
  }, [selectedFileBufferKey]);

  const handleSaveEditing = useCallback(async () => {
    if (
      !projectId ||
      !projectPath ||
      !selectedFilePath ||
      !selectedFileBufferKey ||
      !selectedFileBuffer ||
      selectedFileBuffer.status !== "dirty" ||
      !selectedFileMetadata?.writable
    ) {
      return;
    }

    const targetBuffer = selectedFileBuffer;
    const targetBufferKey = selectedFileBufferKey;
    const targetFilePath = selectedFilePath;
    const targetProjectId = projectId;
    dispatchFileBuffer({ type: "save-start", key: targetBufferKey });

    try {
      const response = await fetch("/api/project-file", {
        body: JSON.stringify({
          content: targetBuffer.draftContent,
          expectedContent: targetBuffer.diskContent,
          filePath: targetFilePath,
          projectPath,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });

      if (!response.ok) {
        const error = await readResponseText(
          response,
          uiT("requestFailedStatus", { status: response.status }),
        );
        dispatchFileBuffer({
          type: response.status === 409 ? "save-conflict" : "save-failure",
          key: targetBufferKey,
          error,
        });
        return;
      }

      const payload = (await response.json()) as ProjectFileWriteResponse;
      dispatchFileBuffer({
        type: "save-success",
        key: targetBufferKey,
        content: payload.content,
      });
      useIdeStore.getState().bumpProjectGitRefreshKey(targetProjectId);
    } catch (error) {
      dispatchFileBuffer({
        type: "save-failure",
        key: targetBufferKey,
        error:
          error instanceof Error ? error.message : panelsT("failedToSaveFile"),
      });
    }
  }, [
    panelsT,
    projectId,
    projectPath,
    selectedFileBuffer,
    selectedFileBufferKey,
    selectedFileMetadata?.writable,
    selectedFilePath,
    uiT,
  ]);

  const handleEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveEditing();
      }
    },
    [handleSaveEditing],
  );

  const handleTreeResizeStart = useCallback(() => {
    treeWidthRef.current =
      treePaneRef.current?.getBoundingClientRect().width ??
      FILE_TREE_MIN_WIDTH_PX;
  }, []);

  const handleTreeResize = useCallback((deltaX: number) => {
    const containerWidth =
      splitContainerRef.current?.getBoundingClientRect().width ?? 0;
    const maxWidth = Math.max(
      FILE_TREE_MIN_WIDTH_PX,
      containerWidth * FILE_TREE_MAX_WIDTH_RATIO,
    );
    const nextWidth = Math.min(
      maxWidth,
      Math.max(
        FILE_TREE_MIN_WIDTH_PX,
        (treeWidthRef.current ?? FILE_TREE_MIN_WIDTH_PX) + deltaX,
      ),
    );

    treeWidthRef.current = nextWidth;
    if (treePaneRef.current) {
      treePaneRef.current.style.width = `${nextWidth}px`;
    }
  }, []);

  if (!activeProject) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex min-h-[50px] items-center gap-2 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm font-medium">
          <RightPanelHeaderIconButton icon={Files} onClose={onClosePanel} />
          <span>{commonT("files")}</span>
          <div className="flex-1" />
          {onToggleExpanded ? (
            <button
              aria-label={expanded ? panelsT("collapse") : panelsT("expand")}
              aria-pressed={expanded}
              className="mb-px flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 text-muted-foreground transition-colors hover:bg-surface-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 dark:hover:bg-surface-800 dark:focus-visible:ring-surface-500"
              onClick={onToggleExpanded}
              title={expanded ? panelsT("collapse") : panelsT("expand")}
              type="button"
            >
              {expanded ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 p-3">
          <AppShellPlaceholder message={panelsT("addProjectForFiles")} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid min-h-[50px] grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <RightPanelHeaderIconButton icon={Files} onClose={onClosePanel} />
          <div className="truncate text-sm font-medium">{commonT("files")}</div>
          {dirtyBufferCount > 0 ? (
            <span
              className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 text-[10px] dark:text-amber-300"
              title={`${dirtyBufferCount} file${dirtyBufferCount === 1 ? "" : "s"} with unsaved changes`}
            >
              {dirtyBufferCount} unsaved
            </span>
          ) : null}
        </div>
        <button
          className="min-w-0 max-w-full justify-self-center truncate rounded px-2 py-1 text-center text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 dark:focus-visible:ring-surface-500"
          onClick={handleOpenProjectPath}
          title={commonT("open")}
          type="button"
        >
          {activeProject.path}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={panelsT("fileActions")}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground"
                  title={panelsT("fileActions")}
                  type="button"
                />
              }
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleRefreshFiles}>
                <RotateCw className="size-4" />
                {commonT("refresh")}
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={wordWrapEnabled}
                onCheckedChange={handleWordWrapChange}
              >
                <TextWrap className="size-4" />
                {panelsT("enableWordWrap")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onToggleExpanded ? (
            <button
              aria-label={expanded ? panelsT("collapse") : panelsT("expand")}
              aria-pressed={expanded}
              className="mb-px flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 text-muted-foreground transition-colors hover:bg-surface-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 dark:hover:bg-surface-800 dark:focus-visible:ring-surface-500"
              onClick={onToggleExpanded}
              title={expanded ? panelsT("collapse") : panelsT("expand")}
              type="button"
            >
              {expanded ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div ref={splitContainerRef} className="flex min-h-0 flex-1">
        {/* File tree */}
        <div
          ref={treePaneRef}
          className="shrink-0 overflow-hidden"
          style={{
            width: `${treeWidthRef.current ?? FILE_TREE_MIN_WIDTH_PX}px`,
            minWidth: FILE_TREE_MIN_WIDTH_PX,
            maxWidth: `${FILE_TREE_MAX_WIDTH_RATIO * 100}%`,
          }}
        >
          <div className="h-full border-r border-surface-200 dark:border-surface-800 bg-background">
            <ProjectFileTree
              active={active}
              onPinFile={handlePinFile}
              onSelectedFileMissing={handleSelectedFileMissing}
              onSelectFile={handleSelectFile}
              projectPath={activeProject.path}
              refreshVersion={projectFilesRefreshKey}
              selectedFilePath={selectedFilePath}
            />
          </div>
        </div>

        <PanelResizeHandle
          side="right"
          onResize={handleTreeResize}
          onResizeStart={handleTreeResizeStart}
        />

        {/* File content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {fileTabItems.length > 0 ? (
            <div className="flex shrink-0 items-center border-b border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 px-2 py-1">
              <StandardTabs
                activeId={selectedFilePath}
                ariaLabel={panelsT("openFiles")}
                canClose={true}
                className="flex-1"
                items={fileTabItems}
                onActivate={handleActivateTab}
                onClose={handleCloseTab}
                onReorder={handleReorderTabs}
              />
              {selectedFilePath &&
              selectedFileBuffer &&
              selectedFileBufferKey &&
              !isImageFile(selectedFilePath) ? (
                <div className="ml-2 flex shrink-0 items-center gap-1">
                  {selectedFileBuffer.status === "dirty" ||
                  selectedFileBuffer.status === "conflict" ? (
                    <Button
                      onClick={handleDiscardChanges}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      Discard changes
                    </Button>
                  ) : null}
                  <Button
                    aria-label={uiT("searchCurrentFile")}
                    aria-pressed={isEditorSearchOpen}
                    className={
                      isEditorSearchOpen
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground"
                    }
                    onClick={() =>
                      setEditorSearchRequest((current) => current + 1)
                    }
                    size="icon-xs"
                    title={uiT("searchCurrentFile")}
                    type="button"
                    variant="ghost"
                  >
                    <Search className="size-3.5" />
                  </Button>
                  <CodeBlockCopyButton text={selectedFileBuffer.draftContent} />
                  <Button
                    aria-label={commonT("save")}
                    className={
                      selectedFileBuffer.draftContent !==
                      selectedFileBuffer.diskContent
                        ? undefined
                        : "text-muted-foreground"
                    }
                    disabled={
                      selectedFileBuffer.status !== "dirty" ||
                      !selectedFileMetadata?.writable
                    }
                    onClick={() => void handleSaveEditing()}
                    size="icon-xs"
                    title={commonT("save")}
                    type="button"
                    variant={
                      selectedFileBuffer.draftContent !==
                      selectedFileBuffer.diskContent
                        ? "accent-subtle"
                        : "ghost"
                    }
                  >
                    {selectedFileBuffer.status === "saving" ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            {!selectedFilePath ? (
              <div className="h-full p-3">
                <AppShellPlaceholder message={panelsT("selectFileToOpen")} />
              </div>
            ) : selectedFilePreviewMessage ? (
              <div className="h-full p-3">
                <AppShellPlaceholder message={selectedFilePreviewMessage} />
              </div>
            ) : fileError ? (
              <div className="p-3">
                <div className="rounded-md border border-destructive-border bg-destructive-surface-muted px-3 py-2 text-destructive text-sm">
                  {fileError}
                </div>
              </div>
            ) : fileLoading &&
              (isImageFile(selectedFilePath)
                ? !selectedImagePreviewUrl
                : !selectedFileBuffer) ? (
              <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-4" />
              </div>
            ) : isImageFile(selectedFilePath) ? (
              selectedImagePreviewUrl ? (
                <div className="flex h-full items-center justify-center p-6">
                  <img
                    alt={selectedFilePath}
                    className="max-h-full max-w-full object-contain"
                    src={selectedImagePreviewUrl}
                  />
                </div>
              ) : null
            ) : selectedFileBuffer && selectedFileBufferKey ? (
              <CodeBlockContainer
                className="flex h-full max-h-full flex-col overflow-hidden rounded-none border-0 shadow-none"
                language={inferLanguage(selectedFilePath)}
                onKeyDownCapture={handleEditorKeyDown}
                style={{ contentVisibility: "visible" }}
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  {selectedFileMetadata?.readOnlyReason ? (
                    <div className="shrink-0 border-amber-500/30 border-b bg-amber-500/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-200">
                      {selectedFileMetadata.readOnlyReason}
                    </div>
                  ) : null}
                  {selectedFileBuffer.error ? (
                    <div className="flex shrink-0 items-center justify-between gap-3 border-destructive-border border-b bg-destructive-surface-muted px-3 py-2 text-destructive text-xs">
                      <div>
                        <div>{selectedFileBuffer.error}</div>
                        {selectedFileBuffer.status === "conflict" ? (
                          <div className="mt-1 font-medium">
                            Reloading from disk will replace your local draft.
                          </div>
                        ) : null}
                      </div>
                      {selectedFileBuffer.status === "conflict" ? (
                        <Button
                          className="shrink-0"
                          onClick={handleReloadFromDisk}
                          size="xs"
                          type="button"
                          variant="outline"
                        >
                          Reload from disk
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="min-h-0 flex-1">
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center">
                          <Spinner className="size-4 text-muted-foreground" />
                        </div>
                      }
                    >
                      <FileCodeEditor
                        disabled={
                          selectedFileBuffer.status === "saving" ||
                          !selectedFileMetadata?.writable
                        }
                        filePath={selectedFilePath}
                        key={selectedFileBufferKey}
                        lineEnding={
                          selectedFileMetadata?.lineEnding ??
                          (selectedFileBuffer.diskContent.includes("\r\n")
                            ? "crlf"
                            : "lf")
                        }
                        onChange={(content) =>
                          dispatchFileBuffer({
                            type: "edit",
                            key: selectedFileBufferKey,
                            content,
                          })
                        }
                        onSearchOpenChange={setIsEditorSearchOpen}
                        searchRequest={editorSearchRequest}
                        value={selectedFileBuffer.draftContent}
                        wordWrap={wordWrapEnabled}
                      />
                    </Suspense>
                  </div>
                </div>
              </CodeBlockContainer>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export const FileExplorerPanel = memo(FileExplorerPanelImpl);
FileExplorerPanel.displayName = "FileExplorerPanel";
