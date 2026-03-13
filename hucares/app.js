/* ═══════════════════════════════════════════════════════════
   HUcares · 一境忆 Art Exhibition
   Scroll reveal + progress navigation
   ~60 lines, zero dependencies
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─── Respect reduced motion ───────────────────────────
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (prefersReducedMotion.matches) {
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      el.classList.add('revealed');
    });
    // Still set up progress nav, skip animations
  }

  // ─── Scroll Reveal (IntersectionObserver) ─────────────
  if (!prefersReducedMotion.matches) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -60px 0px'
    });

    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  // ─── Progress Navigation ──────────────────────────────
  var progressDots = document.querySelectorAll('.progress-dot');
  var progressNav = document.querySelector('.progress-nav');

  // Build list of all tracked sections
  var allSections = [];

  // Hero
  var hero = document.getElementById('hero');
  if (hero) allSections.push({ el: hero, isDark: true });

  // Manifesto
  var manifesto = document.getElementById('manifesto');
  if (manifesto) allSections.push({ el: manifesto, isDark: false });

  // Artworks
  var artworks = document.querySelectorAll('.artwork');
  artworks.forEach(function (art) {
    allSections.push({
      el: art,
      isDark: art.classList.contains('artwork--dark')
    });
  });

  // Closing
  var closing = document.getElementById('closing');
  if (closing) allSections.push({ el: closing, isDark: true });

  // Track which section is in view for progress dots
  var sectionObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var idx = allSections.findIndex(function (s) { return s.el === entry.target; });
        if (idx === -1) return;

        // Update active dot
        progressDots.forEach(function (dot, i) {
          dot.classList.toggle('progress-dot--active', i === idx);
        });

        // Switch dot colors based on section theme
        var sectionIsDark = allSections[idx].isDark;
        if (progressNav) {
          progressNav.classList.toggle('is-light', !sectionIsDark);
        }
      }
    });
  }, {
    threshold: 0.4
  });

  allSections.forEach(function (s) {
    sectionObserver.observe(s.el);
  });

  // Click on dots to scroll
  progressDots.forEach(function (dot, i) {
    dot.addEventListener('click', function () {
      if (allSections[i]) {
        allSections[i].el.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // ─── Scroll indicator: hide after first scroll ────────
  var scrollIndicator = document.querySelector('.scroll-indicator');
  if (scrollIndicator) {
    var hideIndicator = function () {
      scrollIndicator.style.opacity = '0';
      scrollIndicator.style.transition = 'opacity 0.5s ease';
      window.removeEventListener('scroll', hideIndicator);
    };
    window.addEventListener('scroll', hideIndicator, { passive: true });
  }

})();
