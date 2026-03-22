(function () {
  'use strict';

  var nav = document.getElementById('nav');
  var navToggle = document.querySelector('.nav__toggle');
  var navLinks = document.querySelector('.nav__links');
  var navAnchors = document.querySelectorAll('.nav__link[href^="#"]');
  var sections = document.querySelectorAll('section[id]');
  var canvas = document.getElementById('hero-canvas');

  /* —— Nav scroll state —— */
  function onScrollNav() {
    if (!nav) return;
    if (window.scrollY > 24) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
  }

  window.addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  /* —— Mobile menu —— */
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', !open);
      navLinks.classList.toggle('nav__links--open', !open);
      document.body.style.overflow = !open ? 'hidden' : '';
    });

    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navToggle.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('nav__links--open');
        document.body.style.overflow = '';
      });
    });
  }

  /* —— Smooth scroll (anchor) —— */
  navAnchors.forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var id = anchor.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: top, behavior: 'smooth' });
    });
  });

  /* —— Active section in nav —— */
  var observerOptions = { root: null, rootMargin: '-40% 0px -45% 0px', threshold: 0 };

  if (sections.length && navAnchors.length) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.getAttribute('id');
        navAnchors.forEach(function (link) {
          link.classList.toggle('nav__link--active', link.getAttribute('href') === '#' + id);
        });
      });
    }, observerOptions);

    sections.forEach(function (sec) {
      sectionObserver.observe(sec);
    });
  }

  /* —— Scroll reveal —— */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal--visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* —— Hero particles —— */
  function initParticles() {
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.style.display = 'none';
      return;
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var particles = [];
    var count = 48;
    var w = 0;
    var h = 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function Particle() {
      this.x = Math.random() * w;
      this.y = Math.random() * h;
      this.r = Math.random() * 2 + 0.5;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = (Math.random() - 0.5) * 0.35;
      this.a = Math.random() * 0.5 + 0.15;
    }

    Particle.prototype.step = function () {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > w) this.vx *= -1;
      if (this.y < 0 || this.y > h) this.vy *= -1;
    };

    Particle.prototype.draw = function () {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34, 211, 238, ' + this.a + ')';
      ctx.fill();
    };

    function build() {
      particles = [];
      for (var i = 0; i < count; i++) {
        particles.push(new Particle());
      }
    }

    function line(p1, p2, dist) {
      var maxD = 110;
      if (dist > maxD) return;
      var o = 1 - dist / maxD;
      ctx.strokeStyle = 'rgba(167, 139, 250, ' + o * 0.12 + ')';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    var rafId = 0;
    function loop() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < particles.length; i++) {
        particles[i].step();
        particles[i].draw();
      }
      for (var a = 0; a < particles.length; a++) {
        for (var b = a + 1; b < particles.length; b++) {
          var dx = particles[a].x - particles[b].x;
          var dy = particles[a].y - particles[b].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          line(particles[a], particles[b], d);
        }
      }
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (rafId) cancelAnimationFrame(rafId);
      resize();
      build();
      loop();
    }

    startLoop();

    window.addEventListener(
      'resize',
      function () {
        startLoop();
      },
      { passive: true }
    );

    window.addEventListener(
      'scroll',
      function () {
        canvas.style.transform = 'translateY(' + window.scrollY * 0.06 + 'px)';
      },
      { passive: true }
    );
  }

  initParticles();

  /* —— Contact form → mailto —— */
  var form = document.getElementById('contact-form');
  var formStatus = document.getElementById('form-status');

  if (form && formStatus) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('contact-name');
      var email = document.getElementById('contact-email');
      var message = document.getElementById('contact-message');
      if (!name || !email || !message) return;

      var n = name.value.trim();
      var em = email.value.trim();
      var msg = message.value.trim();

      if (!n || !em || !msg) {
        formStatus.textContent = 'Please fill in all fields.';
        formStatus.className = 'form-status form-status--error';
        return;
      }

      var body =
        'Name: ' +
        encodeURIComponent(n) +
        '%0D%0AEmail: ' +
        encodeURIComponent(em) +
        '%0D%0A%0D%0A' +
        encodeURIComponent(msg);
      var subject = encodeURIComponent('Project inquiry from ' + n);
      window.location.href =
        'mailto:gstech.info.24@gmail.com?subject=' + subject + '&body=' + body;

      formStatus.textContent = 'Opening your email app…';
      formStatus.className = 'form-status';
    });
  }
})();
