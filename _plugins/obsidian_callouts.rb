# Obsidian Callout Syntax Support for Jekyll
# Transforms > [!type] Title blocks into styled HTML divs
# Supports: note, warning, tip, info, danger, bug, example, quote, abstract, todo, success, question, failure
#
# Obsidian syntax:
#   > [!note] Optional Title
#   > Content here
#   > More content
#
# Foldable callouts:
#   > [!note]- Collapsed by default
#   > [!note]+ Expanded by default

module Jekyll
  class ObsidianCallouts < Jekyll::Generator
    safe true
    priority :low

    CALLOUT_REGEX = /
      <blockquote>\s*
        <p>\[!([\w-]+)\]([+-])?\s*(.*?)<\/p>\s*
        (.*?)
      <\/blockquote>
    /xm

    CALLOUT_ICONS = {
      'note'     => '📝',
      'info'     => 'ℹ️',
      'tip'      => '💡',
      'hint'     => '💡',
      'important'=> '🔥',
      'warning'  => '⚠️',
      'caution'  => '⚠️',
      'danger'   => '🔴',
      'error'    => '🔴',
      'bug'      => '🐛',
      'example'  => '📋',
      'quote'    => '💬',
      'cite'     => '💬',
      'abstract' => '📄',
      'summary'  => '📄',
      'tldr'     => '📄',
      'todo'     => '☑️',
      'success'  => '✅',
      'check'    => '✅',
      'done'     => '✅',
      'question' => '❓',
      'help'     => '❓',
      'faq'      => '❓',
      'failure'  => '❌',
      'fail'     => '❌',
      'missing'  => '❌',
    }

    def generate(site)
      site.posts.docs.each { |doc| process_callouts(doc) }
      site.pages.each { |page| process_callouts(page) }
    end

    private

    def process_callouts(doc)
      return unless doc.output

      doc.output = doc.output.gsub(CALLOUT_REGEX) do
        type = $1.downcase
        fold = $2  # + or - or nil
        title = $3.strip
        body = $4.strip

        icon = CALLOUT_ICONS[type] || '📝'
        css_type = type.gsub(/[^a-z0-9-]/, '')
        display_title = title.empty? ? type.capitalize : title

        if fold
          # Foldable callout using <details>
          open_attr = fold == '+' ? ' open' : ''
          <<~HTML
            <details class="callout callout-#{css_type}"#{open_attr}>
              <summary class="callout-title"><span class="callout-icon">#{icon}</span> #{display_title}</summary>
              <div class="callout-content">#{body}</div>
            </details>
          HTML
        else
          <<~HTML
            <div class="callout callout-#{css_type}">
              <div class="callout-title"><span class="callout-icon">#{icon}</span> #{display_title}</div>
              <div class="callout-content">#{body}</div>
            </div>
          HTML
        end
      end
    end
  end
end
