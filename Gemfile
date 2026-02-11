source "https://rubygems.org"

# Jekyll core (using standalone Jekyll instead of github-pages gem
# to support custom plugins like jekyll-wikilinks via GitHub Actions)
gem "jekyll", "~> 4.4.1"

# Windows support
gem "tzinfo-data", platforms: [:mingw, :mswin, :x64_mingw, :jruby]
gem "wdm", "~> 0.1.0", :install_if => Gem.win_platform?
gem "webrick", "~> 1.8"

group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.17"
  gem "jekyll-sitemap", "~> 1.4"
  gem "jekyll-seo-tag", "~> 2.8"
  gem "jekyll-wikilinks", "~> 0.0.12"
end
