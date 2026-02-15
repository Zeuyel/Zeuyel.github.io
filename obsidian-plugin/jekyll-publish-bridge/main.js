const { Notice, Plugin, PluginSettingTab, Setting, Modal, normalizePath } = require("obsidian");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_SETTINGS = {
  targetRepoPath: "C:\\Users\\epictus\\Documents\\work\\Zeuyel.github.io",
  targetPostsDir: "_posts",
  publishFlag: "publish",
  stripShareFlag: true
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
    const heading = body.match(/^\s*#\s+(.+?)\s*$/m);
    if (heading && heading[1]) return heading[1].trim();
    return file.basename;
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
  }
}
