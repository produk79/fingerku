(function () {
  const body = document.body;
  const themeKey = 'csl-able-theme';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

  function selectedTheme() {
    return localStorage.getItem(themeKey) || 'auto';
  }

  function resolvedTheme() {
    const mode = selectedTheme();
    if (mode === 'auto') return prefersDark && prefersDark.matches ? 'dark' : 'light';
    return mode;
  }

  function applyTheme() {
    const mode = selectedTheme();
    body.setAttribute('data-theme', resolvedTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.textContent = mode === 'auto' ? 'Auto' : (mode === 'dark' ? 'Dark' : 'Light');
      button.setAttribute('aria-label', 'Theme mode: ' + button.textContent);
    });
  }

  applyTheme();
  if (prefersDark && prefersDark.addEventListener) {
    prefersDark.addEventListener('change', applyTheme);
  }

  document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(selectedTheme()) + 1) % order.length];
      localStorage.setItem(themeKey, next);
      applyTheme();
    });
  });

  function closeSidebar() {
    body.classList.remove('sidebar-open');
  }

  document.querySelectorAll('[data-mobile-nav], .hamburger').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      body.classList.toggle('sidebar-open');
    });
  });

  document.querySelectorAll('[data-sidebar-backdrop], .sidebar-backdrop').forEach(function (backdrop) {
    backdrop.addEventListener('click', closeSidebar);
  });

  function activateNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.side-menu a, .mobile-bottom a').forEach(function (link) {
      const href = link.getAttribute('href') || '';
      const groupedPaths = (link.getAttribute('data-active-paths') || '').split(',').filter(Boolean);
      const groupedActive = groupedPaths.some(function (prefix) {
        return path === prefix || (prefix !== '/' && path.startsWith(prefix));
      });
      if (!href.startsWith('/')) return;
      if (groupedActive || href === path || (href !== '/' && path.startsWith(href))) {
        link.classList.add('active');
      }
      link.addEventListener('click', closeSidebar);
    });
  }

  activateNav();

  window.copyTextFromButton = function (btn) {
    const text = btn.getAttribute('data-copy-text') || '';
    function done() {
      const old = btn.innerText;
      btn.innerText = 'Copied';
      setTimeout(function () { btn.innerText = old || 'Copy'; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text, done);
      });
      return;
    }
    fallbackCopy(text, done);
  };

  function fallbackCopy(text, done) {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.left = '-999px';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    done();
  }

  document.querySelectorAll('[data-check-all]').forEach(function (toggle) {
    toggle.addEventListener('change', function () {
      const table = toggle.closest('table');
      if (!table) return;
      table.querySelectorAll('tbody input[type="checkbox"], tr input[type="checkbox"]').forEach(function (box) {
        if (box !== toggle) box.checked = toggle.checked;
      });
    });
  });

  document.querySelectorAll('form[data-submit-lock]').forEach(function (form) {
    form.addEventListener('submit', function () {
      const button = form.querySelector('button[type="submit"]');
      if (!button || button.disabled) return;
      const text = button.getAttribute('data-loading-text') || 'Memproses...';
      button.dataset.originalHtml = button.innerHTML;
      setTimeout(function () {
        button.disabled = true;
        button.innerHTML = '<span class="spinner-dot" aria-hidden="true"></span> ' + text;
      }, 0);
    });
  });

  document.addEventListener('click', function (event) {
    document.querySelectorAll('details[open].machine-more, details[open].user-action-menu').forEach(function (details) {
      if (!details.contains(event.target)) details.removeAttribute('open');
    });
  });

  function initDeviceSearch() {
    const input = document.querySelector('[data-device-search]');
    if (!input) return;
    const rows = Array.from(document.querySelectorAll('[data-device-row]'));
    const counter = document.querySelector('[data-device-search-count]');

    function render() {
      const q = input.value.trim().toLowerCase();
      let visible = 0;
      rows.forEach(function (row) {
        const haystack = (row.getAttribute('data-device-search-text') || row.textContent || '').toLowerCase();
        const match = !q || haystack.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) visible += 1;
      });
      if (counter) counter.textContent = visible + ' / ' + rows.length + ' mesin';
    }

    input.addEventListener('input', render);
    render();
  }

  function cellText(row, index) {
    const cell = row.cells[index];
    return cell ? cell.textContent.trim() : '';
  }

  function sortValue(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    const numberCandidate = cleaned.replace(/[^0-9.,-]/g, '').replace(',', '.');
    if (numberCandidate && /^-?\d+(\.\d+)?$/.test(numberCandidate)) return Number(numberCandidate);
    const parsedDate = Date.parse(cleaned);
    if (!Number.isNaN(parsedDate) && /\d{4}|\d{1,2}[\/-]\d{1,2}/.test(cleaned)) return parsedDate;
    return cleaned.toLowerCase();
  }

  function enhanceTables() {
    document.querySelectorAll('.table-scroll table').forEach(function (table, index) {
      const holder = table.closest('.table-scroll');
      if (!holder || holder.dataset.enhanced === '1') return;
      const rows = Array.from(table.querySelectorAll('tr')).slice(1);
      if (!rows.length) return;
      holder.dataset.enhanced = '1';

      let search = null;
      let count = null;
      if (rows.length >= 8) {
        const tools = document.createElement('div');
        tools.className = 'able-table-tools';
        tools.innerHTML = '<input type="search" placeholder="Cari data tabel..." aria-label="Cari data tabel"><span class="able-table-count"></span>';
        holder.parentNode.insertBefore(tools, holder);
        search = tools.querySelector('input');
        count = tools.querySelector('.able-table-count');
        if (index === 0 && window.location.pathname.includes('device-users')) {
          search.placeholder = 'Cari user, ID, atau jumlah sidik...';
        }
      }

      function render() {
        const q = search ? search.value.trim().toLowerCase() : '';
        let visible = 0;
        rows.forEach(function (row) {
          const match = !q || row.textContent.toLowerCase().includes(q);
          row.style.display = match ? '' : 'none';
          if (match) visible += 1;
        });
        if (count) count.textContent = visible + ' / ' + rows.length + ' baris';
      }

      function sortByColumn(columnIndex, direction) {
        const body = table.tBodies[0] || table;
        const sortedRows = rows.slice().sort(function (a, b) {
          const av = sortValue(cellText(a, columnIndex));
          const bv = sortValue(cellText(b, columnIndex));
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
          return String(av).localeCompare(String(bv), undefined, { numeric: true }) * direction;
        });
        sortedRows.forEach(function (row) { body.appendChild(row); });
        rows.splice(0, rows.length);
        sortedRows.forEach(function (row) { rows.push(row); });
        render();
      }

      table.querySelectorAll('th').forEach(function (th, columnIndex) {
        th.dataset.sortable = '1';
        th.tabIndex = 0;
        th.title = 'Klik untuk urutkan';
        th.addEventListener('click', function () {
          const nextDirection = th.classList.contains('is-sort-asc') ? -1 : 1;
          table.querySelectorAll('th').forEach(function (other) {
            other.classList.remove('is-sort-asc', 'is-sort-desc');
          });
          th.classList.add(nextDirection === 1 ? 'is-sort-asc' : 'is-sort-desc');
          sortByColumn(columnIndex, nextDirection);
        });
        th.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            th.click();
          }
        });
      });

      if (search) search.addEventListener('input', render);
      render();
    });
  }

  initDeviceSearch();
  enhanceTables();

  const autoPull = document.querySelector('[data-auto-pull]');
  const autoStatus = document.querySelector('[data-auto-status]');
  let autoTimer = null;
  let autoBusy = false;

  function setAutoStatus(text) {
    if (autoStatus) autoStatus.textContent = text;
  }

  function runAutoPull() {
    if (!autoPull || !autoPull.checked) return;
    if (autoBusy) {
      setAutoStatus('Tarik data masih berjalan, menunggu proses selesai...');
      return;
    }
    autoBusy = true;
    setAutoStatus('Menarik data nyata dari mesin...');
    fetch(autoPull.getAttribute('data-url'), { method: 'POST', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        const text = 'Terakhir cek ' + (data.checked_at || '-') + ': ' + (data.success || 0) + ' mesin sukses, ' + (data.failed || 0) + ' gagal, ' + (data.logs || 0) + ' log.';
        setAutoStatus(text);
        if (Number(data.logs || 0) > 0) window.location.reload();
      })
      .catch(function () {
        setAutoStatus('Auto realtime gagal menghubungi endpoint XAMPP.');
      })
      .finally(function () {
        autoBusy = false;
      });
  }

  if (autoPull) {
    autoPull.addEventListener('change', function () {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
      if (autoPull.checked) {
        setAutoStatus('Auto realtime aktif.');
        runAutoPull();
        autoTimer = setInterval(runAutoPull, 30000);
      } else {
        setAutoStatus('Auto realtime belum aktif.');
      }
    });
  }
})();
