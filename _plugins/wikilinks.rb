# Preprocesses Obsidian markdown before kramdown rendering:
# 1. Converts [[wikilinks]] to standard markdown links
# 2. Escapes | inside inline math $...$ to prevent table parsing
#
# Runs as a :pre_render hook so it modifies raw markdown before rendering.

require 'uri'

module Jekyll
  class WikilinksConverter
    def initialize(site)
      @site = site
      @doc_lookup = nil
    end

    def build_lookup
      return @doc_lookup if @doc_lookup

      @doc_lookup = {}
      all_docs = @site.posts.docs + @site.pages.select { |p| p.ext == '.md' }

      all_docs.each do |doc|
        slug = File.basename(doc.path, '.*')
        title = doc.data['title'] || slug
        perm = doc.data['permalink']
        url = doc.url

        @doc_lookup[slug] = { 'url' => url, 'title' => title }
        @doc_lookup[slug.downcase] = { 'url' => url, 'title' => title }

        if title && !title.empty?
          @doc_lookup[title] = { 'url' => url, 'title' => title }
          @doc_lookup[title.downcase] = { 'url' => url, 'title' => title }
        end

        if perm
          clean = perm.sub(/^\//, '').chomp('/')
          @doc_lookup[clean] = { 'url' => url, 'title' => title }
        end
      end

      @doc_lookup
    end

    def convert(content)
      lookup = build_lookup

      # Step 1: Protect math blocks from kramdown table parsing.
      # Replace | inside inline $...$ and display $$...$$ with HTML entity.
      # Process display math ($$...$$) first, then inline ($...$).
      placeholders = []

      # Protect fenced code blocks first (don't touch anything inside ```)
      content = content.gsub(/^```.*?^```/m) do |block|
        idx = placeholders.length
        placeholders << block
        "\x00CODEBLOCK#{idx}\x00"
      end

      # Protect display math $$...$$
      content = content.gsub(/\$\$(.*?)\$\$/m) do |match|
        inner = $1
        idx = placeholders.length
        placeholders << "$$#{inner}$$"
        "\x00MATHBLOCK#{idx}\x00"
      end

      # Protect inline math $...$  (not greedy, single line)
      content = content.gsub(/\$([^\$\n]+?)\$/) do |match|
        inner = $1
        idx = placeholders.length
        placeholders << "$#{inner}$"
        "\x00MATHINLINE#{idx}\x00"
      end

      # Step 2: Convert [[wikilinks]] to standard markdown links
      content = content.gsub(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/) do |match|
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

      # Step 3: Restore placeholders
      content = content.gsub(/\x00(?:CODEBLOCK|MATHBLOCK|MATHINLINE)(\d+)\x00/) do
        placeholders[$1.to_i]
      end

      content
    end
  end
end

Jekyll::Hooks.register [:documents, :pages], :pre_render do |doc|
  site = doc.site
  site.data['_wikilinks_converter'] ||= Jekyll::WikilinksConverter.new(site)
  converter = site.data['_wikilinks_converter']
  doc.content = converter.convert(doc.content) if doc.content
end
