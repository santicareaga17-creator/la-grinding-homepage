/**
 * Behaviour for the L.A. Grinding homepage.
 *
 * Every interaction here is a direct port of the Claude Design handoff: the class in
 * the handoff's `<script type="text/x-dc">` block owns the hero slider, the sticky
 * header and the mobile logo strip, and `renderVals()` names the handlers the markup
 * binds. Timings, distances and thresholds are copied from it rather than re-chosen,
 * so the shipped page behaves like the design canvas.
 *
 * The markup hooks (data-on-*, data-ref, data-panel) are emitted by tools/build.mjs,
 * which also fails the build if the design binds something this file does not define.
 */
(function () {
  "use strict";

  var panels = {};
  document.querySelectorAll("[data-panel]").forEach(function (el) {
    panels[el.getAttribute("data-panel")] = el;
  });

  function byRef(name) {
    return document.querySelector('[data-ref="' + name + '"]');
  }

  /* ---------- mega-menus ---------- */

  var openMenu = null;

  function showMenu(name) {
    if (openMenu === name) return;
    if (openMenu && panels[openMenu]) panels[openMenu].hidden = true;
    openMenu = name;
    if (name && panels[name]) panels[name].hidden = false;
  }

  var actions = {
    openShop: function () { showMenu("shop"); },
    openServices: function () { showMenu("services"); },
    closeMenus: function () { showMenu(null); },
    toggleShop: function () { showMenu(openMenu === "shop" ? null : "shop"); },
    toggleServices: function () { showMenu(openMenu === "services" ? null : "services"); }
  };

  /* ---------- mobile drawer + accordions ---------- */

  // The design keeps one accordion group open at a time (`acc` is a single value).
  var ACCORDIONS = {
    accCatT: "acc-cat", accIndT: "acc-ind", accOemT: "acc-oem",
    accBrandT: "acc-brand", accSvcT: "acc-svc"
  };
  var openAccordion = null;

  function showAccordion(name) {
    Object.keys(ACCORDIONS).forEach(function (key) {
      var panel = panels[ACCORDIONS[key]];
      if (panel) panel.hidden = ACCORDIONS[key] !== name;
    });
    openAccordion = name;
  }

  function setAccordionSign(name) {
    // The trigger's trailing glyph reads "+" when collapsed and "–" when expanded.
    Object.keys(ACCORDIONS).forEach(function (key) {
      var trigger = document.querySelector('[data-on-click="' + key + '"]');
      if (!trigger) return;
      var glyph = trigger.lastElementChild;
      if (glyph) glyph.textContent = ACCORDIONS[key] === name ? "–" : "+";
    });
  }

  // Opening the drawer closes any mega-menu, as `toggleDrawer` does in the design.
  actions.toggleDrawer = function () {
    var drawer = panels.drawer;
    if (!drawer) return;
    drawer.hidden = !drawer.hidden;
    showMenu(null);
    if (drawer.hidden) {
      showAccordion(null);
      setAccordionSign(null);
    }
  };

  Object.keys(ACCORDIONS).forEach(function (key) {
    actions[key] = function () {
      var next = openAccordion === ACCORDIONS[key] ? null : ACCORDIONS[key];
      showAccordion(next);
      setAccordionSign(next);
    };
  });

  /* ---------- search suggestions ---------- */

  var searchBlurTimer = null;

  actions.onSearchFocus = function () {
    clearTimeout(searchBlurTimer);
    if (panels.search) panels.search.hidden = false;
  };

  // The design defers the close by 160ms so a click on a suggestion still registers.
  actions.onSearchBlur = function () {
    clearTimeout(searchBlurTimer);
    searchBlurTimer = setTimeout(function () {
      if (panels.search) panels.search.hidden = true;
    }, 160);
  };

  /* ---------- horizontal carousels ---------- */

  // 780px is the design's default nudge for the category, product and review rails.
  function nudge(name, direction, amount) {
    var el = byRef(name);
    if (el) el.scrollBy({ left: direction * (amount || 780), behavior: "smooth" });
  }

  actions.scrollCatsLeft = function () { nudge("catsRef", -1); };
  actions.scrollCatsRight = function () { nudge("catsRef", 1); };
  actions.scrollProdLeft = function () { nudge("prodRef", -1); };
  actions.scrollProdRight = function () { nudge("prodRef", 1); };
  actions.scrollRevLeft = function () { nudge("revRef", -1); };
  actions.scrollRevRight = function () { nudge("revRef", 1); };

  /* ---------- hero slider ---------- */

  /**
   * Four slides on a 500%-wide track, with slide 5 a copy of the first. Advancing
   * past the last slide animates onto that copy and then snaps back to index 0 with
   * the transition off, so the loop has no visible rewind. Going back from the first
   * slide is the same trick in reverse.
   */
  (function () {
    var slider = byRef("sliderRef");
    var track = byRef("trackRef");
    if (!slider || !track) return;

    var AUTO_MS = 12000;     // the design's auto-advance interval
    var ANIM_MS = 600;       // transition duration
    var SNAP_MS = 640;       // when the clone is swapped back for slide 0
    var EASE = "transform 600ms cubic-bezier(0.4, 0, 0.2, 1)";

    /* The slide count is read from the DOM rather than hard-coded, because mobile.css
     * hides one slide below 640px. Panels = what is actually laid out; the last one is
     * the trailing copy of the first, so the real slides are one fewer, and a panel is
     * worth 100/panels percent of the track. */
    var SLIDES = 0;
    var STEP = 0;

    function measure() {
      var panels = 0;
      for (var i = 0; i < track.children.length; i += 1) {
        if (getComputedStyle(track.children[i]).display !== "none") panels += 1;
      }
      panels = Math.max(panels, 2);
      SLIDES = panels - 1;
      STEP = 100 / panels;
    }

    var index = 0;
    var busy = false;
    var snapTimer = null;
    var autoTimer = null;

    function apply(animate) {
      track.style.transition = animate === false ? "none" : EASE;
      track.style.transform = "translate3d(" + -STEP * index + "%, 0, 0)";
      // Force a reflow so the next animated move starts from the jumped position.
      if (animate === false) void track.offsetWidth;
    }

    function go(n) {
      if (busy) return;
      if (n < 0) {
        // Jump to the trailing copy of slide 0, then animate back to the last slide.
        index = SLIDES;
        apply(false);
        n = SLIDES - 1;
      }
      index = n;
      busy = true;
      apply(true);
      clearTimeout(snapTimer);
      snapTimer = setTimeout(function () {
        if (index === SLIDES) {
          index = 0;
          apply(false);
        }
        busy = false;
      }, SNAP_MS);
    }

    function restartAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(function () { go(index + 1); }, AUTO_MS);
    }

    actions.prevSlide = function () { go(index - 1); restartAuto(); };
    actions.nextSlide = function () { go(index + 1); restartAuto(); };

    measure();
    apply(false);
    restartAuto();

    /* Crossing the 640px breakpoint changes how many slides there are, so re-measure
     * and return to the first slide rather than leaving the track on an offset that no
     * longer lines up. */
    var wasNarrow = window.matchMedia("(max-width: 640px)").matches;
    window.addEventListener("resize", function () {
      var narrow = window.matchMedia("(max-width: 640px)").matches;
      if (narrow === wasNarrow) return;
      wasNarrow = narrow;
      clearTimeout(snapTimer);
      busy = false;
      measure();
      index = 0;
      apply(false);
      restartAuto();
    });

    /* Touch: a mostly-horizontal drag of more than 45px changes slide. */
    var startX = 0;
    var startY = 0;
    var tracking = false;

    slider.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }, { passive: true });

    slider.addEventListener("touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        go(dx < 0 ? index + 1 : index - 1);
        restartAuto();
      }
    }, { passive: true });

    /* Trackpad: accumulate horizontal wheel travel, then lock briefly so one
     * gesture cannot skip several slides. */
    var wheelAcc = 0;
    var wheelLock = false;

    slider.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelLock) return;
      wheelAcc += e.deltaX;
      if (Math.abs(wheelAcc) > 60) {
        go(wheelAcc > 0 ? index + 1 : index - 1);
        restartAuto();
        wheelAcc = 0;
        wheelLock = true;
        setTimeout(function () { wheelLock = false; }, ANIM_MS + 50);
      }
    }, { passive: false });
  })();

  /* ---------- September 2026 refresh: hero slider and category panels ---------- */

  /**
   * The refresh handoff renders one hero slide and one open category panel at a time.
   * The build emits every state instead — each slide as its own <section>, each panel
   * hidden next to the grid — and this switches between them.
   *
   * Both layouts are in the DOM at once (CSS shows one at 1024px), so every query here
   * is scoped to a layout root and the two run independently: switching a slide on
   * desktop also switches it on mobile, which keeps them in step across a resize.
   */
  (function () {
    var AUTOPLAY_MS = 9000;

    var roots = [].slice.call(document.querySelectorAll(".r26"));
    if (!roots.length) return;

    var slides = [].slice.call(document.querySelectorAll(".r26-slide"));
    if (!slides.length) return;

    var count = 0;
    slides.forEach(function (el) {
      count = Math.max(count, Number(el.getAttribute("data-r26-slide")) + 1);
    });

    var current = 0;
    var timer = null;

    function closeMinis() {
      [].slice.call(document.querySelectorAll(".r26-minis")).forEach(function (p) {
        p.hidden = true;
      });
      // The buttons colour themselves when their panel is open; reset both.
      [].slice.call(document.querySelectorAll("[data-on-click='heroMiniShop']")).forEach(function (b) {
        b.style.background = "#EA4E32";
        if (b.lastElementChild) b.lastElementChild.style.transform = "none";
      });
      [].slice.call(document.querySelectorAll("[data-on-click='heroMiniTech']")).forEach(function (b) {
        b.style.background = "#12305A";
        if (b.lastElementChild) b.lastElementChild.style.transform = "none";
      });
      openMini = null;
    }

    function show(n) {
      current = ((n % count) + count) % count;
      slides.forEach(function (el) {
        el.hidden = Number(el.getAttribute("data-r26-slide")) !== current;
      });
      closeMinis();
    }

    function go(step, auto) {
      show(current + step);
      if (!auto) restart();
    }

    function restart() {
      clearInterval(timer);
      timer = setInterval(function () { go(1, true); }, AUTOPLAY_MS);
    }

    actions.prev = function () { go(-1); };
    actions.next = function () { go(1); };
    actions.heroDot = function (e, el) {
      var n = Number(el.getAttribute("data-slide"));
      if (!isNaN(n)) { show(n); restart(); }
    };

    /* Swipe and horizontal wheel, with the design's own thresholds. */
    var sx = null, sy = null, wheelAt = 0;
    actions.swTs = function (e) {
      var t = e.touches && e.touches[0];
      if (t) { sx = t.clientX; sy = t.clientY; }
    };
    actions.swTe = function (e) {
      if (sx == null) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) { sx = null; return; }
      var dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    };
    actions.swWheel = function (e) {
      if (Math.abs(e.deltaX) < 25 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      var now = Date.now();
      if (now - wheelAt < 700) return;
      wheelAt = now;
      go(e.deltaX > 0 ? 1 : -1);
    };

    /* The hero's two dropdowns, on the one slide that has them. */
    var openMini = null;

    function toggleMini(which, restColour) {
      var next = openMini === which ? null : which;
      closeMinis();
      if (!next) { restart(); return; }
      openMini = next;
      // The panels live inside their own slide, so only the visible one can match.
      [].slice.call(document.querySelectorAll(
        ".r26-slide:not([hidden]) .r26-minis[data-r26-minis='" + which + "']"
      )).forEach(function (p) { p.hidden = false; });
      [].slice.call(document.querySelectorAll(
        "[data-on-click='" + (which === "shop" ? "heroMiniShop" : "heroMiniTech") + "']"
      )).forEach(function (b) {
        b.style.background = "#c93d24";
        if (b.lastElementChild) b.lastElementChild.style.transform = "rotate(180deg)";
      });
      // An open panel pauses the carousel, as it does in the design.
      clearInterval(timer);
      void restColour;
    }

    actions.heroMiniShop = function () { toggleMini("shop"); };
    actions.heroMiniTech = function () { toggleMini("tech"); };

    /* ---- category panels ---- */

    var openCat = null;

    actions.catMenu = function (e, el) {
      if (e && e.preventDefault) e.preventDefault();
      var key = el.getAttribute("data-cat-menu");
      var next = openCat === key ? null : key;
      openCat = next;
      [].slice.call(document.querySelectorAll(".r26-catmenu")).forEach(function (p) {
        p.hidden = p.getAttribute("data-r26-catmenu") !== next;
      });
      // The open card carries a ring in the design; mirror it with the same inset shadow.
      [].slice.call(document.querySelectorAll("[data-cat-menu]")).forEach(function (card) {
        var on = next && card.getAttribute("data-cat-menu") === next;
        var box = card.firstElementChild;
        if (box) box.style.boxShadow = on ? "inset 0 0 0 3px #EA4E32" : "";
      });
    };

    show(0);
    restart();
  })();

  /* ---------- wiring ---------- */

  var events = {
    "data-on-click": "click",
    "data-on-mouseenter": "mouseenter",
    "data-on-mouseleave": "mouseleave",
    "data-on-focus": "focus",
    "data-on-blur": "blur",
    // The refresh hero is swipeable.
    "data-on-touchstart": "touchstart",
    "data-on-touchend": "touchend",
    "data-on-wheel": "wheel"
  };

  Object.keys(events).forEach(function (attr) {
    document.querySelectorAll("[" + attr + "]").forEach(function (el) {
      var handler = actions[el.getAttribute(attr)];
      if (!handler) return;
      // The element is passed alongside the event: several refresh handlers are shared
      // by a set of controls and read which one fired from its own data attribute.
      el.addEventListener(events[attr], function (e) { handler.call(el, e, el); });
    });
  });

  /* ---------- distributor logo strip ---------- */

  /**
   * Below 640px the logo grid becomes a scroll-snapping row that steps itself one
   * logo to the right every second and wraps at the end. Touching it pauses the
   * stepping for 2.5s so a swipe is never fought.
   */
  (function () {
    var MOBILE_MAX = 640;
    var STEP_MS = 1000;
    var RESUME_MS = 2500;

    var logos = document.querySelector("#page .logos");
    if (!logos) return;

    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    var paused = false;
    var resumeTimer = null;

    function pause() {
      paused = true;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(function () { paused = false; }, RESUME_MS);
    }

    logos.addEventListener("touchstart", pause, { passive: true });
    logos.addEventListener("pointerdown", pause, { passive: true });

    // Don't run the timer while the strip is off-screen.
    var visible = true;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0 }).observe(logos);
    }

    setInterval(function () {
      if (paused || !visible) return;
      if (window.innerWidth > MOBILE_MAX) return;
      if (reduced && reduced.matches) return;

      var item = logos.firstElementChild;
      if (!item) return;
      var step = item.getBoundingClientRect().width + 1;   // +1 for the 1px gap
      var max = logos.scrollWidth - logos.clientWidth - 2;
      var next = logos.scrollLeft >= max ? 0 : logos.scrollLeft + step;
      logos.scrollTo({ left: next, behavior: "smooth" });
    }, STEP_MS);
  })();

  /* ---------- desktop: the logo strip rotates between two groups ---------- */

  /**
   * From 1024px up the strip shows the eighteen original manufacturers, then the
   * fifteen newer ones, swapping every 10 seconds. All 33 cells stay in the DOM and
   * keep their links and hover; desktop.css lays both groups over the same 9x2 area
   * and this only flips `data-group`.
   *
   * The attribute is removed below 1024px and never set at all if the page is not
   * wide, so the tablet and mobile strips are untouched and a failure here leaves
   * the section exactly as it was.
   */
  (function () {
    var DESKTOP_MIN = 1024;
    var SWAP_MS = 10000;

    var logos = document.querySelector("#page .logos");
    if (!logos || !window.matchMedia) return;

    var wide = window.matchMedia("(min-width: " + DESKTOP_MIN + "px)");
    var timer = null;
    var group = 0;

    // Don't count down while the strip is off-screen: the first group a reader sees
    // should be the first group, not whichever one the timer happened to land on.
    var visible = true;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0 }).observe(logos);
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function start() {
      stop();
      if (!wide.matches) {
        logos.removeAttribute("data-group");
        return;
      }
      group = 0;
      logos.setAttribute("data-group", "0");
      timer = setInterval(function () {
        if (!visible) return;
        group = group ? 0 : 1;
        logos.setAttribute("data-group", String(group));
      }, SWAP_MS);
    }

    start();
    if (wide.addEventListener) wide.addEventListener("change", start);
    else if (wide.addListener) wide.addListener(start);
  })();

  /* ---------- mobile: Our Services becomes a rail ---------- */

  /**
   * Below 640px the five service cards stop stacking and become a swipeable rail with
   * the same mechanics as "Shop by category": scroll-snap, touch swipe, and a pair of
   * round arrow buttons in the section header.
   *
   * The buttons are cloned from that section's own pair rather than rebuilt, so they
   * carry its exact markup, inline styling and hover class. They are created only when
   * the page is actually narrow, which keeps the desktop DOM identical to the handoff.
   */
  (function () {
    if (!window.matchMedia) return;
    var mq = window.matchMedia("(max-width: 640px)");

    var section = document.querySelector('[data-screen-label="Our Services"]');
    var card = section && section.querySelector("a.blueprint");
    var rail = card && card.parentElement;
    var header = rail && rail.previousElementSibling;
    if (!rail || !header) return;

    var nav = null;

    // One card per press, which is what the rail's snap points line up with.
    function step(direction) {
      var first = rail.firstElementChild;
      if (!first) return;
      var gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
      rail.scrollBy({ left: direction * (first.getBoundingClientRect().width + gap), behavior: "smooth" });
    }

    function build() {
      if (nav) return;
      var source = document.querySelector('[data-on-click="scrollCatsLeft"]');
      if (!source || !source.parentElement) return;

      nav = source.parentElement.cloneNode(true);
      nav.className = "m-rail-nav";
      var buttons = nav.querySelectorAll("button");
      if (buttons.length < 2) { nav = null; return; }

      [["Previous services", -1], ["Next services", 1]].forEach(function (pair, i) {
        var button = buttons[i];
        // The clone carries the category rail's hooks; they must not fire here.
        button.removeAttribute("data-on-click");
        button.setAttribute("aria-label", pair[0]);
        button.addEventListener("click", function () { step(pair[1]); });
      });

      header.appendChild(nav);
    }

    function sync() {
      var narrow = mq.matches;
      if (narrow) build();
      if (nav) nav.hidden = !narrow;
      rail.classList.toggle("m-rail", narrow);
    }

    sync();
    window.addEventListener("resize", sync);
  })();

  /* ---------- viewport changes ---------- */

  // The drawer only exists below the desktop breakpoint; collapse it on resize past it.
  window.addEventListener("resize", function () {
    if (window.innerWidth >= 1280 && panels.drawer && !panels.drawer.hidden) {
      panels.drawer.hidden = true;
      showAccordion(null);
      setAccordionSign(null);
    }
  });

  /* ---------- sticky header ---------- */

  /**
   * The design measures a 1px sentinel inserted above the header rather than a fixed
   * scroll offset, so `is-stuck` flips exactly when the header starts sticking —
   * which is what the condensed-height CSS in page.css is written against.
   */
  (function () {
    var nav = document.getElementById("stickyNav");
    if (!nav || !nav.parentNode) return;

    var sentinel = document.createElement("div");
    sentinel.style.cssText = "height:1px;width:100%";
    nav.parentNode.insertBefore(sentinel, nav);

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        nav.classList.toggle("is-stuck", !entries[0].isIntersecting);
      }, { threshold: 0 }).observe(sentinel);
    }

    // Capture-phase fallback, so a scroll inside a nested scroller still updates it.
    var onScroll = function () {
      nav.classList.toggle("is-stuck", sentinel.getBoundingClientRect().bottom <= 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    onScroll();
  })();
})();
