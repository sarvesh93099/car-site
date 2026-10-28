// Presentation enhancements share the existing catalogue and request basket.
// No separate prices, customer records or network integrations are introduced.
(() => {
  const header = document.querySelector('.header');
  const menuToggle = $('menu-toggle');
  const navigation = $('main-nav');
  const products = $('products');
  const sortControl = $('catalogue-sort');
  const compareSelection = new Set();

  function closeMenu(restoreFocus = false) {
    if (!menuToggle) return;
    header.classList.remove('menu-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuToggle.focus();
  }

  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    header.classList.toggle('menu-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  navigation?.addEventListener('click', event => {
    const action = event.target.closest('a,button');
    const wasOpen = menuToggle?.getAttribute('aria-expanded') === 'true';
    if (action) closeMenu();
    if (wasOpen && action?.hash) {
      // The existing anchor handler first restores the storefront if needed.
      requestAnimationFrame(() => {
        const section = document.getElementById(action.hash.slice(1));
        if (!section) return;
        section.setAttribute('tabindex', '-1');
        section.focus({ preventScroll: true });
      });
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu(true);
    }
  });
  window.matchMedia('(min-width: 901px)').addEventListener('change', event => {
    if (event.matches) closeMenu();
  });

  function selectedProducts() {
    return [...compareSelection].map(id => state.products.find(product => String(product.id) === id)).filter(Boolean);
  }

  function updateComparison() {
    const count = selectedProducts().length;
    $('compare-count').textContent = String(count);
    $('compare-open').disabled = count < 2;
    $('compare-open').setAttribute('aria-label', `Compare services ${count} selected`);
    if ($('compare-clear')) $('compare-clear').hidden = count === 0;
    document.querySelectorAll('[data-compare]').forEach(button => {
      const selected = compareSelection.has(button.dataset.compare);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = 'Compare';
    });
  }

  function priceLabel(product) {
    if (!product.price) return 'Price on request';
    return `${product.kind === 'Product' ? 'Listed price' : 'Starting from'} ${money(product.price)}`;
  }

  function addButton(product) {
    const quantity = state.basket[product.id] || 0;
    return `<button type="button" class="add-button ${quantity ? 'selected' : ''}" data-add="${esc(product.id)}" aria-label="Add ${esc(product.name)} to your request">+ Add</button>`;
  }

  function syncBasketLabels() {
    $('basket-open').setAttribute('aria-label', `Your request ${$('basket-count').textContent.trim()}`);
    document.querySelectorAll('[data-add]').forEach(button => {
      const quantity = state.basket[button.dataset.add] || 0;
      // Keep the visible action in its accessible name as the basket changes.
      // Confirmation remains in the existing live toast and basket counter.
      if (button.textContent !== '+ Add') button.textContent = '+ Add';
      button.classList.toggle('selected', quantity > 0);
      if (quantity) button.title = `${quantity} already in your request. Add one more.`;
      else button.removeAttribute('title');
    });
  }
  const basketObserver = new MutationObserver(syncBasketLabels);
  basketObserver.observe($('basket-count'), { childList: true, characterData: true, subtree: true });

  function renderComparison() {
    const items = selectedProducts();
    if (items.length < 2) return;
    const rows = [
      ['Category', product => esc(product.category)],
      ['What’s included', product => esc(product.description)],
      ['Estimate', product => `<strong>${esc(priceLabel(product))}</strong>`],
      ['Your selection', product => addButton(product)]
    ];
    $('compare-content').innerHTML = `<div class="comparison-scroll" tabindex="0" role="region" aria-label="Service comparison, scroll horizontally on small screens"><table class="comparison-table"><caption>Compare your selected care options</caption><thead><tr><th scope="col">The details</th>${items.map(product => `<th scope="col">${esc(product.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, content]) => `<tr><th scope="row">${label}</th>${items.map(product => `<td>${content(product)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="fine-print">These are the current catalogue details. The studio confirms suitability, availability, final scope and pricing after reviewing your vehicle. No payment is taken here.</p>`;
    syncBasketLabels();
    openDialog('compare-dialog');
  }

  // Observe only replacements in the catalogue. Disconnect while sorting to
  // avoid observing our own reordering or losing focus on comparison controls.
  const catalogueObserver = new MutationObserver(enhanceCatalogue);
  function enhanceCatalogue() {
    catalogueObserver.disconnect();
    const cards = [...products.querySelectorAll('.product-card')];
    const catalogue = new Map(state.products.map((product, index) => [String(product.id), { product, index }]));
    cards.forEach(card => {
      const id = card.querySelector('[data-add]')?.dataset.add;
      const entry = catalogue.get(id);
      if (!entry || card.querySelector('[data-compare]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'compare-toggle';
      button.dataset.compare = id;
      button.setAttribute('aria-label', `Compare ${entry.product.name}`);
      card.querySelector('.product-info').append(button);
    });
    const mode = sortControl?.value || 'featured';
    const sorted = [...cards].sort((left, right) => {
      const a = catalogue.get(left.querySelector('[data-add]')?.dataset.add);
      const b = catalogue.get(right.querySelector('[data-add]')?.dataset.add);
      if (!a || !b) return 0;
      if (mode === 'name') return a.product.name.localeCompare(b.product.name);
      if (mode === 'price-low' || mode === 'price-high') {
        // An unpriced custom package is not a free service; keep it last.
        if (!a.product.price || !b.product.price) return Number(!a.product.price) - Number(!b.product.price);
        return mode === 'price-low' ? a.product.price - b.product.price : b.product.price - a.product.price;
      }
      return a.index - b.index;
    });
    if (sorted.some((card, index) => card !== cards[index])) sorted.forEach(card => products.append(card));
    updateComparison();
    syncBasketLabels();
    catalogueObserver.observe(products, { childList: true });
  }
  if (products) enhanceCatalogue();
  sortControl?.addEventListener('change', enhanceCatalogue);
  $('compare-open')?.addEventListener('click', renderComparison);
  $('compare-clear')?.addEventListener('click', () => {
    $('compare-dialog').close();
    compareSelection.clear();
    updateComparison();
    $('compare-content').replaceChildren();
    const first = products.querySelector('[data-compare]');
    (first || sortControl)?.focus({ preventScroll: true });
    toast('Comparison cleared. Choose two or three care options.');
  });

  function resetFinder() {
    $('finder-form').reset();
    $('finder-results').hidden = true;
    $('finder-results').replaceChildren();
    $('finder-error').textContent = '';
    if ($('finder-reset')) $('finder-reset').hidden = true;
  }

  async function ensureCatalogue() {
    if (Array.isArray(state.products) && state.products.length) return true;
    const error = $('finder-error');
    error.textContent = 'Loading the collection…';
    try {
      const [catalogue, session] = await Promise.all([api('products'), api('session')]);
      if (!Array.isArray(catalogue)) throw new Error('The collection response was invalid.');
      state.products = catalogue;
      state.user = session?.user || null;
      saveBasket();
      renderAccount();
      renderCatalogue();
      if (!catalogue.length) throw new Error('The collection is empty right now. Please try again shortly.');
      error.textContent = '';
      return true;
    } catch (failure) {
      error.textContent = location.protocol === 'file:'
        ? failure.message
        : `${failure.message || 'Could not load the collection.'} Try again, or close this window to browse the collection.`;
      return false;
    }
  }
  $('finder-form')?.addEventListener('change', () => {
    $('finder-error').textContent = '';
  });

  $('finder-reset')?.addEventListener('click', () => {
    resetFinder();
    $('finder-form').querySelector('input[name="goal"]')?.focus();
  });
  $('finder-form')?.addEventListener('change', () => {
    $('finder-results').hidden = true;
    $('finder-error').textContent = '';
    if ($('finder-reset')) $('finder-reset').hidden = true;
  });
  $('finder-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const category = new FormData(event.target).get('goal');
    if (!category) return;
    if (!await ensureCatalogue()) return;
    const matches = state.products.filter(product => product.category === category);
    const result = $('finder-results');
    $('finder-error').textContent = '';
    result.innerHTML = `<h3 id="finder-results-title" tabindex="-1">${matches.length ? `${matches.length} ${matches.length === 1 ? 'option' : 'options'} to explore` : 'No matching options right now'}</h3><p class="fine-print">${matches.length ? 'Matched to your selected goal. The studio will help confirm the right treatment for your vehicle.' : 'The current catalogue has no items in this category. Explore all care options or choose another goal.'}</p>${matches.map(product => `<article class="finder-result"><div><h3>${esc(product.name)}</h3><p>${esc(product.description)}</p><strong>${esc(priceLabel(product))}</strong></div><div class="finder-result-actions">${addButton(product)}</div></article>`).join('')}<button class="button dark" type="button" data-finder-browse="${esc(matches.length ? category : 'All')}">${matches.length ? 'Explore these options' : 'Explore all care'} <span aria-hidden="true">↗</span></button>`;
    result.hidden = false;
    syncBasketLabels();
    if ($('finder-reset')) $('finder-reset').hidden = false;
    $('finder-results-title').focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!header?.contains(event.target) || button?.matches('#login-open,#basket-open')) closeMenu();
    if (!button) return;
    if (button.hasAttribute('data-open-finder')) {
      resetFinder();
      openDialog('finder-dialog');
    }
    if (button.hasAttribute('data-finder-browse')) {
      state.category = button.dataset.finderBrowse;
      $('search').value = '';
      renderCatalogue();
      $('finder-dialog').close();
      showStore();
      $('catalogue').scrollIntoView({ behavior: scrollBehavior() });
      $('search').focus({ preventScroll: true });
    }
    if (button.hasAttribute('data-compare')) {
      const id = button.dataset.compare;
      if (compareSelection.has(id)) compareSelection.delete(id);
      else if (compareSelection.size < 3) compareSelection.add(id);
      else {
        toast('Compare up to three options. Deselect one to make room.');
        return;
      }
      updateComparison();
      toast(`${compareSelection.size} of 3 comparison options selected.${compareSelection.size === 1 ? ' Choose one more to compare.' : ''}`);
    }
  });

  if ('IntersectionObserver' in window && navigation) {
    const links = [...navigation.querySelectorAll('a[href^="#"]')];
    const sectionObserver = new IntersectionObserver(entries => {
      const active = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!active) return;
      links.forEach(link => {
        if (link.hash === `#${active.target.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-12% 0px -55% 0px', threshold: 0 });
    links.forEach(link => {
      const section = document.getElementById(link.hash.slice(1));
      if (section) sectionObserver.observe(section);
    });
  }
})();
