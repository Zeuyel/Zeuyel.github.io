---
layout: page
title: "Tags"
permalink: /tags/
---

<div class="tags-page">
  <div class="tags-page-toolbar">
    <input id="tag-filter-input" type="search" placeholder="Filter tags (e.g. math, 考研, tool_idea)">
    <p id="tag-filter-summary" class="tags-page-summary"></p>
  </div>

  {% assign sorted_tags = site.tags | sort %}
  {% if sorted_tags and sorted_tags.size > 0 %}
  <div class="tags-cloud">
    {% for tag_item in sorted_tags %}
    {% assign tag_name = tag_item[0] %}
    {% assign tag_posts = tag_item[1] %}
    <a class="tag-chip tag-cloud-item" href="{{ '/tags/' | relative_url }}?q={{ tag_name | url_encode }}" data-tag="{{ tag_name | downcase | escape }}">
      <span class="tag-cloud-name">#{{ tag_name }}</span>
      <span class="tag-cloud-count">{{ tag_posts | size }}</span>
    </a>
    {% endfor %}
  </div>

  <div class="tag-groups" id="tag-groups">
    {% for tag_item in sorted_tags %}
    {% assign tag_name = tag_item[0] %}
    {% assign tag_posts = tag_item[1] %}
    {% assign tag_posts_sorted = tag_posts | sort: "date" | reverse %}
    <section class="tag-group" data-tag="{{ tag_name | downcase | escape }}">
      <h2 class="tag-group-title">
        <span>#{{ tag_name }}</span>
        <span class="tag-group-count">{{ tag_posts | size }}</span>
      </h2>
      <ul class="tag-post-list">
        {% for tagged_post in tag_posts_sorted %}
        <li>
          <a href="{{ tagged_post.url | relative_url }}">{{ tagged_post.title }}</a>
          <time datetime="{{ tagged_post.date | date_to_xmlschema }}">{{ tagged_post.date | date: "%Y-%m-%d" }}</time>
        </li>
        {% endfor %}
      </ul>
    </section>
    {% endfor %}
  </div>
  {% else %}
  <p>No tags yet.</p>
  {% endif %}
</div>

<script>
(function() {
  var page = document.querySelector('.tags-page');
  if (!page) return;

  var input = document.getElementById('tag-filter-input');
  var summary = document.getElementById('tag-filter-summary');
  var groups = Array.prototype.slice.call(page.querySelectorAll('.tag-group'));
  var chips = Array.prototype.slice.call(page.querySelectorAll('.tag-cloud-item'));

  function normalize(value) {
    return (value || '').trim().toLowerCase();
  }

  function setQuery(q) {
    var params = new URLSearchParams(window.location.search);
    if (q) {
      params.set('q', q);
    } else {
      params.delete('q');
    }
    var query = params.toString();
    var next = window.location.pathname + (query ? ('?' + query) : '');
    window.history.replaceState({}, '', next);
  }

  function renderFilter(rawTerm) {
    var term = normalize(rawTerm);
    var visible = 0;

    groups.forEach(function(group) {
      var tag = normalize(group.getAttribute('data-tag'));
      var show = !term || tag.indexOf(term) !== -1;
      group.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });

    chips.forEach(function(chip) {
      var tag = normalize(chip.getAttribute('data-tag'));
      chip.classList.toggle('is-active', !!term && tag === term);
      chip.classList.toggle('is-dimmed', !!term && tag.indexOf(term) === -1);
    });

    if (summary) {
      if (!groups.length) {
        summary.textContent = 'No tags yet.';
      } else if (!term) {
        summary.textContent = groups.length + ' tags total.';
      } else {
        summary.textContent = visible + ' tags matched "' + term + '".';
      }
    }
  }

  var initial = normalize(new URLSearchParams(window.location.search).get('q'));
  if (input && initial) input.value = initial;
  renderFilter(initial);

  if (input) {
    input.addEventListener('input', function() {
      var term = normalize(input.value);
      setQuery(term);
      renderFilter(term);
    });
  }
})();
</script>
