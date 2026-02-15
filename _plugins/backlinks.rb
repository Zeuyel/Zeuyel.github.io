# Generates backlinks data and graph data for each page/post.
# Scans raw file content for [[wikilinks]] and standard markdown links,
# builds a bidirectional link map, and injects backlinks + graph data
# directly into each document's data (no separate JSON file needed).

require 'json'
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
        doc_lookup[doc.url] = doc
        doc_lookup[doc.url.chomp('/')] = doc

        decoded_url = URI.decode_www_form_component(doc.url) rescue doc.url
        doc_lookup[decoded_url] = doc
        doc_lookup[decoded_url.chomp('/')] = doc

        slug = File.basename(doc.path, '.*')
        doc_lookup[slug] = doc
        doc_lookup[slug.downcase] = doc

        title = doc.data['title']
        if title && !title.empty?
          doc_lookup[title] = doc
          doc_lookup[title.downcase] = doc
        end

        perm = doc.data['permalink']
        if perm
          doc_lookup[perm] = doc
          doc_lookup[perm.chomp('/')] = doc
          doc_lookup[perm.sub(/^\//, '')] = doc
          doc_lookup[perm.sub(/^\//, '').chomp('/')] = doc
        end
      end

      # Build forward links map: doc => [target_doc, ...]
      forward = {}
      all_docs.each do |doc|
        forward[doc] = extract_links(doc, doc_lookup, site)
      end

      # Build backlinks map: doc => [source_doc, ...]
      backlinks = {}
      all_docs.each { |doc| backlinks[doc] = [] }

      forward.each do |source_doc, targets|
        targets.each do |target_doc|
          backlinks[target_doc] << source_doc unless backlinks[target_doc].include?(source_doc)
        end
      end

      # Build graph data structures
      doc_to_id = {}
      nodes = []
      all_docs.each_with_index do |doc, i|
        doc_to_id[doc] = i
        link_count = (forward[doc] || []).length + (backlinks[doc] || []).length
        nodes << {
          'id' => i,
          'name' => doc.data['title'] || File.basename(doc.path, '.*'),
          'url' => doc.url,
          'val' => [link_count, 1].max
        }
      end

      links_arr = []
      forward.each do |source_doc, targets|
        source_id = doc_to_id[source_doc]
        next unless source_id
        targets.each do |target_doc|
          target_id = doc_to_id[target_doc]
          next unless target_id
          links_arr << { 'source' => source_id, 'target' => target_id }
        end
      end

      graph_data = { 'nodes' => nodes, 'links' => links_arr }

      # Inject backlinks and graph data into each document
      all_docs.each do |doc|
        doc.data['backlinks'] = (backlinks[doc] || []).map do |d|
          { 'title' => d.data['title'] || File.basename(d.path, '.*'), 'url' => d.url }
        end
        # Embed full graph data into every doc so the template can inline it
        doc.data['graph_data'] = graph_data
      end
    end

    private

    def extract_links(doc, doc_lookup, site)
      full_path = if File.absolute_path?(doc.path)
                    doc.path
                  else
                    File.join(site.source, doc.path)
                  end

      raw = File.read(full_path, encoding: 'utf-8') rescue ''
      raw = raw.sub(/\A---.*?---\s*/m, '')

      targets = []

      raw.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/).each do |match|
        target_key = match[0].strip
        target_doc = doc_lookup[target_key] ||
                     doc_lookup[target_key.downcase] ||
                     doc_lookup[File.basename(target_key).downcase]
        targets << target_doc if target_doc && target_doc != doc
      end

      raw.scan(/\[([^\]]*)\]\(([^)]+)\)/).each do |_text, href|
        next if href.start_with?('http', '#', 'mailto:')
        target_doc = doc_lookup[href] || doc_lookup[href.chomp('/')]
        targets << target_doc if target_doc && target_doc != doc
      end

      targets.uniq
    end
  end
end
