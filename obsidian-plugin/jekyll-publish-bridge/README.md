# Jekyll Publish Bridge

Obsidian desktop plugin with visual workflow:

1. Mark notes with frontmatter flag (default: `publish: true`)
2. Use panel/buttons inside Obsidian to publish selected notes into your Jekyll repo `_posts`
3. Push blog repo to trigger CI deploy

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
- `Publish current note now`

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
