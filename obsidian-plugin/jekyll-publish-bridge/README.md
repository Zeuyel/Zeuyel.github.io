# Jekyll Publish Bridge

Obsidian desktop plugin with visual workflow:

1. Mark notes with frontmatter flag (default: `publish: true`)
2. Use panel/buttons inside Obsidian to publish selected notes into your Jekyll repo `_posts`
3. Optional: sync + prune + git push directly from the plugin

## UI Entry Points

- Left ribbon icon: `Open Jekyll Publish Panel`
- Status bar button: click to open publish panel
- File right-click menu:
  - `Mark/Unmark for Jekyll publish`
  - `Publish this note to Jekyll`
- Plugin settings button: `Open`

## Commands (Optional)

- `Open publish panel`
- `Toggle publish flag for current note`
- `Publish all marked notes`
- `Sync marked notes (publish + prune unmarked exports)`
- `Sync marked notes and git push`
- `Publish current note now`
- `Git push blog repo`
- `Delete current note export from blog repo`

## Install into your vault

Copy this folder into your vault plugin directory:

- Source: `obsidian-plugin/jekyll-publish-bridge`
- Target: `C:\Users\epictus\Documents\work\考研\数学\.obsidian\plugins\jekyll-publish-bridge`

Then in Obsidian:

1. `Settings -> Community plugins`
2. Enable `Jekyll Publish Bridge`
3. Open plugin settings and set blog repo path to `C:\Users\epictus\Documents\work\Zeuyel.github.io`

## Export behavior

- Keeps your note filename without date prefix in vault
- No `share` marker required
- Ensures exported note has minimum Jekyll frontmatter:
  - `title`
  - `date`
  - `permalink`
  - `layout: post`
  - `graph: true`
  - `obsidian_source`
- Optional cleanup behavior:
  - `Sync marked` in panel will publish current marked notes and remove exported files whose source note is no longer marked.
  - `Publish all marked notes` can also prune unmarked exports when setting `Prune unmarked on Publish marked` is enabled.
- Edit sync behavior:
  - If an already published note is edited, running `Publish` / `Publish marked` / `Sync marked` will overwrite the existing exported file matched by `obsidian_source`.
  - If frontmatter `title` is missing, exported `title` defaults to the Obsidian note filename (not first H1), to keep URL/title identity stable.
- Git behavior:
  - Plugin can run `git add -A -- <targetPostsDir>`, `git commit`, and `git push`.
  - Configure `Enable git push in plugin`, `Git remote`, and `Git branch` in settings.
