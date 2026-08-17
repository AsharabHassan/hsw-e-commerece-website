// The pomegranate seed field: ten of thirty seeds light in sequence, so the
// 1-in-3 conversion ratio is counted rather than merely seen.
// Lifted from the original single-page build.
(function () {
  var field = document.getElementById('seedfield');
  if (!field) return;

  var animate = document.documentElement.classList.contains('js-anim')
             && 'IntersectionObserver' in window;
  if (!animate) { field.classList.add('lit'); return; }

  field.querySelectorAll('.seed[data-on]').forEach(function (s, i) {
    s.style.transitionDelay = (i * 90) + 'ms';
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      field.classList.add('lit');
    });
  }, { threshold: 0.35 });

  io.observe(field);
})();
