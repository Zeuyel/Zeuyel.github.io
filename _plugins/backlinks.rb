# All-in-one plugin: wikilinks + backlinks + graph data.
#
# Uses :after_init to build doc lookup, Generator for backlinks/graph,
# and :pre_render for wikilink conversion.

require 'json'

module Jekyll
  class BacklinksGenerator < Generator
    safe true
    priority :low
    MARKDOWN_EXTENSIONS = %w[.md .markdown .mkdown .mkdn .mkd].freeze

    def generate(site)
      all_docs = collect_markdown_docs(site)

      Jekyll.logger.info "Backlinks:", "Processing #{all_docs.size} documents"

      # Build doc lookup by various keys
      doc_lookup = {}
      all_docs.each do |doc|
        slug = File.basename(doc.path, '.*')
        stripped_slug = stripped_post_slug(doc, slug)
        title = doc.data['title'] || slug
        perm = doc.data['permalink']
        url = doc.url
        source_path = doc.data['obsidian_source']

        [url, url.chomp('/')].each { |k| doc_lookup[k] = doc }
        [slug, slug.downcase].each { |k| doc_lookup[k] = doc }
        if stripped_slug && stripped_slug != slug
          [stripped_slug, stripped_slug.downcase].each { |k| doc_lookup[k] = doc }
        end
        [title, title.downcase].each { |k| doc_lookup[k] = doc } if title && !title.empty?
        if perm
          [perm, perm.chomp('/'), perm.sub(%r{^/}, ''), perm.sub(%r{^/}, '').chomp('/')].each { |k| doc_lookup[k] = doc }
        end
        if source_path
          source_key = source_path.to_s.gsub('\\', '/').sub(/\.[^\/\.]+$/, '')
          source_slug = File.basename(source_key)
          [source_key, source_key.downcase, source_slug, source_slug.downcase].each { |k| doc_lookup[k] = doc if k && !k.empty? }
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
      graph_docs = all_docs.select { |doc| graph_document?(doc) }

      graph_docs.each_with_index do |doc, i|
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

    def collect_markdown_docs(site)
      docs = []
      docs.concat(site.pages)
      site.collections.each_value { |collection| docs.concat(collection.docs) }

      docs.uniq.select do |doc|
        path = if doc.respond_to?(:relative_path) && doc.relative_path
                 doc.relative_path
               else
                 doc.path
               end
        MARKDOWN_EXTENSIONS.include?(File.extname(path.to_s).downcase)
      end
    end

    def graph_document?(doc)
      return false if doc.data['graph'] == false
      return true if doc.respond_to?(:collection) && doc.collection && doc.collection.label == 'posts'
      doc.data['graph'] == true
    end

    def stripped_post_slug(doc, slug)
      return slug unless doc.respond_to?(:collection) && doc.collection && doc.collection.label == 'posts'
      m = slug.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
      m ? m[1] : slug
    end

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
      text = strip_protected_content(raw)

      # [[wikilinks]]
      text.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/) do
        key = $1.strip
        t = doc_lookup[key] || doc_lookup[key.downcase]
        targets << t if t && t != doc
      end

      # Standard [text](url) links
      text.scan(/\[[^\]]*\]\(([^)]+)\)/) do
        href = $1
        next if href.start_with?('http', '#', 'mailto:')
        t = doc_lookup[href] || doc_lookup[href.chomp('/')]
        targets << t if t && t != doc
      end

      targets.uniq
    end

    def strip_protected_content(raw)
      content = raw.dup
      content = content.gsub(/^```.*?^```[ \t]*\n?/m, "\n")
      content = content.gsub(/^~~~.*?^~~~[ \t]*\n?/m, "\n")
      content = content.gsub(/\$\$.*?\$\$/m, '')
      content = content.gsub(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/, '')
      content = content.gsub(/`[^`\n]+`/, '')
      content
    end
  end
end

# ── Pre-render hooks ──

def obsidian_preprocess(doc)
  return unless doc.content
  lookup = Jekyll::BacklinksGenerator.wikilink_lookup

  content = doc.content
  code_placeholders = []
  math_placeholders = {}
  math_index = 0

  next_math_token = lambda do
    token = "@@OB_MATH_#{math_index}@@"
    math_index += 1
    token
  end

  # Protect fenced code blocks
  content = content.gsub(/^```.*?^```/m) { |b| code_placeholders << b; "\x00CPH#{code_placeholders.size - 1}\x00" }
  content = content.gsub(/^~~~.*?^~~~/m) { |b| code_placeholders << b; "\x00CPH#{code_placeholders.size - 1}\x00" }

  # Protect inline code `...`
  content = content.gsub(/`[^`\n]+`/) { |b| code_placeholders << b; "\x00CPH#{code_placeholders.size - 1}\x00" }

  # Protect display math and inline math with persistent placeholders.
  # They will be restored after markdown conversion to avoid accidental table parsing on "|...|" math.
  content = content.gsub(/\$\$.*?\$\$/m) do |b|
    token = next_math_token.call
    math_placeholders[token] = b
    token
  end
  content = content.gsub(/\\\[(?:.|\n)*?\\\]/m) do |b|
    token = next_math_token.call
    math_placeholders[token] = b
    token
  end

  content = content.gsub(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/) do |b|
    token = next_math_token.call
    math_placeholders[token] = b
    token
  end
  content = content.gsub(/\\\((?:.|\n)*?\\\)/m) do |b|
    token = next_math_token.call
    math_placeholders[token] = b
    token
  end

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

  # Restore code placeholders before markdown conversion.
  content = content.gsub(/\x00CPH(\d+)\x00/) { code_placeholders[$1.to_i] }

  # Keep math placeholders until :post_convert (store map in doc data).
  doc.data['__obsidian_math_placeholders'] = math_placeholders unless math_placeholders.empty?
  doc.content = content
end

def obsidian_restore_math(doc)
  return unless doc.output
  placeholders = doc.data.delete('__obsidian_math_placeholders')
  return unless placeholders && !placeholders.empty?

  output = doc.output
  placeholders.each do |token, math|
    output = output.gsub(token, math)
  end
  doc.output = output
end

Jekyll::Hooks.register :documents, :pre_render, priority: :highest do |doc|
  obsidian_preprocess(doc)
end

Jekyll::Hooks.register :pages, :pre_render, priority: :highest do |page|
  obsidian_preprocess(page)
end

Jekyll::Hooks.register :documents, :post_convert, priority: :lowest do |doc|
  obsidian_restore_math(doc)
end

Jekyll::Hooks.register :pages, :post_convert, priority: :lowest do |page|
  obsidian_restore_math(page)
end
