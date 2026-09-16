/**
 * SHARED.JS: DOM and formatting helpers used by both the deck and the catalog.
 */

const $ = (id) => document.getElementById(id);

/**
 * Clone a <template> and index every [data-el] inside it by name, so callers
 * fill fields with textContent instead of building HTML strings.
 */
function clone(templateId) {
  const frag = $(templateId).content.cloneNode(true);
  const r = {};
  frag.querySelectorAll('[data-el]').forEach(el => { r[el.dataset.el] = el; });
  return { frag, el: frag.firstElementChild, r };
}

/** External store and web search links for a game title. */
function gameLinks(title) {
  const q = encodeURIComponent(title);
  return {
    steam: `https://store.steampowered.com/search/?term=${q}`,
    gog: `https://www.gog.com/en/games?query=${q}`,
    google: `https://www.google.com/search?q=${encodeURIComponent(title + ' video game')}`
  };
}

/** Hide an image that fails to load rather than showing a broken-image icon. */
function hideOnError(img) {
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
}
