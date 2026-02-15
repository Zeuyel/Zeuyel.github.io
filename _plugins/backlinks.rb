# Generates backlinks data and graph JSON for each page/post.
# Scans all markdown content for [[wikilinks]] and standard markdown links,
# builds a bidirectional link map, and injects backlinks into each document.
# Also writes assets/js/graph-data.json for the interactive graph view.

module Jekyll
  class BacklinksGenerator < Generator
    safe true
    priority :lowest  # run after all other generators

    def generate(site)
      all_docs = site.posts.docs + site.pages.select { |p| p.ext == '.md' }

      # Build forward links map: source_url => [target_url, ...]
      forward = {}
      all_docs.each do |doc|
        url = doc.url
        forward[url] = extract_links(doc, all_docs)
      end

      # Build backlinks map: target_url => [source docs]
      backlinks = {}
      all_docs.each do |doc|
        backlinks[doc.url] = []
      end

      forward.each do |source_url, targets|
        targets.each do |target_url|
          source_doc = all_docs.find { |d| d.url == source_url }
          if backlinks.key?(target_url) && source_doc
            backlinks[target_url] << source_doc unless backlinks[target_url].include?(source_doc)
          end
        end
      end

      # Inject backlinks data into each document
      all_docs.each do |doc|
        doc.data['backlinks'] = (backlinks[doc.url] || []).map do |d|
          { 'title' => d.data['title'] || File.basename(d.path, '.*'), 'url' => d.url }
        end
      end

      # Generate graph data JSON
      nodes = []
      links = []
      url_to_id = {}

      all_docs.each_with_index do |doc, i|
        url_to_id[doc.url] = i
        link_count = (forward[doc.url] || []).length + (backlinks[doc.url] || []).length
        nodes << {
          id: i,
          name: doc.data['title'] || File.basename(doc.path, '.*'),
          url: doc.url,
          val: [link_count, 1].max
        }
      end

      forward.each do |source_url, targets|
        source_id = url_to_id[source_url]
        next unless source_id
        targets.each do |target_url|
          target_id = url_to_id[target_url]
          next unless target_id
          links << { source: source_id, target: target_id }
        end
      end

      graph_json = JSON.generate({ nodes: nodes, links: links })

      # Write graph data file
      dir = File.join(site.source, 'assets', 'js')
      FileUtils.mkdir_p(dir)
      File.write(File.join(dir, 'graph-data.json'), graph_json)

      # Add to static files so Jekyll copies it
      site.static_files << Jekyll::StaticFile.new(site, site.source, 'assets/js', 'graph-data.json')
    end

    private

    def extract_links(doc, all_docs)
      content = doc.content || ''
      links = []

      # Match [[wikilinks]] — with optional display text [[target|display]]
      content.scan(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/).each do |match|
        target_name = match[0].strip.downcase
        target_doc = all_docs.find do |d|
          name = d.data['title']&.downcase || File.basename(d.path, '.*').downcase
          slug = File.basename(d.path, '.*').downcase
          name == target_name || slug == target_name || slug.end_with?(target_name)
        end
        links << target_doc.url if target_doc
      end

      # Match standard markdown links [text](url)
      content.scan(/\[([^\]]*)\]\(([^)]+)\)/).each do |_text, href|
        next if href.start_with?('http', '#', 'mailto:')
        target_doc = all_docs.find { |d| d.url == href || d.url == href.chomp('/') + '/' }
        links << target_doc.url if target_doc
      end

      links.uniq
    end
  end
end
