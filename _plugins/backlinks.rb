# Generates backlinks data and graph JSON for each page/post.
# Scans raw markdown for [[wikilinks]] and standard markdown links,
# builds a bidirectional link map, and injects backlinks into each document.
# Also writes assets/js/graph-data.json for the interactive graph view.

require 'json'
require 'fileutils'
require 'uri'

module Jekyll
  class BacklinksGenerator < Generator
    safe true
    priority :low

    def generate(site)
      all_docs = site.posts.docs + site.pages.select { |p| p.ext == '.md' }

      # Build a lookup: various keys => doc
      doc_lookup = {}
      all_docs.each do |doc|
        # By URL (may be URI-encoded for non-ASCII)
        doc_lookup[doc.url] = doc
        doc_lookup[doc.url.chomp('/')] = doc

        # Also store decoded URL for matching
        decoded_url = URI.decode_www_form_component(doc.url) rescue doc.url
        doc_lookup[decoded_url] = doc
        doc_lookup[decoded_url.chomp('/')] = doc

        # By filename slug (e.g. "2026-02-13-game-theory")
        slug = File.basename(doc.path, '.*')
        doc_lookup[slug] = doc
        doc_lookup[slug.downcase] = doc

        # By title
        title = doc.data['title']
        if title && !title.empty?
          doc_lookup[title] = doc
          doc_lookup[title.downcase] = doc
        end

        # By permalink
        perm = doc.data['permalink']
        if perm
          doc_lookup[perm] = doc
          doc_lookup[perm.chomp('/')] = doc
          # Also without leading slash
          doc_lookup[perm.sub(/^\//, '')] = doc
          doc_lookup[perm.sub(/^\//, '').chomp('/')] = doc
        end
      end

      # Build forward links map: doc => [target_doc, ...]
      forward = {}
      all_docs.each do |doc|
        forward[doc] = extract_links(doc, doc_lookup)
      end

      # Build backlinks map: doc => [source_doc, ...]
      backlinks = {}
      all_docs.each { |doc| backlinks[doc] = [] }

      forward.each do |source_doc, targets|
        targets.each do |target_doc|
          backlinks[target_doc] << source_doc unless backlinks[target_doc].include?(source_doc)
        end
      end

      # Inject backlinks data into each document
      all_docs.each do |doc|
        doc.data['backlinks'] = (backlinks[doc] || []).map do |d|
          { 'title' => d.data['title'] || File.basename(d.path, '.*'), 'url' => d.url }
        end
      end

      # Generate graph data JSON
      nodes = []
      links = []
      doc_to_id = {}

      all_docs.each_with_index do |doc, i|
        doc_to_id[doc] = i
        link_count = (forward[doc] || []).length + (backlinks[doc] || []).length
        nodes << {
          id: i,
          name: doc.data['title'] || File.basename(doc.path, '.*'),
          url: doc.url,
          val: [link_count, 1].max
        }
      end

      forward.each do |source_doc, targets|
        source_id = doc_to_id[source_doc]
        next unless source_id
        targets.each do |target_doc|
          target_id = doc_to_id[target_doc]
          next unless target_id
          links << { source: source_id, target: target_id }
        end
      end

      graph_json = JSON.generate({ nodes: nodes, links: links })

      dir = File.join(site.source, 'assets', 'js')
      FileUtils.mkdir_p(dir)
      File.write(File.join(dir, 'graph-data.json'), graph_json)

      # Ensure Jekyll copies the file
      site.static_files << Jekyll::StaticFile.new(site, site.source, 'assets/js', 'graph-data.json')
    end

    private

    def extract_links(doc, doc_lookup)
      content = doc.content || ''
      targets = []

      # Match [[wikilinks]] — [[target]] or [[target|display]]
      content.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/).each do |match|
        target_key = match[0].strip
        # Try lookup by exact key, then downcase, then just the last part after /
        target_doc = doc_lookup[target_key] ||
                     doc_lookup[target_key.downcase] ||
                     doc_lookup[File.basename(target_key).downcase]
        targets << target_doc if target_doc && target_doc != doc
      end

      # Match standard markdown links [text](/url)
      content.scan(/\[([^\]]*)\]\(([^)]+)\)/).each do |_text, href|
        next if href.start_with?('http', '#', 'mailto:')
        target_doc = doc_lookup[href] || doc_lookup[href.chomp('/')]
        targets << target_doc if target_doc && target_doc != doc
      end

      targets.uniq
    end
  end
end
