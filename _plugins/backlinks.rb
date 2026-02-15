# All-in-one plugin: wikilinks + backlinks + graph data.
#
# Uses :after_init to build doc lookup, Generator for backlinks/graph,
# and :pre_render for wikilink conversion.

require 'json'

module Jekyll
  class BacklinksGenerator < Generator
    safe true
    priority :low

    def generate(site)
      all_docs = site.posts.docs + site.pages.select { |p| p.ext == '.md' }

      Jekyll.logger.info "Backlinks:", "Processing #{all_docs.size} documents"

      # Build doc lookup by various keys
      doc_lookup = {}
      all_docs.each do |doc|
        slug = File.basename(doc.path, '.*')
        title = doc.data['title'] || slug
        perm = doc.data['permalink']
        url = doc.url

        [url, url.chomp('/')].each { |k| doc_lookup[k] = doc }
        [slug, slug.downcase].each { |k| doc_lookup[k] = doc }
        [title, title.downcase].each { |k| doc_lookup[k] = doc } if title && !title.empty?
        if perm
          [perm, perm.chomp('/'), perm.sub(%r{^/}, ''), perm.sub(%r{^/}, '').chomp('/')].each { |k| doc_lookup[k] = doc }
        end
      end

      # Extract links from raw markdown files
      forward = {}
      all_docs.each do |doc|
        raw = read_raw(doc, site)
        forward[doc] = find_targets(raw, doc, doc_lookup)
      end

      # Build backlinks
      backlinks = Hash.new { |h, k| h[k] = [] }
      forward.each do |src, targets|
        targets.each do |tgt|
          backlinks[tgt] << src unless backlinks[tgt].include?(src)
        end
      end

      # Build graph data
      nodes = []
      links_arr = []
      id_map = {}

      all_docs.each_with_index do |doc, i|
        id_map[doc] = i
        lc = (forward[doc] || []).size + backlinks[doc].size
        nodes << { 'id' => i, 'name' => (doc.data['title'] || File.basename(doc.path, '.*')), 'url' => doc.url, 'val' => [lc, 1].max }
      end

      forward.each do |src, targets|
        targets.each do |tgt|
          links_arr << { 'source' => id_map[src], 'target' => id_map[tgt] } if id_map[src] && id_map[tgt]
        end
      end

      graph = { 'nodes' => nodes, 'links' => links_arr }

      Jekyll.logger.info "Backlinks:", "#{links_arr.size} links found"

      # Inject data into every document
      all_docs.each do |doc|
        doc.data['backlinks'] = backlinks[doc].map { |d| { 'title' => (d.data['title'] || File.basename(d.path, '.*')), 'url' => d.url } }
        doc.data['graph_data'] = graph
      end

      # Store wikilink lookup for pre_render hook (use @@class var, not site.data)
      @@wikilink_lookup = {}
      doc_lookup.each do |key, doc|
        @@wikilink_lookup[key] = { 'url' => doc.url, 'title' => (doc.data['title'] || File.basename(doc.path, '.*')) }
      end
    end

    def self.wikilink_lookup
      @@wikilink_lookup ||= {}
    end

    private

    def read_raw(doc, site)
      # doc.path in Jekyll can be relative or absolute
      paths_to_try = [doc.path]
      paths_to_try << File.join(site.source, doc.path) unless doc.path.start_with?('/')
      paths_to_try << File.join(site.source, doc.relative_path) if doc.respond_to?(:relative_path)

      paths_to_try.each do |p|
        next unless File.file?(p)
        content = File.read(p, encoding: 'utf-8')
        return content.sub(/\A---.*?---\s*/m, '')
      end

      Jekyll.logger.warn "Backlinks:", "Could not read file for: #{doc.url} (tried #{paths_to_try.join(', ')})"
      ''
    end

    def find_targets(raw, doc, doc_lookup)
      targets = []

      # [[wikilinks]]
      raw.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/) do
        key = $1.strip
        t = doc_lookup[key] || doc_lookup[key.downcase]
        targets << t if t && t != doc
      end

      # Standard [text](url) links
      raw.scan(/\[[^\]]*\]\(([^)]+)\)/) do
        href = $1
        next if href.start_with?('http', '#', 'mailto:')
        t = doc_lookup[href] || doc_lookup[href.chomp('/')]
        targets << t if t && t != doc
      end

      targets.uniq
    end
  end
end

# ── Pre-render hooks ──

def obsidian_preprocess(doc)
  return unless doc.content
  lookup = Jekyll::BacklinksGenerator.wikilink_lookup
  return if lookup.empty?

  content = doc.content
  placeholders = []

  # Protect fenced code blocks
  content = content.gsub(/^```.*?^```/m) { |b| placeholders << b; "\x00PH#{placeholders.size - 1}\x00" }

  # Protect display math $$...$$
  content = content.gsub(/\$\$.*?\$\$/m) { |b| placeholders << b; "\x00PH#{placeholders.size - 1}\x00" }

  # Protect inline math $...$
  content = content.gsub(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/) { |b| placeholders << b; "\x00PH#{placeholders.size - 1}\x00" }

  # Convert [[target|display]] to [display](url)
  content = content.gsub(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/) do
    key = $1.strip
    display = $2 ? $2.strip : nil
    info = lookup[key] || lookup[key.downcase]
    if info
      "[#{display || info['title'] || key}](#{info['url']})"
    else
      display || key
    end
  end

  # Restore
  content = content.gsub(/\x00PH(\d+)\x00/) { placeholders[$1.to_i] }
  doc.content = content
end

Jekyll::Hooks.register :documents, :pre_render do |doc|
  obsidian_preprocess(doc)
end

Jekyll::Hooks.register :pages, :pre_render do |page|
  obsidian_preprocess(page)
end
