const { Notice, Plugin, PluginSettingTab, Setting, Modal, normalizePath } = require("obsidian");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const DEFAULT_SETTINGS = {
  targetRepoPath: "C:\\Users\\epictus\\Documents\\work\\Zeuyel.github.io",
  targetPostsDir: "_posts",
  publishFlag: "publish",
  stripShareFlag: true,
  pruneUnmarkedOnPublishMarked: true,
  gitEnabled: true,
  gitRemote: "origin",
  gitBranch: "master",
  gitAutoPushOnSync: false
};

module.exports = class JekyllPublishBridgePlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerUiEntrypoints();
    this.registerCommands();
    this.addSettingTab(new JekyllPublishBridgeSettingTab(this.app, this));
    this.updateStatusBar();
  }

  onunload() {
    if (this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
  }

  registerUiEntrypoints() {
    this.ribbonIconEl = this.addRibbonIcon("send", "Open Jekyll Publish Panel", () => {
      this.openPublishPanel();
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("jpb-status-bar");
    this.statusBarEl.setAttribute("role", "button");
    this.statusBarEl.addEventListener("click", () => this.openPublishPanel());

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!file || file.extension !== "md") return;
        const marked = this.getPublishState(file);

        menu.addItem((item) =>
          item
            .setTitle(marked ? "Unmark from Jekyll publish" : "Mark for Jekyll publish")
            .setIcon(marked ? "toggle-right" : "toggle-left")
            .onClick(async () => {
              await this.setPublishFlag(file, !marked, { showNotice: true });
              this.updateStatusBar();
            })
        );

        menu.addItem((item) =>
          item
            .setTitle("Publish this note to Jekyll")
            .setIcon("send")
            .onClick(async () => {
              await this.publishFiles([file], { mode: "single" });
              this.updateStatusBar();
            })
        );
      })
    );

    this.registerEvent(this.app.workspace.on("file-open", () => this.updateStatusBar()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateStatusBar()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.updateStatusBar()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.updateStatusBar()));
  }

  registerCommands() {
    this.addCommand({
      id: "open-publish-panel",
      name: "Open publish panel",
      callback: () => this.openPublishPanel()
    });

    this.addCommand({
      id: "toggle-publish-flag",
      name: "Toggle publish flag for current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          this.togglePublishFlag(file).catch((err) => {
            console.error("[jekyll-publish-bridge] toggle publish flag failed", err);
            new Notice("Toggle publish flag failed, check console.");
          });
        }
        return true;
      }
    });

    this.addCommand({
      id: "publish-marked-notes",
      name: "Publish all marked notes",
      callback: () => this.publishMarkedNotes()
    });

    this.addCommand({
      id: "sync-marked-notes",
      name: "Sync marked notes (publish + prune unmarked exports)",
      callback: () => this.syncMarkedNotes()
    });

    this.addCommand({
      id: "sync-marked-notes-and-push",
      name: "Sync marked notes and git push",
      callback: () => this.syncMarkedNotesAndPush()
    });

    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note now",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          this.publishOne(file).catch((err) => {
            console.error("[jekyll-publish-bridge] publish current note failed", err);
            new Notice("Publish current note failed, check console.");
          });
        }
        return true;
      }
    });

    this.addCommand({
      id: "git-push-blog-repo",
      name: "Git push blog repo",
      callback: () => this.gitCommitAndPush("manual push from Obsidian")
    });

    this.addCommand({
      id: "delete-current-note-export",
      name: "Delete current note export from blog repo",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) {
          this.deleteExportForNote(file).catch((err) => {
            console.error("[jekyll-publish-bridge] delete current note export failed", err);
            new Notice("Delete export failed, check console.");
          });
        }
        return true;
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getPublishKey() {
    return (this.settings.publishFlag || DEFAULT_SETTINGS.publishFlag || "publish").trim() || "publish";
  }

  openPublishPanel() {
    new PublishPanelModal(this.app, this).open();
  }

  updateStatusBar() {
    if (!this.statusBarEl) return;
    const markedCount = this.getMarkedFiles().length;
    const active = this.app.workspace.getActiveFile();
    if (!active || active.extension !== "md") {
      this.statusBarEl.setText(`Publish: ${markedCount} marked`);
      return;
    }
    const activeMarked = this.getPublishState(active);
    this.statusBarEl.setText(`Publish: ${activeMarked ? "marked" : "unmarked"} | ${markedCount} marked`);
  }

  parseBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const clean = value.trim().toLowerCase();
      return clean === "true" || clean === "yes" || clean === "1" || clean === "on";
    }
    if (typeof value === "number") return value !== 0;
    return false;
  }

  splitFrontMatter(rawContent) {
    const match = rawContent.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
    if (!match) {
      return {
        frontMatter: "",
        body: rawContent.replace(/^\uFEFF/, "")
      };
    }
    return {
      frontMatter: match[1].trimEnd(),
      body: rawContent.slice(match[0].length)
    };
  }

  readFrontMatterValue(frontMatter, key) {
    if (!frontMatter) return null;
    const pattern = new RegExp("^\\s*" + this.escapeRegex(key) + "\\s*:\\s*(.+?)\\s*$", "im");
    const match = frontMatter.match(pattern);
    if (!match) return null;
    return this.stripYamlQuotes(match[1].trim());
  }

  stripYamlQuotes(value) {
    if (value == null) return null;
    let clean = String(value).trim();
    clean = clean.replace(/\s+#.*$/, "").trim();
    if (clean.length >= 2) {
      const first = clean[0];
      const last = clean[clean.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        clean = clean.slice(1, -1);
      }
    }
    return clean;
  }

  quoteYamlValue(value) {
    const safe = String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${safe}"`;
  }

  ensureFrontMatterField(frontMatter, key, value) {
    const content = (frontMatter || "").trimEnd();
    const pattern = new RegExp("^\\s*" + this.escapeRegex(key) + "\\s*:", "im");
    if (pattern.test(content)) return content;
    if (!content) return `${key}: ${value}`;
    return `${content}\n${key}: ${value}`;
  }

  removeFrontMatterField(frontMatter, key) {
    if (!frontMatter) return "";
    const pattern = new RegExp("^\\s*" + this.escapeRegex(key) + "\\s*:.*(?:\\r?\\n)?", "gim");
    return frontMatter.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  normalizeDate(value, fallbackUnixMs) {
    if (value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return this.formatDate(parsed);
      }
    }
    return this.formatDate(new Date(fallbackUnixMs));
  }

  formatDate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  extractTitle(rawTitle, body, file) {
    if (rawTitle && rawTitle.trim()) return rawTitle.trim();
    // Default to note filename to match Obsidian note identity.
    if (file && file.basename) return file.basename;
    const heading = body.match(/^\s*#\s+(.+?)\s*$/m);
    if (heading && heading[1]) return heading[1].trim();
    return "Untitled";
  }

  buildDefaultPermalink(filePath) {
    const withoutExt = normalizePath(filePath).replace(/\.[^/.]+$/, "");
    return `/${withoutExt}/`;
  }

  buildSlug(filePath) {
    const withoutExt = normalizePath(filePath).replace(/\.[^/.]+$/, "");
    let slug = withoutExt
      .replace(/[\\/]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[<>:"/\\|?*#%[\]{}]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) slug = "note";
    return slug;
  }

  escapeRegex(input) {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async togglePublishFlag(file) {
    const current = this.getPublishState(file);
    await this.setPublishFlag(file, !current, { showNotice: true });
    this.updateStatusBar();
  }

  getPublishState(file) {
    const publishKey = this.getPublishKey();
    const cache = this.app.metadataCache.getFileCache(file);
    const frontMatter = cache && cache.frontmatter ? cache.frontmatter : {};
    return this.parseBoolean(frontMatter[publishKey]);
  }

  async setPublishFlag(file, value, options = {}) {
    const publishKey = this.getPublishKey();
    await this.app.fileManager.processFrontMatter(file, (frontMatter) => {
      frontMatter[publishKey] = Boolean(value);
    });
    if (options.showNotice) {
      new Notice(`${file.basename}: ${publishKey} = ${String(Boolean(value))}`);
    }
  }

  getMarkedFiles() {
    return this.app.vault.getMarkdownFiles().filter((file) => this.getPublishState(file));
  }

  async publishMarkedNotes() {
    const publishKey = this.getPublishKey();
    const markedFiles = this.getMarkedFiles();

    if (!markedFiles.length) {
      new Notice(`No notes marked with ${publishKey}: true`);
      return;
    }

    return this.publishFiles(markedFiles, { mode: "marked" });
  }

  async syncMarkedNotes() {
    const markedFiles = this.getMarkedFiles();
    const publishResult = markedFiles.length
      ? await this.publishFiles(markedFiles, { mode: "marked" })
      : { success: 0, failure: 0 };

    const pruneResult = await this.pruneUnmarkedExports();
    this.updateStatusBar();
    new Notice(
      `Sync done: published ${publishResult.success}, failed ${publishResult.failure}, pruned ${pruneResult.deleted}.`
    );
    return { publishResult, pruneResult };
  }

  async syncMarkedNotesAndPush() {
    const syncResult = await this.syncMarkedNotes();
    if (this.settings.gitEnabled) {
      const pushResult = await this.gitCommitAndPush("sync marked notes from Obsidian");
      return { syncResult, pushResult };
    }
    return { syncResult, pushResult: { pushed: false, reason: "git disabled" } };
  }

  async publishFiles(files, options = {}) {
    const mode = options.mode || "manual";
    let success = 0;
    let failure = 0;

    if (this.statusBarEl) {
      this.statusBarEl.setText("Publish: running...");
    }

    for (const file of files) {
      try {
        await this.publishOne(file);
        success += 1;
      } catch (err) {
        failure += 1;
        console.error("[jekyll-publish-bridge] publish failed:", file.path, err);
      }
    }

    this.updateStatusBar();

    if (failure > 0) {
      new Notice(`Published ${success} notes, ${failure} failed. Check console for details.`);
      return { success, failure };
    }

    if (mode === "single" && files.length === 1) {
      new Notice(`Published: ${files[0].basename}`);
      return { success, failure };
    }

    new Notice(`Published ${success} notes to Jekyll.`);
    if (mode === "marked" && this.settings.pruneUnmarkedOnPublishMarked) {
      const pruneResult = await this.pruneUnmarkedExports();
      if (pruneResult.deleted > 0) {
        new Notice(`Pruned ${pruneResult.deleted} unmarked exported notes.`);
      }
    }
    if (mode === "marked" && this.settings.gitEnabled && this.settings.gitAutoPushOnSync) {
      await this.gitCommitAndPush("publish marked notes from Obsidian");
    }
    return { success, failure };
  }

  async publishOne(file) {
    const targetRepoPath = this.settings.targetRepoPath.trim();
    const targetPostsDir = this.settings.targetPostsDir.trim();
    if (!targetRepoPath || !targetPostsDir) {
      throw new Error("targetRepoPath or targetPostsDir is empty.");
    }

    const targetDir = path.join(targetRepoPath, targetPostsDir);
    await fs.mkdir(targetDir, { recursive: true });

    const raw = await this.app.vault.cachedRead(file);
    const parsed = this.splitFrontMatter(raw);
    let frontMatter = parsed.frontMatter;
    const body = parsed.body.replace(/^\s*\r?\n/, "");

    const title = this.extractTitle(this.readFrontMatterValue(frontMatter, "title"), body, file);
    const frontDate = this.readFrontMatterValue(frontMatter, "date");
    const date = this.normalizeDate(frontDate, file.stat.ctime);
    const permalink = this.readFrontMatterValue(frontMatter, "permalink") || this.buildDefaultPermalink(file.path);
    const layout = this.readFrontMatterValue(frontMatter, "layout") || "post";
    const sourcePath = normalizePath(file.path);

    const publishKey = this.getPublishKey();
    frontMatter = this.removeFrontMatterField(frontMatter, publishKey);
    if (this.settings.stripShareFlag) {
      frontMatter = this.removeFrontMatterField(frontMatter, "share");
    }

    frontMatter = this.ensureFrontMatterField(frontMatter, "title", this.quoteYamlValue(title));
    frontMatter = this.ensureFrontMatterField(frontMatter, "date", date);
    frontMatter = this.ensureFrontMatterField(frontMatter, "permalink", this.quoteYamlValue(permalink));
    frontMatter = this.ensureFrontMatterField(frontMatter, "layout", layout);
    frontMatter = this.ensureFrontMatterField(frontMatter, "graph", "true");
    frontMatter = this.ensureFrontMatterField(frontMatter, "obsidian_source", this.quoteYamlValue(sourcePath));

    let outputPath = await this.findExistingTargetBySource(targetDir, sourcePath);
    if (!outputPath) {
      const slug = this.buildSlug(file.path);
      outputPath = path.join(targetDir, `${date}-${slug}.md`);
    }

    const output = `---\n${frontMatter.trim()}\n---\n\n${body.trimEnd()}\n`;
    await fs.writeFile(outputPath, output, "utf8");
  }

  async findExistingTargetBySource(targetDir, sourcePath) {
    const files = await this.walkMarkdownFiles(targetDir);
    if (!files.length) return null;

    const escapedSource = this.escapeRegex(sourcePath);
    const pattern = new RegExp("^\\s*obsidian_source\\s*:\\s*[\"']?" + escapedSource + "[\"']?\\s*$", "im");

    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = this.splitFrontMatter(raw);
        if (pattern.test(parsed.frontMatter || "")) {
          return filePath;
        }
      } catch (err) {
        console.error("[jekyll-publish-bridge] read existing post failed:", filePath, err);
      }
    }
    return null;
  }

  async walkMarkdownFiles(dirPath) {
    let results = [];
    let entries = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      return [];
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.walkMarkdownFiles(fullPath);
        results = results.concat(nested);
        continue;
      }

      if (entry.isFile() && /\.md$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  getMarkedSourcePathSet() {
    const markedFiles = this.getMarkedFiles();
    return new Set(markedFiles.map((f) => normalizePath(f.path)));
  }

  async pruneUnmarkedExports() {
    const targetRepoPath = this.settings.targetRepoPath.trim();
    const targetPostsDir = this.settings.targetPostsDir.trim();
    const targetDir = path.join(targetRepoPath, targetPostsDir);

    const files = await this.walkMarkdownFiles(targetDir);
    if (!files.length) return { scanned: 0, deleted: 0 };

    const markedSources = this.getMarkedSourcePathSet();
    let deleted = 0;

    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = this.splitFrontMatter(raw);
        const source = this.readFrontMatterValue(parsed.frontMatter || "", "obsidian_source");
        if (!source) continue;
        const normalizedSource = normalizePath(source);
        if (markedSources.has(normalizedSource)) continue;
        await fs.unlink(filePath);
        deleted += 1;
      } catch (err) {
        console.error("[jekyll-publish-bridge] prune unmarked export failed:", filePath, err);
      }
    }

    return { scanned: files.length, deleted };
  }

  async findExportPathForSource(sourcePath) {
    const targetRepoPath = this.settings.targetRepoPath.trim();
    const targetPostsDir = this.settings.targetPostsDir.trim();
    const targetDir = path.join(targetRepoPath, targetPostsDir);
    const normalized = normalizePath(sourcePath);
    return this.findExistingTargetBySource(targetDir, normalized);
  }

  async deleteExportForNote(file, options = {}) {
    const sourcePath = normalizePath(file.path);
    const exportPath = await this.findExportPathForSource(sourcePath);
    if (!exportPath) {
      if (!options.silent) {
        new Notice(`No exported post found for: ${file.basename}`);
      }
      return { deleted: false, path: null };
    }

    await fs.unlink(exportPath);
    if (!options.silent) {
      new Notice(`Deleted export: ${path.basename(exportPath)}`);
    }

    if (this.settings.gitEnabled && options.pushAfterDelete) {
      await this.gitCommitAndPush(`delete exported note: ${file.basename}`);
    }
    return { deleted: true, path: exportPath };
  }

  async runGit(args) {
    const cwd = this.settings.targetRepoPath.trim();
    if (!cwd) throw new Error("targetRepoPath is empty.");
    return execFileAsync("git", args, { cwd, windowsHide: true });
  }

  async gitCommitAndPush(reason = "sync from Obsidian") {
    if (!this.settings.gitEnabled) {
      return { pushed: false, reason: "git disabled" };
    }

    const targetPostsDir = this.settings.targetPostsDir.trim() || "_posts";
    const remote = (this.settings.gitRemote || "origin").trim() || "origin";
    const branch = (this.settings.gitBranch || "master").trim() || "master";

    await this.runGit(["add", "-A", "--", targetPostsDir]);

    let committed = false;
    const msg = `chore(publish): ${reason}`;
    try {
      await this.runGit(["commit", "-m", msg]);
      committed = true;
    } catch (err) {
      const stderr = String((err && err.stderr) || "");
      const stdout = String((err && err.stdout) || "");
      const merged = `${stdout}\n${stderr}`.toLowerCase();
      if (!merged.includes("nothing to commit")) {
        throw err;
      }
    }

    await this.runGit(["push", remote, branch]);
    new Notice(committed ? `Git pushed to ${remote}/${branch}.` : `No content change, pushed to ${remote}/${branch}.`);
    return { pushed: true, committed, remote, branch };
  }
};

class PublishPanelModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.searchTerm = "";
    this.listEl = null;
    this.summaryEl = null;
    this.searchInputEl = null;
  }

  async onOpen() {
    await this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jpb-modal");

    const header = contentEl.createDiv({ cls: "jpb-header" });
    header.createEl("h2", { text: "Jekyll Publish Panel" });
    header.createEl("p", {
      text: `Toggle frontmatter "${this.plugin.getPublishKey()}" and publish directly to your blog repo.`,
      cls: "jpb-subtitle"
    });

    const toolbar = contentEl.createDiv({ cls: "jpb-toolbar" });
    this.searchInputEl = toolbar.createEl("input", {
      type: "search",
      placeholder: "Search notes by name or path"
    });
    this.searchInputEl.value = this.searchTerm;
    this.searchInputEl.addEventListener("input", async () => {
      this.searchTerm = this.searchInputEl.value.trim();
      await this.renderList();
    });

    const refreshBtn = toolbar.createEl("button", { text: "Refresh" });
    refreshBtn.addEventListener("click", async () => this.renderList());

    const publishMarkedBtn = toolbar.createEl("button", { text: "Publish marked" });
    publishMarkedBtn.addEventListener("click", async () => {
      await this.plugin.publishMarkedNotes();
      await this.renderList();
    });

    const syncMarkedBtn = toolbar.createEl("button", { text: "Sync marked" });
    syncMarkedBtn.addEventListener("click", async () => {
      await this.plugin.syncMarkedNotes();
      await this.renderList();
    });

    const syncPushBtn = toolbar.createEl("button", { text: "Sync + Push" });
    syncPushBtn.addEventListener("click", async () => {
      await this.plugin.syncMarkedNotesAndPush();
      await this.renderList();
    });

    this.summaryEl = contentEl.createDiv({ cls: "jpb-summary" });
    this.listEl = contentEl.createDiv({ cls: "jpb-list" });

    await this.renderList();
  }

  async renderList() {
    if (!this.listEl || !this.summaryEl) return;

    const term = this.searchTerm.toLowerCase();
    const files = this.plugin.app.vault
      .getMarkdownFiles()
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));

    const visible = files.filter((file) => {
      if (!term) return true;
      return file.path.toLowerCase().includes(term) || file.basename.toLowerCase().includes(term);
    });

    const markedVisible = visible.filter((file) => this.plugin.getPublishState(file)).length;
    this.summaryEl.setText(`${visible.length} notes shown, ${markedVisible} marked for publish.`);

    this.listEl.empty();
    if (!visible.length) {
      this.listEl.createEl("p", { text: "No notes matched.", cls: "jpb-empty" });
      return;
    }

    for (const file of visible) {
      const row = this.listEl.createDiv({ cls: "jpb-row" });

      const markCol = row.createDiv({ cls: "jpb-col-mark" });
      const markToggle = markCol.createEl("input", { type: "checkbox" });
      markToggle.checked = this.plugin.getPublishState(file);
      markToggle.title = `Set ${this.plugin.getPublishKey()} in frontmatter`;

      const metaCol = row.createDiv({ cls: "jpb-col-meta" });
      metaCol.createDiv({ text: file.basename, cls: "jpb-title" });
      metaCol.createDiv({ text: file.path, cls: "jpb-path" });

      const actionCol = row.createDiv({ cls: "jpb-col-actions" });
      const openBtn = actionCol.createEl("button", { text: "Open" });
      const publishBtn = actionCol.createEl("button", { text: "Publish" });
      const deleteBtn = actionCol.createEl("button", { text: "Delete export" });

      markToggle.addEventListener("change", async () => {
        await this.plugin.setPublishFlag(file, markToggle.checked, { showNotice: false });
        row.toggleClass("is-marked", markToggle.checked);
        this.plugin.updateStatusBar();
        const marked = visible.filter((f) => this.plugin.getPublishState(f)).length;
        this.summaryEl.setText(`${visible.length} notes shown, ${marked} marked for publish.`);
      });

      openBtn.addEventListener("click", async () => {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
      });

      publishBtn.addEventListener("click", async () => {
        await this.plugin.publishFiles([file], { mode: "single" });
      });

      deleteBtn.addEventListener("click", async () => {
        await this.plugin.deleteExportForNote(file);
      });

      row.toggleClass("is-marked", markToggle.checked);
    }
  }
}

class JekyllPublishBridgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Open publish panel")
      .setDesc("Open the visual panel to mark and publish notes.")
      .addButton((button) =>
        button.setButtonText("Open").onClick(() => {
          this.plugin.openPublishPanel();
        })
      );

    new Setting(containerEl)
      .setName("Target blog repo path")
      .setDesc("Absolute path of your Jekyll repo.")
      .addText((text) =>
        text
          .setPlaceholder("C:\\Users\\...\\Zeuyel.github.io")
          .setValue(this.plugin.settings.targetRepoPath)
          .onChange(async (value) => {
            this.plugin.settings.targetRepoPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Target posts directory")
      .setDesc("Directory inside blog repo where exported markdown will be written.")
      .addText((text) =>
        text
          .setPlaceholder("_posts")
          .setValue(this.plugin.settings.targetPostsDir)
          .onChange(async (value) => {
            this.plugin.settings.targetPostsDir = value.trim() || "_posts";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Publish flag key")
      .setDesc("Frontmatter key used to select notes for publishing, e.g. publish.")
      .addText((text) =>
        text
          .setPlaceholder("publish")
          .setValue(this.plugin.settings.publishFlag)
          .onChange(async (value) => {
            this.plugin.settings.publishFlag = value.trim() || "publish";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Strip share field on export")
      .setDesc("Remove share: ... from exported notes.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.stripShareFlag))
          .onChange(async (value) => {
            this.plugin.settings.stripShareFlag = Boolean(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Prune unmarked on Publish marked")
      .setDesc("When publishing marked notes, delete exported notes whose source note is no longer marked.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.pruneUnmarkedOnPublishMarked))
          .onChange(async (value) => {
            this.plugin.settings.pruneUnmarkedOnPublishMarked = Boolean(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable git push in plugin")
      .setDesc("Allow plugin to run git add/commit/push in target blog repo.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.gitEnabled))
          .onChange(async (value) => {
            this.plugin.settings.gitEnabled = Boolean(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Git remote")
      .setDesc("Remote name used for push.")
      .addText((text) =>
        text
          .setPlaceholder("origin")
          .setValue(this.plugin.settings.gitRemote || "origin")
          .onChange(async (value) => {
            this.plugin.settings.gitRemote = value.trim() || "origin";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Git branch")
      .setDesc("Branch name used for push.")
      .addText((text) =>
        text
          .setPlaceholder("master")
          .setValue(this.plugin.settings.gitBranch || "master")
          .onChange(async (value) => {
            this.plugin.settings.gitBranch = value.trim() || "master";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto push on Publish marked")
      .setDesc("After Publish marked, automatically git push target posts directory.")
      .addToggle((toggle) =>
        toggle
          .setValue(Boolean(this.plugin.settings.gitAutoPushOnSync))
          .onChange(async (value) => {
            this.plugin.settings.gitAutoPushOnSync = Boolean(value);
            await this.plugin.saveSettings();
          })
      );
  }
}
