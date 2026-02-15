# All-in-one plugin: wikilinks conversion, backlinks, and graph data.
#
# Phase 1 (Generator): Read raw files, extract [[wikilinks]], build
#   backlinks and graph data, inject into doc.data.
# Phase 2 (:pre_render hook): Convert [[wikilinks]] to markdown links
#   and protect math expressions from kramdown table parsing.

require 'json'
require 'uri'

module Jekyll
  class BacklinksGenerator < Generator
    safe true
    priority :low

    def generate(site)
      all_docs = site.posts.docs + site.pages.select { |p| p.ext == '.md' }

      # Build doc lookup by various keys
      doc_lookup = {}
      all_docs.each do |doc|
        slug = File.basename(doc.path, '.*')
        title = doc.data['title'] || slug
        perm = doc.data['permalink']
        url = doc.url

        doc_lookup[url] = doc
        doc_lookup[url.chomp('/')] = doc

        begin
          decoded = URI.decode_www_form_component(url)
          doc_lookup[decoded] = doc
          doc_lookup[decoded.chomp('/')] = doc
        rescue
        end

        doc_lookup[slug] = doc
        doc_lookup[slug.downcase] = doc

        if title && !title.empty?
          doc_lookup[title] = doc
          doc_lookup[title.downcase] = doc
        end

        if perm
          doc_lookup[perm] = doc
          doc_lookup[perm.chomp('/')] = doc
          clean = perm.sub(/^\//, '').chomp('/')
          doc_lookup[clean] = doc
        end
      end

      # Store lookup in site.data for the :pre_render hook
      site.data['_doc_lookup_for_wikilinks'] = {}
      doc_lookup.each do |key, doc|
        site.data['_doc_lookup_for_wikilinks'][key] = {
          'url' => doc.url,
          'title' => doc.data['title'] || File.basename(doc.path, '.*')
        }
      end

      # Extract links from raw files
      forward = {}
      all_docs.each do |doc|
        forward[doc] = extract_links(doc, doc_lookup, site)
      end

      # Build backlinks
      backlinks = {}
      all_docs.each { |doc| backlinks[doc] = [] }
      forward.each do |src, targets|
        targets.each do |tgt|
          backlinks[tgt] << src unless backlinks[tgt].include?(src)
        end
      end

      # Build graph data
      doc_to_id = {}
      nodes = []
      all_docs.each_with_index do |doc, i|
        doc_to_id[doc] = i
        lc = (forward[doc] || []).length + (backlinks[doc] || []).length
        nodes << {
          'id' => i,
          'name' => doc.data['title'] || File.basename(doc.path, '.*'),
          'url' => doc.url,
          'val' => [lc, 1].max
        }
      end

      links_arr = []
      forward.each do |src, targets|
        sid = doc_to_id[src]
        next unless sid
        targets.each do |tgt|
          tid = doc_to_id[tgt]
          next unless tid
          links_arr << { 'source' => sid, 'target' => tid }
        end
      end

      graph = { 'nodes' => nodes, 'links' => links_arr }

      # Inject into every doc
      all_docs.each do |doc|
        doc.data['backlinks'] = (backlinks[doc] || []).map do |d|
          { 'title' => d.data['title'] || File.basename(d.path, '.*'), 'url' => d.url }
        end
        doc.data['graph_data'] = graph
      end

      Jekyll.logger.info "Backlinks:", "#{all_docs.size} docs, #{links_arr.size} links"
    end

    private

    def extract_links(doc, doc_lookup, site)
      # Try multiple path strategies to find the raw file
      candidates = [
        doc.path,
        File.join(site.source, doc.path),
        doc.respond_to?(:site) ? File.join(doc.site.source, doc.relative_path) : nil
      ].compact

      raw = nil
      candidates.each do |p|
        if File.exist?(p)
          raw = File.read(p, encoding: 'utf-8')
          break
        end
      end

      unless raw
        Jekyll.logger.warn "Backlinks:", "File not found for #{doc.path} (tried: #{candidates.join(', ')})"
        return []
      end

      raw = raw.sub(/\A---.*?---\s*/m, '')
      targets = []

      raw.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/).each do |match|
        key = match[0].strip
        t = doc_lookup[key] || doc_lookup[key.downcase] || doc_lookup[File.basename(key).downcase]
        targets << t if t && t != doc
      end

      raw.scan(/\[([^\]]*)\]\(([^)]+)\)/).each do |_text, href|
        next if href.start_with?('http', '#', 'mailto:')
        t = doc_lookup[href] || doc_lookup[href.chomp('/')]
        targets << t if t && t != doc
      end

      targets.uniq
    end
  end
end

# ── Pre-render hook: convert [[wikilinks]] and protect math ──

Jekyll::Hooks.register :documents, :pre_render do |doc|
  next unless doc.content
  lookup = doc.site.data['_doc_lookup_for_wikilinks'] || {}
  doc.content = convert_wikilinks(doc.content, lookup)
end

Jekyll::Hooks.register :pages, :pre_render do |page|
  next unless page.content
  lookup = page.site.data['_doc_lookup_for_wikilinks'] || {}
  page.content = convert_wikilinks(page.content, lookup)
end

def convert_wikilinks(content, lookup)
  placeholders = []

  # Protect fenced code blocks
  content = content.gsub(/^```.*?^```/m) do |block|
    i = placeholders.length; placeholders << block; "\x00PH#{i}\x00"
  end

  # Protect display math $$...$$
  content = content.gsub(/\$\$(.*?)\$\$/m) do
    i = placeholders.length; placeholders << $~[0]; "\x00PH#{i}\x00"
  end

  # Protect inline math $...$
  content = content.gsub(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/) do
    i = placeholders.length; placeholders << $~[0]; "\x00PH#{i}\x00"
  end

  # Convert [[target|display]] and [[target]] to markdown links
  content = content.gsub(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/) do
    target_key = $1.strip
    display = $2 ? $2.strip : nil
    info = lookup[target_key] || lookup[target_key.downcase]
    if info
      label = display || info['title'] || target_key
      "[#{label}](#{info['url']})"
    else
      display || target_key
    end
  end

  # Restore placeholders
  content = content.gsub(/\x00PH(\d+)\x00/) { placeholders[$1.to_i] }
  content
end
