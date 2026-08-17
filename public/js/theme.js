// Theme toggle — mirrors the clinic site's .dark convention.
// The anti-flash bootstrap lives inline in the layout head; this only handles
// the click, which cannot happen before first paint anyway.
(function () {
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  var toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  toggle.addEventListener('click', function () {
    var dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('hsw-theme', dark ? 'dark' : 'light'); } catch (e) {}
  });
})();
