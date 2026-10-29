/* ============================================================
   ultra-premium.js  –  V31 Concepts · Optimized Interactions
   Lightweight, 60fps, buttery-smooth interactions
   ============================================================ */
;(function () {
  'use strict';

  const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $q = (s, p) => (p || document).querySelector(s);
  const $qa = (s, p) => [...(p || document).querySelectorAll(s)];

  if (reducedMotion()) return;

  /* 1. Subtle, lightweight card hover effect (pure CSS-driven performance) */
  function initCardHover() {
    if (isTouchDevice()) return;

    function bindCard(card) {
      if (card.dataset.hoverReady) return;
      card.dataset.hoverReady = '1';

      card.addEventListener('pointerenter', () => {
        card.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease';
      }, { passive: true });

      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
      }, { passive: true });
    }

    $qa('.product-card').forEach(bindCard);

    const productsEl = $q('#products');
    if (productsEl) {
      const mo = new MutationObserver(() => {
        $qa('.product-card', productsEl).forEach(bindCard);
      });
      mo.observe(productsEl, { childList: true });
    }
  }

  /* 2. Number counter animation for trust strip - smooth and one-off */
  function initCounters() {
    const nums = $qa('.trust-number');
    if (!nums.length) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        obs.unobserve(el);

        const target = parseInt(el.textContent.trim(), 10);
        if (isNaN(target)) return;

        let frame = 0;
        const totalFrames = 30; // 0.5s at 60fps
        const timer = setInterval(() => {
          frame++;
          const progress = frame / totalFrames;
          const current = Math.round(progress * target);
          el.textContent = String(current).padStart(2, '0');
          if (frame >= totalFrames) {
            clearInterval(timer);
            el.textContent = String(target).padStart(2, '0');
          }
        }, 16);
      });
    }, { threshold: 0.5 });

    nums.forEach(n => obs.observe(n));
  }

  /* 3. Header elevation on scroll - lightweight passive throttled */
  function initHeaderElevation() {
    const header = $q('.header');
    if (!header) return;

    let scrolled = false;
    window.addEventListener('scroll', () => {
      const isPast = window.scrollY > 20;
      if (isPast !== scrolled) {
        scrolled = isPast;
        header.classList.toggle('scrolled', scrolled);
      }
    }, { passive: true });
  }

  /* 4. Active nav links smooth intersection highlight */
  function initNavObserver() {
    const navLinks = $qa('.header nav a[href^="#"]');
    if (!navLinks.length) return;

    const sections = navLinks
      .map(l => document.querySelector(l.getAttribute('href')))
      .filter(Boolean);

    if (!sections.length) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach(s => obs.observe(s));
  }

  /* 5. Basket count bounce micro-interaction */
  function initBasketBounce() {
    const badge = $q('#basket-count');
    if (!badge) return;

    let bounceTimer;
    const mo = new MutationObserver(() => {
      badge.style.transform = 'scale(1.25)';
      clearTimeout(bounceTimer);
      bounceTimer = setTimeout(() => {
        badge.style.transform = '';
      }, 200);
    });
    mo.observe(badge, { childList: true, characterData: true, subtree: true });
  }

  function boot() {
    initCardHover();
    initCounters();
    initHeaderElevation();
    initNavObserver();
    initBasketBounce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
