// Состояние приложения
const API_BASE = window.__API_BASE__ || '';
let currentTab = 'specs';
let specMode = 'load'; // 'load' (11 колонок) или 'change' (18 колонок)
let specRows = []; // массив строк таблицы спецификации
let kpRows = []; // массив строк таблицы коммерческого предложения
let searchTimeout = null;

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  initTodayDate();
  initInitialSpecRows();
  renderSpecGrid();
  initInitialKpRows();
  renderKpGrid();


});

function initTodayDate() {
  const today = new Date();
  const d = String(today.getDate()).padStart(2, '0');
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const y = today.getFullYear();
  const dateStr = `${d}.${m}.${y}`;
  const el = document.getElementById('kp-meta-date');
  if (el) el.value = dateStr;
  const specDate = document.getElementById('meta-spec-date');
  if (specDate) specDate.value = `№ 1 от ${dateStr}`;
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('nav-specs').classList.toggle('active', tab === 'specs');
  document.getElementById('nav-kp').classList.toggle('active', tab === 'kp');

  document.getElementById('section-specs').style.display = tab === 'specs' ? 'block' : 'none';
  document.getElementById('section-kp').style.display = tab === 'kp' ? 'block' : 'none';

  let title = 'Спецификация к договору поставки';
  if (tab === 'kp') title = 'Генератор КП и ОКК';
  document.getElementById('page-title').textContent = title;
}

/* ========================================================================= */
/* РАЗДЕЛ 1: ИНТЕРАКТИВНАЯ СПЕЦИФИКАЦИЯ (11 или 18 колонок)                  */
/* ========================================================================= */

function formatRuNum(val, decimals = 2) {
  if (val === null || val === undefined || val === '') return '';
  const num = Number(val);
  if (isNaN(num)) return '';

  // Округляем до нужного числа знаков
  const fixed = num.toFixed(decimals);
  const parts = fixed.split('.');
  // Разделитель тысяч — пробел (1 000, 10 000)
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  // Разделитель копеек — запятая
  return parts.length > 1 && decimals > 0 ? `${parts[0]},${parts[1]}` : parts[0];
}

function parseRuNum(str) {
  if (str === null || str === undefined) return null;
  const cleaned = String(str).trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return null;
  const [mantissa, exponent='0'] = String(value).split('e');
  return Number(`${Math.round(Number(`${mantissa}e${Number(exponent)+2}`))}e-2`);
}
function parsePrice(value) { const n=parseRuNum(value); return n===null ? null : roundMoney(n); }

function createEmptyRow() {
  return {
    article: '',
    name: '',
    weight_g: null,
    barcode: '',
    pcs_per_box: 1,
    boxes_per_pallet: null,
    boxes_per_row: null,
    vat_rate: null,
    supplier: '',
    price_no_vat: null, // цена за шт без НДС (ввод)
    old_price_no_vat: null,
    new_price_no_vat: null,
    found: false,
    loading: false
  };
}

function initInitialSpecRows() {
  // Начальные 5 пустых строк
  specRows = [];
  for (let i = 0; i < 5; i++) {
    specRows.push(createEmptyRow());
  }
}

function switchSpecMode(mode) {
  specMode = mode;
  const changeFields = document.querySelectorAll('.meta-change-field');
  changeFields.forEach(el => {
    el.style.display = mode === 'change' ? 'block' : 'none';
  });
  renderSpecGrid();
}

function addSpecRow() {
  specRows.push(createEmptyRow());
  renderSpecGrid();
  // Фокус на новый добавленный инпут артикула
  setTimeout(() => {
    const inputs = document.querySelectorAll('.cell-input-art');
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
    }
  }, 50);
}

function removeSpecRow(idx) {
  specRows.splice(idx, 1);
  if (specRows.length === 0) {
    specRows.push(createEmptyRow());
  }
  renderSpecGrid();
}

function clearSpecGrid() {
  if (confirm('Очистить все строки спецификации?')) {
    initInitialSpecRows();
    renderSpecGrid();
  }
}

function getSpecIncompleteDetails() {
  return validateGrid(specRows, 'spec', document.getElementById('meta-supplier'));
}

function checkSpecIncompleteWarning() {
  updateTotals();
}

function renderSpecGrid() {
  clearTimeout(nameSearchTimeout);
  const autocomplete=document.getElementById('spec-global-autocomplete');
  if (autocomplete) autocomplete.style.display='none';
  const thead = document.getElementById('spec-thead');
  const tbody = document.getElementById('spec-tbody');

  if (specMode === 'load') {
    // 11 колонок в точности как в файле прогрузки цен
    // A: Артикул, B: Наименование (шире), C: Вес шт, гр. (сократить), D: Штрихкод,
    // E: Шт/Кор (сократить), F: Кор/Пал (сократить), G: Ставка НДС, % (сократить),
    // H: Цена/шт с НДС, I: Цена/шт без НДС (сократить), J: Цена/кор с НДС, K: Цена/кор без НДС
    thead.innerHTML = `
      <tr>
        <th class="row-idx" style="width: 28px;">№</th>
        <th class="col-art">Артикул</th>
        <th style="min-width: 220px;">Наименование</th>
        <th style="width: 60px; white-space: nowrap;">Вес шт, гр.</th>
        <th class="col-barcode">Штрих - код Товара</th>
        <th style="width: 50px; white-space: nowrap;">Шт/Кор</th>
        <th style="width: 50px; white-space: nowrap;">Кор/Пал</th>
        <th style="width: 60px; white-space: nowrap;">Ставка НДС, %</th>
        <th style="width: 105px; min-width: 105px; max-width: 105px;">Цена/шт<br><span style="white-space: nowrap; color:var(--text-muted);">с НДС, руб.</span></th>
        <th style="width: 105px; min-width: 105px; max-width: 105px;">Цена/шт<br><span style="white-space: nowrap; color:var(--accent-orange); font-weight:600;">без НДС, руб.</span></th>
        <th style="width: 105px; min-width: 105px; max-width: 105px;">Цена/кор<br><span style="white-space: nowrap; color:var(--text-muted);">с НДС, руб.</span></th>
        <th style="width: 105px; min-width: 105px; max-width: 105px;">Цена/кор<br><span style="white-space: nowrap; color:var(--accent-orange); font-weight:600;">без НДС, руб.</span></th>
        <th style="width: 28px;"></th>
      </tr>
    `;
  } else {
    // 18 колонок в точности как в файле изменения цен
    thead.innerHTML = `
      <tr>
        <th class="row-idx" style="width: 28px;">№</th>
        <th class="col-art">Артикул</th>
        <th class="col-name">Наименование</th>
        <th style="width: 55px; white-space: nowrap;">Вес шт (г)</th>
        <th style="width: 45px; white-space: nowrap;">Шт/Кор</th>
        <th style="width: 45px; white-space: nowrap;">Кор/Пал</th>
        <th style="width: 45px; white-space: nowrap;">Кор/Ряд</th>
        <th style="width: 55px; white-space: nowrap;">Ставка НДС</th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Цена/шт<br><span style="white-space: nowrap; color:var(--text-muted);">с НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Цена/шт<br><span style="white-space: nowrap; color:var(--accent-orange); font-weight:600;">без НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Цена/кор<br><span style="white-space: nowrap; color:var(--text-muted);">с НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Цена/кор<br><span style="white-space: nowrap; color:var(--accent-orange); font-weight:600;">без НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Новая шт<br><span style="white-space: nowrap; color:var(--text-muted);">с НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Новая шт<br><span style="white-space: nowrap; color:var(--accent-orange); font-weight:600;">без НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Новая кор<br><span style="white-space: nowrap; color:var(--text-muted);">с НДС, руб.</span></th>
        <th style="width: 90px; min-width: 90px; max-width: 90px;">Новая кор<br><span style="white-space: nowrap; color:var(--accent-orange); font-weight:600;">без НДС, руб.</span></th>
        <th style="width: 70px; white-space: nowrap;">% повышения</th>
        <th style="width: 28px;"></th>
      </tr>
    `;
  }

  tbody.innerHTML = '';
  specRows.forEach((row, idx) => {
    syncSpecMoney(row);
    const tr = document.createElement('tr');
    const vatRate = row.vat_rate ?? null;
    const vatText = vatRate === null ? "—" : `${Math.round(vatRate * 100)}%`;
    const pcs = row.pcs_per_box || 1;

    // Классы подсветки обязательных для заполнения полей
    const artEmptyClass = !row.article ? 'field-required-empty' : '';

    if (specMode === 'load') {
      const priceNoVat = row.price_no_vat !== null && row.price_no_vat !== undefined ? row.price_no_vat : '';
      const priceWithVatVal = row.price_with_vat !== null && row.price_with_vat !== undefined
        ? row.price_with_vat
        : (priceNoVat !== '' && vatRate !== null ? roundMoney(Number(priceNoVat) * (1 + vatRate)) : '');

      const priceNoVatDisplay = priceNoVat !== '' ? formatRuNum(priceNoVat, 2) : '';
      const priceWithVatDisplay = priceWithVatVal !== '' ? formatRuNum(priceWithVatVal, 2) : '';
      const priceEmptyClass = row.article && priceNoVat === '' && priceWithVatVal === '' ? 'field-required-empty' : '';

      const boxWithVat = priceWithVatVal !== '' ? formatRuNum(Number(priceWithVatVal) * pcs, 2) : '';
      const boxNoVat = priceNoVat !== '' ? formatRuNum(Number(priceNoVat) * pcs, 2) : '';

      tr.innerHTML = `
        <td class="row-idx" style="width: 28px;">${idx + 1}</td>
        <td class="col-art" style="width: 140px; min-width: 140px; max-width: 140px;">
          <input type="text" class="cell-input cell-input-art mono ${artEmptyClass}" value="${escapeHtml(row.article)}"
                 placeholder=""
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false"
                 data-lpignore="true"
                 onchange="onArticleChange(${idx}, this.value)"
                 onkeydown="handleArtKey(event, ${idx})">
        </td>
        <td style="position: relative; min-width: 220px;">
          <input type="text" class="cell-input cell-name-input" style="width: 100%;" value="${escapeHtml(row.name || '')}"
                 placeholder="${row.loading ? 'Поиск...' : 'поиск по названию'}"
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false"
                 data-lpignore="true"
                 oninput="onNameInput(${idx}, this)"
                 onkeydown="handleNameKey(event, ${idx})">
        </td>
        <td>${specFieldInput(idx, "weight_g", row.weight_g, true)}</td>
        <td class="col-barcode">${specFieldInput(idx, "barcode", row.barcode)}</td>
        <td>${specFieldInput(idx, "pcs_per_box", row.pcs_per_box, true)}</td>
        <td>${specFieldInput(idx, "boxes_per_pallet", row.boxes_per_pallet, true)}</td>
        <td>${vatSelect(idx, vatRate, "spec")}</td>
        <td style="width: 105px;">
          <input type="text" inputmode="decimal" class="cell-input mono ${priceEmptyClass}" id="row-p-with-vat-${idx}" style="text-align: right;"
                 value="${priceWithVatDisplay}" placeholder=""
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false"
                 data-lpignore="true"
                 onfocus="moveCursorToEnd(this)"
                 onmouseup="moveCursorToEnd(this)"
                 oninput="onLoadPriceWithVatInput(${idx}, this)"
                 onblur="onLoadPriceWithVatBlur(${idx}, this)"
                 onkeydown="handlePriceKey(event, ${idx}, 'load_with_vat')">
        </td>
        <td style="width: 105px;">
          <input type="text" inputmode="decimal" class="cell-input mono ${priceEmptyClass}" id="row-p-no-vat-${idx}" style="text-align: right;"
                 value="${priceNoVatDisplay}" placeholder=""
                 autocomplete="off"
                 autocorrect="off"
                 autocapitalize="off"
                 spellcheck="false"
                 data-lpignore="true"
                 onfocus="moveCursorToEnd(this)"
                 onmouseup="moveCursorToEnd(this)"
                 oninput="onLoadPriceNoVatInput(${idx}, this)"
                 onblur="onLoadPriceNoVatBlur(${idx}, this)"
                 onkeydown="handlePriceKey(event, ${idx}, 'load')">
        </td>
        <td class="cell-formula" id="row-box-with-vat-${idx}" style="width: 105px;">${boxWithVat}</td>
        <td class="cell-formula" id="row-box-no-vat-${idx}" style="width: 105px;">${boxNoVat}</td>
        <td style="text-align: center;">
          <button style="background:none; border:none; color:var(--text-subtle); cursor:pointer;" onclick="removeSpecRow(${idx})" title="Удалить">✕</button>
        </td>
      `;
    } else {
      // 18 колонок
      const oldPrice = row.price_no_vat !== null && row.price_no_vat !== undefined ? row.price_no_vat : '';
      const oldWithVatVal = row.old_price_with_vat !== null && row.old_price_with_vat !== undefined
        ? row.old_price_with_vat
        : (oldPrice !== '' && vatRate !== null ? roundMoney(Number(oldPrice) * (1 + vatRate)) : '');

      const newPrice = row.new_price_no_vat !== null && row.new_price_no_vat !== undefined ? row.new_price_no_vat : '';
      const newWithVatVal = row.new_price_with_vat !== null && row.new_price_with_vat !== undefined
        ? row.new_price_with_vat
        : (newPrice !== '' && vatRate !== null ? roundMoney(Number(newPrice) * (1 + vatRate)) : '');

      const oldPriceDisplay = oldPrice !== '' ? formatRuNum(oldPrice, 2) : '';
      const oldWithVatDisplay = oldWithVatVal !== '' ? formatRuNum(oldWithVatVal, 2) : '';
      const newPriceDisplay = newPrice !== '' ? formatRuNum(newPrice, 2) : '';
      const newWithVatDisplay = newWithVatVal !== '' ? formatRuNum(newWithVatVal, 2) : '';

      const oldEmptyClass = row.article && oldPrice === '' && oldWithVatVal === '' ? 'field-required-empty' : '';
      const newEmptyClass = row.article && newPrice === '' && newWithVatVal === '' ? 'field-required-empty' : '';

      const oldBoxWithVat = oldWithVatVal !== '' ? formatRuNum(Number(oldWithVatVal) * pcs, 2) : '';
      const oldBoxNoVat = oldPrice !== '' ? formatRuNum(Number(oldPrice) * pcs, 2) : '';

      const newBoxWithVat = newWithVatVal !== '' ? formatRuNum(Number(newWithVatVal) * pcs, 2) : '';
      const newBoxNoVat = newPrice !== '' ? formatRuNum(Number(newPrice) * pcs, 2) : '';

      let diffPct = '';
      if (oldPrice !== '' && newPrice !== '' && Number(oldPrice) > 0) {
        const d = ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice)) * 100;
        diffPct = `${d > 0 ? '+' : ''}${formatRuNum(d, 1)}%`;
      }

      tr.innerHTML = `
        <td class="row-idx" style="width: 28px;">${idx + 1}</td>
        <td class="col-art" style="width: 140px; min-width: 140px; max-width: 140px;">
          <input type="text" class="cell-input cell-input-art mono ${artEmptyClass}" value="${escapeHtml(row.article)}"
                 placeholder=""
                 onchange="onArticleChange(${idx}, this.value)"
                 onkeydown="handleArtKey(event, ${idx})">
        </td>
        <td style="position: relative; min-width: 220px;">
          <input type="text" class="cell-input cell-name-input" style="width: 100%;" value="${escapeHtml(row.name || '')}"
                 placeholder="${row.loading ? 'Поиск...' : 'поиск по названию'}"
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"
                 oninput="onNameInput(${idx}, this)"
                 onkeydown="handleNameKey(event, ${idx})">
        </td>
        <td>${specFieldInput(idx, "weight_g", row.weight_g, true)}</td>
        <td>${specFieldInput(idx, "pcs_per_box", row.pcs_per_box, true)}</td>
        <td>${specFieldInput(idx, "boxes_per_pallet", row.boxes_per_pallet, true)}</td>
        <td>${specFieldInput(idx, "boxes_per_row", row.boxes_per_row, true)}</td>
        <td>${vatSelect(idx, vatRate, "spec")}</td>
        <td style="width: 90px;">
          <input type="text" inputmode="decimal" class="cell-input mono" id="row-old-with-vat-${idx}" style="text-align: right;"
                 value="${oldWithVatDisplay}" placeholder=""
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"
                 onfocus="moveCursorToEnd(this)" onmouseup="moveCursorToEnd(this)"
                 oninput="onChangeOldPriceWithVatInput(${idx}, this)"
                 onblur="onChangeOldPriceWithVatBlur(${idx}, this)">
        </td>
        <td style="width: 90px;">
          <input type="text" inputmode="decimal" class="cell-input mono ${oldEmptyClass}" id="row-old-no-vat-${idx}" style="text-align: right;"
                 value="${oldPriceDisplay}" placeholder=""
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"
                 onfocus="moveCursorToEnd(this)" onmouseup="moveCursorToEnd(this)"
                 oninput="onChangeOldPriceNoVatInput(${idx}, this)"
                 onblur="onChangeOldPriceNoVatBlur(${idx}, this)">
        </td>
        <td class="cell-formula" id="row-old-box-with-vat-${idx}" style="width: 90px;">${oldBoxWithVat}</td>
        <td class="cell-formula" id="row-old-box-no-vat-${idx}" style="width: 90px;">${oldBoxNoVat}</td>
        <td style="width: 90px;">
          <input type="text" inputmode="decimal" class="cell-input mono" id="row-new-with-vat-${idx}" style="text-align: right;"
                 value="${newWithVatDisplay}" placeholder=""
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"
                 onfocus="moveCursorToEnd(this)" onmouseup="moveCursorToEnd(this)"
                 oninput="onChangeNewPriceWithVatInput(${idx}, this)"
                 onblur="onChangeNewPriceWithVatBlur(${idx}, this)"
                 onkeydown="handlePriceKey(event, ${idx}, 'change_with_vat')">
        </td>
        <td style="width: 90px;">
          <input type="text" inputmode="decimal" class="cell-input mono ${newEmptyClass}" id="row-new-no-vat-${idx}" style="text-align: right;"
                 value="${newPriceDisplay}" placeholder=""
                 autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true"
                 onfocus="moveCursorToEnd(this)" onmouseup="moveCursorToEnd(this)"
                 oninput="onChangeNewPriceNoVatInput(${idx}, this)"
                 onblur="onChangeNewPriceNoVatBlur(${idx}, this)"
                 onkeydown="handlePriceKey(event, ${idx}, 'change')">
        </td>
        <td class="cell-formula" id="row-new-box-with-vat-${idx}" style="width: 90px;">${newBoxWithVat}</td>
        <td class="cell-formula" id="row-new-box-no-vat-${idx}" style="width: 90px;">${newBoxNoVat}</td>
        <td class="cell-formula mono" id="row-diff-pct-${idx}" style="font-weight:600; color:${diffPct.startsWith('+') ? 'var(--status-red)' : 'var(--status-green)'};">${diffPct}</td>
        <td style="text-align: center;">
          <button style="background:none; border:none; color:var(--text-subtle); cursor:pointer;" onclick="removeSpecRow(${idx})" title="Удалить">✕</button>
        </td>
      `;
    }
    tbody.appendChild(tr);
  });
  labelGrid('spec-tbody','spec-thead');
  checkSpecIncompleteWarning();
}

let nameSearchTimeout = null;
let activeAutocompleteRowIdx = null;
let activeAutocompleteType = 'spec'; // 'spec' или 'kp'

function onNameInput(idx, inputEl) {
  specRows[idx].name = inputEl.value;
  checkSpecIncompleteWarning();
  clearTimeout(nameSearchTimeout);
  const q = inputEl.value.trim();
  const box = document.getElementById('spec-global-autocomplete');
  if (!box) return;

  if (q.length < 2) {
    box.style.display = 'none';
    return;
  }

  activeAutocompleteRowIdx = idx;
  activeAutocompleteType = 'spec';

  inputEl.onblur=()=>{box.style.display='none';};

  nameSearchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/specs/search-name?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const items = await res.json();
        renderGlobalAutocomplete(idx, items, inputEl);
      }
    } catch (e) {
      console.error(e);
    }
  }, 200);
}

function onKpNameInput(idx, inputEl) {
  kpRows[idx].name = inputEl.value;
  checkKpIncompleteWarning();
}

function renderGlobalAutocomplete(idx, items, inputEl) {
  const box = document.getElementById('spec-global-autocomplete');
  if (!box) return;

  if (!inputEl.isConnected || document.activeElement !== inputEl) {
    box.style.display='none';
    return;
  }
  const rect=inputEl.getBoundingClientRect();
  const width=Math.min(window.innerWidth-16,Math.max(rect.width,520));
  box.style.width=`${width}px`;
  box.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-width-8))}px`;
  box.style.top=`${Math.min(rect.bottom,window.innerHeight-80)}px`;

  if (!items.length) {
    box.innerHTML = '<div style="padding: 8px 10px; color: var(--text-muted); font-size: 11px;">Ничего не найдено</div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = '';
  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'spec-autocomplete-item';
    div.innerHTML = `
      <div style="flex: 1; overflow: hidden; padding-right: 8px;">
        <div style="font-weight: 500; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(item.name)}
        </div>
        <div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">
          Арт: <strong style="color:var(--accent-orange);">${escapeHtml(item.article)}</strong> · Вес: ${item.weight_g || ''} г · ${item.pcs_per_box} шт/кор · ${item.boxes_per_pallet || ''} кор/пал
        </div>
      </div>
      <div>
        <button class="btn btn-secondary btn-sm" style="font-size: 10px; padding: 2px 8px;">Выбрать</button>
      </div>
    `;
    div.onmousedown = (e) => {
      e.preventDefault();
      selectProductForSpecRow(idx, item);
    };
    box.appendChild(div);
  });
  box.style.display = 'block';
}

function selectProductForSpecRow(idx, item) {
  const box = document.getElementById('spec-global-autocomplete');
  if (box) box.style.display = 'none';

  specRows[idx].article = item.article;
  specRows[idx].name = item.name;
  specRows[idx].weight_g = item.weight_g;
  specRows[idx].barcode = item.barcode;
  specRows[idx].pcs_per_box = item.pcs_per_box || 1;
  specRows[idx].boxes_per_pallet = item.boxes_per_pallet;
  specRows[idx].boxes_per_row = item.boxes_per_row;
  specRows[idx].vat_rate = item.vat_rate ?? null;
  specRows[idx].supplier = item.supplier || '';
  if (item.suggested_price && (specRows[idx].price_no_vat === null || specRows[idx].price_no_vat === '')) {
    specRows[idx].price_no_vat = item.suggested_price;
  }
  specRows[idx].found = true;
  specRows[idx].loading = false;

  renderSpecGrid();

  // Переводим фокус на цену
  setTimeout(() => {
    const rowEl = document.querySelectorAll('#spec-tbody tr')[idx];
    if (rowEl) {
      const pInput = rowEl.querySelector('input[inputmode=decimal]');
      if (pInput) pInput.focus();
    }
  }, 50);
}

function handleNameKey(e, idx) {
  const box = document.getElementById('spec-global-autocomplete');
  if (e.key === 'Escape' && box) {
    box.style.display = 'none';
  }
}

// Закрываем автодополнение при клике вне
document.addEventListener('click', (e) => {
  if (!e.target.closest('#spec-global-autocomplete') && !e.target.closest('.cell-name-input')) {
    const box = document.getElementById('spec-global-autocomplete');
    if (box) box.style.display = 'none';
  }
});

function moveCursorToEnd(inputEl) {
  if (!inputEl) return;
  setTimeout(() => {
    try {
      const len = inputEl.value.length;
      inputEl.setSelectionRange(len, len);
    } catch (e) {}
  }, 0);
}

function handlePriceKey(e, idx, mode) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const inputEl = e.target;
    // Применяем форматирование
    if (mode === 'change') {
      onChangeNewPriceNoVatBlur(idx, inputEl);
    } else if (mode === 'change_with_vat') {
      onChangeNewPriceWithVatBlur(idx, inputEl);
    } else if (mode === 'load_with_vat') {
      onLoadPriceWithVatBlur(idx, inputEl);
    } else {
      onLoadPriceNoVatBlur(idx, inputEl);
    }
    // Если это последняя строка, добавляем новую и переводим фокус на ее артикул
    if (idx === specRows.length - 1) {
      addSpecRow();
    } else {
      // Иначе переходим на ввод цены или артикула следующей строки
      setTimeout(() => {
        const rows = document.querySelectorAll('#spec-tbody tr');
        if (rows[idx + 1]) {
          const nextArt = rows[idx + 1].querySelector('.cell-input-art');
          if (nextArt) nextArt.focus();
        }
      }, 50);
    }
  }
}

function handleArtKey(e, idx) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (idx === specRows.length - 1) {
      addSpecRow();
    } else {
      const inputs = document.querySelectorAll('.cell-input-art');
      if (inputs[idx + 1]) inputs[idx + 1].focus();
    }
  }
}

async function onArticleChange(idx, rawVal) {
  const art = rawVal.trim();
  specRows[idx].article = art;

  if (!art) {
    specRows[idx] = createEmptyRow();
    renderSpecGrid();
    return;
  }

  specRows[idx] = {...createEmptyRow(), article: art};
  specRows[idx].loading = true;
  renderSpecGrid();

  try {
    const res = await fetch(`${API_BASE}/api/specs/lookup?article=${encodeURIComponent(art)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.found) {
        specRows[idx].name = data.name;
        specRows[idx].weight_g = data.weight_g;
        specRows[idx].barcode = data.barcode;
        specRows[idx].pcs_per_box = data.pcs_per_box || 1;
        specRows[idx].boxes_per_pallet = data.boxes_per_pallet;
        specRows[idx].boxes_per_row = data.boxes_per_row;
        specRows[idx].vat_rate = data.vat_rate ?? null;
        specRows[idx].supplier = data.supplier || '';
        if (data.suggested_price && (specRows[idx].price_no_vat === null || specRows[idx].price_no_vat === '')) {
          specRows[idx].price_no_vat = data.suggested_price;
        }
        specRows[idx].found = true;
      } else {
        specRows[idx].name = '';
        specRows[idx].vat_rate = null;
        specRows[idx].found = false;
      }
    }
  } catch (e) {
    BoardUINotification.show({title:'Не удалось прочитать каталог',description:'Заполните строку вручную или повторите ввод артикула.',status:'error'});
  } finally {
    specRows[idx].loading = false;
    renderSpecGrid();
    // Переводим фокус на поле цены этой строки
    setTimeout(() => {
      const rowEl = document.querySelectorAll('#spec-tbody tr')[idx];
      if (rowEl) {
        const pInput = rowEl.querySelector('input[inputmode=decimal]');
        if (pInput) pInput.focus();
      }
    }, 50);
  }
}

function onLoadPriceNoVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  specRows[idx].price_no_vat = val;
  const vatRate = specRows[idx].vat_rate ?? null;
  const pcs = specRows[idx].pcs_per_box || 1;

  const withVatInput = document.getElementById(`row-p-with-vat-${idx}`);
  const boxWithVatEl = document.getElementById(`row-box-with-vat-${idx}`);
  const boxNoVatEl = document.getElementById(`row-box-no-vat-${idx}`);

  if (val !== null && vatRate !== null) {
    inputEl.classList.remove('field-required-empty');
    if (withVatInput) withVatInput.classList.remove('field-required-empty');
    const withVat = roundMoney(val * (1 + vatRate));
    specRows[idx].price_with_vat = withVat;
    if (withVatInput) withVatInput.value = formatRuNum(withVat, 2);
    if (boxWithVatEl) boxWithVatEl.textContent = formatRuNum(withVat * pcs, 2);
    if (boxNoVatEl) boxNoVatEl.textContent = formatRuNum(val * pcs, 2);
  } else {
    specRows[idx].price_with_vat = null;
    if (withVatInput) withVatInput.value = '';
    if (boxWithVatEl) boxWithVatEl.textContent = '';
    if (boxNoVatEl) boxNoVatEl.textContent = '';
    if (specRows[idx].article) {
      inputEl.classList.add('field-required-empty');
      if (withVatInput) withVatInput.classList.add('field-required-empty');
    }
  }
  checkSpecIncompleteWarning();
}

function onLoadPriceWithVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  specRows[idx].price_with_vat = val;
  const vatRate = specRows[idx].vat_rate ?? null;
  const pcs = specRows[idx].pcs_per_box || 1;

  const noVatInput = document.getElementById(`row-p-no-vat-${idx}`);
  const boxWithVatEl = document.getElementById(`row-box-with-vat-${idx}`);
  const boxNoVatEl = document.getElementById(`row-box-no-vat-${idx}`);

  if (val !== null && vatRate !== null) {
    inputEl.classList.remove('field-required-empty');
    if (noVatInput) noVatInput.classList.remove('field-required-empty');
    const noVat = roundMoney(val / (1 + vatRate));
    specRows[idx].price_no_vat = noVat;
    if (noVatInput) noVatInput.value = formatRuNum(noVat, 2);
    if (boxWithVatEl) boxWithVatEl.textContent = formatRuNum(val * pcs, 2);
    if (boxNoVatEl) boxNoVatEl.textContent = formatRuNum(noVat * pcs, 2);
  } else {
    specRows[idx].price_no_vat = null;
    if (noVatInput) noVatInput.value = '';
    if (boxWithVatEl) boxWithVatEl.textContent = '';
    if (boxNoVatEl) boxNoVatEl.textContent = '';
    if (specRows[idx].article) {
      inputEl.classList.add('field-required-empty');
      if (noVatInput) noVatInput.classList.add('field-required-empty');
    }
  }
  checkSpecIncompleteWarning();
}

function onLoadPriceNoVatBlur(idx, inputEl) {
  const val = specRows[idx].price_no_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onLoadPriceWithVatBlur(idx, inputEl) {
  const val = specRows[idx].price_with_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onChangeOldPriceNoVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  specRows[idx].price_no_vat = val;
  const vatRate = specRows[idx].vat_rate ?? null;
  const withVatInput = document.getElementById(`row-old-with-vat-${idx}`);
  if (val !== null && vatRate !== null) {
    inputEl.classList.remove('field-required-empty');
    if (withVatInput) withVatInput.classList.remove('field-required-empty');
    const withVat = roundMoney(val * (1 + vatRate));
    specRows[idx].old_price_with_vat = withVat;
    if (withVatInput) withVatInput.value = formatRuNum(withVat, 2);
  } else {
    specRows[idx].old_price_with_vat = null;
    if (withVatInput) withVatInput.value = '';
    if (specRows[idx].article) {
      inputEl.classList.add('field-required-empty');
      if (withVatInput) withVatInput.classList.add('field-required-empty');
    }
  }
  recalcChangeRow(idx);
}

function onChangeOldPriceWithVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  specRows[idx].old_price_with_vat = val;
  const vatRate = specRows[idx].vat_rate ?? null;
  const noVatInput = document.getElementById(`row-old-no-vat-${idx}`);
  if (val !== null && vatRate !== null) {
    inputEl.classList.remove('field-required-empty');
    if (noVatInput) noVatInput.classList.remove('field-required-empty');
    const noVat = roundMoney(val / (1 + vatRate));
    specRows[idx].price_no_vat = noVat;
    if (noVatInput) noVatInput.value = formatRuNum(noVat, 2);
  } else {
    specRows[idx].price_no_vat = null;
    if (noVatInput) noVatInput.value = '';
    if (specRows[idx].article) {
      inputEl.classList.add('field-required-empty');
      if (noVatInput) noVatInput.classList.add('field-required-empty');
    }
  }
  recalcChangeRow(idx);
}

function onChangeOldPriceNoVatBlur(idx, inputEl) {
  const val = specRows[idx].price_no_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onChangeOldPriceWithVatBlur(idx, inputEl) {
  const val = specRows[idx].old_price_with_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onChangeNewPriceNoVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  specRows[idx].new_price_no_vat = val;
  const vatRate = specRows[idx].vat_rate ?? null;
  const withVatInput = document.getElementById(`row-new-with-vat-${idx}`);
  if (val !== null && vatRate !== null) {
    inputEl.classList.remove('field-required-empty');
    if (withVatInput) withVatInput.classList.remove('field-required-empty');
    const withVat = roundMoney(val * (1 + vatRate));
    specRows[idx].new_price_with_vat = withVat;
    if (withVatInput) withVatInput.value = formatRuNum(withVat, 2);
  } else {
    specRows[idx].new_price_with_vat = null;
    if (withVatInput) withVatInput.value = '';
    if (specRows[idx].article) {
      inputEl.classList.add('field-required-empty');
      if (withVatInput) withVatInput.classList.add('field-required-empty');
    }
  }
  recalcChangeRow(idx);
  checkSpecIncompleteWarning();
}

function onChangeNewPriceWithVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  specRows[idx].new_price_with_vat = val;
  const vatRate = specRows[idx].vat_rate ?? null;
  const noVatInput = document.getElementById(`row-new-no-vat-${idx}`);
  if (val !== null && vatRate !== null) {
    inputEl.classList.remove('field-required-empty');
    if (noVatInput) noVatInput.classList.remove('field-required-empty');
    const noVat = roundMoney(val / (1 + vatRate));
    specRows[idx].new_price_no_vat = noVat;
    if (noVatInput) noVatInput.value = formatRuNum(noVat, 2);
  } else {
    specRows[idx].new_price_no_vat = null;
    if (noVatInput) noVatInput.value = '';
    if (specRows[idx].article) {
      inputEl.classList.add('field-required-empty');
      if (noVatInput) noVatInput.classList.add('field-required-empty');
    }
  }
  recalcChangeRow(idx);
  checkSpecIncompleteWarning();
}

function onChangeNewPriceNoVatBlur(idx, inputEl) {
  const val = specRows[idx].new_price_no_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onChangeNewPriceWithVatBlur(idx, inputEl) {
  const val = specRows[idx].new_price_with_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

// Алиасы для обратной совместимости
function onLoadPriceInput(idx, inputEl) { onLoadPriceNoVatInput(idx, inputEl); }
function onLoadPriceBlur(idx, inputEl) { onLoadPriceNoVatBlur(idx, inputEl); }
function onChangeOldPriceInput(idx, inputEl) { onChangeOldPriceNoVatInput(idx, inputEl); }
function onChangeOldPriceBlur(idx, inputEl) { onChangeOldPriceNoVatBlur(idx, inputEl); }
function onChangeNewPriceInput(idx, inputEl) { onChangeNewPriceNoVatInput(idx, inputEl); }
function onChangeNewPriceBlur(idx, inputEl) { onChangeNewPriceNoVatBlur(idx, inputEl); }

function recalcChangeRow(idx) {
  const oldP = specRows[idx].price_no_vat;
  const oldWithVatP = specRows[idx].old_price_with_vat;
  const newP = specRows[idx].new_price_no_vat;
  const newWithVatP = specRows[idx].new_price_with_vat;
  const vatRate = specRows[idx].vat_rate ?? null;
  const pcs = specRows[idx].pcs_per_box || 1;

  const oldBoxWithVatEl = document.getElementById(`row-old-box-with-vat-${idx}`);
  const oldBoxNoVatEl = document.getElementById(`row-old-box-no-vat-${idx}`);
  const newBoxWithVatEl = document.getElementById(`row-new-box-with-vat-${idx}`);
  const newBoxNoVatEl = document.getElementById(`row-new-box-no-vat-${idx}`);
  const diffEl = document.getElementById(`row-diff-pct-${idx}`);

  if (oldP !== null && oldP !== undefined) {
    const withVat = oldWithVatP !== null && oldWithVatP !== undefined ? oldWithVatP : roundMoney(oldP * (1 + vatRate));
    if (oldBoxWithVatEl) oldBoxWithVatEl.textContent = formatRuNum(withVat * pcs, 2);
    if (oldBoxNoVatEl) oldBoxNoVatEl.textContent = formatRuNum(oldP * pcs, 2);
  } else {
    if (oldBoxWithVatEl) oldBoxWithVatEl.textContent = '';
    if (oldBoxNoVatEl) oldBoxNoVatEl.textContent = '';
  }

  if (newP !== null && newP !== undefined) {
    const withVat = newWithVatP !== null && newWithVatP !== undefined ? newWithVatP : roundMoney(newP * (1 + vatRate));
    if (newBoxWithVatEl) newBoxWithVatEl.textContent = formatRuNum(withVat * pcs, 2);
    if (newBoxNoVatEl) newBoxNoVatEl.textContent = formatRuNum(newP * pcs, 2);
  } else {
    if (newBoxWithVatEl) newBoxWithVatEl.textContent = '';
    if (newBoxNoVatEl) newBoxNoVatEl.textContent = '';
  }

  if (oldP && newP && Number(oldP) > 0) {
    const d = ((Number(newP) - Number(oldP)) / Number(oldP)) * 100;
    if (diffEl) {
      diffEl.textContent = `${d > 0 ? '+' : ''}${formatRuNum(d, 1)}%`;
      diffEl.style.color = d > 0 ? 'var(--status-red)' : 'var(--status-green)';
    }
  } else {
    if (diffEl) diffEl.textContent = '';
  }
  updateTotals();
}

/* ========================================================================= */
/* БЫСТРАЯ ВСТАВКА СПИСКА АРТИКУЛОВ                                          */
/* ========================================================================= */

function openBatchPasteModal() {
  document.getElementById('batch-paste-modal').showModal();
  document.getElementById('batch-articles-textarea').focus();
}

function closeBatchPasteModal() {
  document.getElementById('batch-paste-modal').close();
  document.getElementById('batch-articles-textarea').value = '';
}

async function applyBatchArticles() {
  const text = document.getElementById('batch-articles-textarea').value.trim();
  if (!text) {
    closeBatchPasteModal();
    return;
  }

  const res = await fetch(`${API_BASE}/api/specs/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Panel-Request':'1' },
    body: JSON.stringify({ raw_text: text })
  });

  if (!res.ok) {
    alert('Ошибка при разборе списка артикулов');
    return;
  }

  const items = await res.json();
  // Заменяем текущие пустые строки на распознанные позиции
  specRows = items.map(item => ({
    article: item.article,
    name: item.name,
    weight_g: item.weight_g,
    barcode: item.barcode,
    pcs_per_box: item.pcs_per_box || 1,
    boxes_per_pallet: item.boxes_per_pallet,
    boxes_per_row: item.boxes_per_row,
    vat_rate: item.vat_rate ?? null,
    price_no_vat: item.price_no_vat,
    old_price_no_vat: item.price_no_vat,
    new_price_no_vat: null,
    found: item.found,
    loading: false
  }));

  closeBatchPasteModal();
  renderSpecGrid();
}

async function downloadSpecFile() {
  const problem = getSpecIncompleteDetails();
  if (problem) return notifyProblem(problem);
  await downloadExport('/api/specs/generate', {
    spec_type:specMode, items:specRows.filter(specStarted).map(r=>({...r,price_with_vat:specMode==='change'?(r.old_price_with_vat ?? null):r.price_with_vat})),
    meta:{supplier:document.getElementById('meta-supplier').value,
          contract:document.getElementById('meta-contract').value,
          spec_num_date:document.getElementById('meta-spec-date').value}
  }, 'btn-download-spec');
}

/* ========================================================================= */
/* РАЗДЕЛ 2: КП И ОКК                                                       */
/* ========================================================================= */

function initInitialKpRows() {
  kpRows = [];
  for (let i = 0; i < 5; i++) {
    kpRows.push(createEmptyKpRow());
  }
}

function createEmptyKpRow() {
  return {
    name: '',
    manufacturer: '',
    weight_g: null,
    pcs_per_box: null,       // В КП Шт/Кор изначально пустое
    vat_rate: null,          // Изначально ставка пустая
    price_sale_no_vat: null, // Цена продажи/шт без НДС (ввод)
    price_sale_with_vat: null, // Цена продажи/шт с НДС (ввод)
    cost_with_vat: null,     // Себес с НДС (ввод)
    markup_pct: null,        // Желаемая наценка % (ввод/расчет)
  };
}

function addKpRow() {
  kpRows.push(createEmptyKpRow());
  renderKpGrid();
  setTimeout(() => {
    const rows = document.querySelectorAll('#kp-tbody tr');
    if (rows.length) {
      const lastInput = rows[rows.length - 1].querySelector('.cell-name-input');
      if (lastInput) lastInput.focus();
    }
  }, 50);
}

function removeKpRow(idx) {
  if (kpRows.length <= 1) {
    kpRows[0] = createEmptyKpRow();
  } else {
    kpRows.splice(idx, 1);
  }
  renderKpGrid();
}

function getKpIncompleteDetails() {
  return validateGrid(kpRows, 'kp', document.getElementById('kp-meta-supplier'));
}

function checkKpIncompleteWarning() {
  updateTotals();
}

function renderKpGrid() {
  const tbody = document.getElementById('kp-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  kpRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.rowIdx = idx;
    const pcs = row.pcs_per_box;
    const hasVat = (row.vat_rate !== null && row.vat_rate !== undefined);
    const vatRate = hasVat ? row.vat_rate : null;

    const pSaleNoVat = row.price_sale_no_vat;
    const pSaleWithVat = row.price_sale_with_vat;

    const boxNoVat = (pSaleNoVat !== null && pSaleNoVat !== undefined && pcs) ? pSaleNoVat * pcs : null;
    const boxWithVat = (pSaleWithVat !== null && pSaleWithVat !== undefined && pcs) ? pSaleWithVat * pcs : null;

    const priceSaleNoVatStr = (pSaleNoVat !== null && pSaleNoVat !== undefined) ? formatRuNum(pSaleNoVat, 2) : '';
    const priceSaleWithVatStr = (pSaleWithVat !== null && pSaleWithVat !== undefined) ? formatRuNum(pSaleWithVat, 2) : '';
    const boxNoVatStr = boxNoVat !== null ? formatRuNum(boxNoVat, 2) : '';
    const boxWithVatStr = boxWithVat !== null ? formatRuNum(boxWithVat, 2) : '';

    const costVatDisplay = (row.cost_with_vat !== null && row.cost_with_vat !== undefined) ? formatRuNum(row.cost_with_vat, 2) : '';

    let markupStr = '';
    let markupColor = 'var(--text-subtle)';
    if (pSaleWithVat !== null && row.cost_with_vat !== null && row.cost_with_vat > 0) {
      const diff = ((pSaleWithVat - row.cost_with_vat) / row.cost_with_vat) * 100;
      markupStr = formatRuNum(diff, 1);
      markupColor = diff >= 0 ? 'var(--status-green)' : 'var(--status-red)';
    } else if (row.markup_pct !== null && row.markup_pct !== undefined) {
      markupStr = formatRuNum(row.markup_pct, 1);
      markupColor = row.markup_pct >= 0 ? 'var(--status-green)' : 'var(--status-red)';
    }

    const priceEmptyClass = (row.name && row.name.trim() && (pSaleNoVat === null || pSaleNoVat === '')) ? 'field-required-empty' : '';
    const costEmptyClass = (row.name && row.name.trim() && (row.cost_with_vat === null || row.cost_with_vat === '')) ? 'field-required-empty' : '';

    // BoardUI Select триггер для ставки НДС
    const vatText = hasVat ? (Math.round(vatRate * 100) + '%') : '—';
    const vatEmptyClass = (!hasVat && (row.name || pSaleNoVat !== null)) ? 'empty field-required-empty' : (hasVat ? '' : 'empty');

    tr.innerHTML = `
      <td class="row-idx" style="width: 28px;">${idx + 1}</td>
      <td class="cell-draggable" style="position: relative; min-width: 220px;" data-col="name" data-row-idx="${idx}">
        <input type="text" class="cell-input cell-name-input" style="width: 100%;"
               value="${escapeHtml(row.name || '')}"
               placeholder="введите наименование"
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               oninput="onKpNameInput(${idx}, this)"
               onkeydown="handleKpNameKey(event, ${idx})">
        <div class="autofill-handle" title="Потяните вниз или вверх, чтобы скопировать наименование" onmousedown="startAutoFill(event, ${idx}, 'name')" ontouchstart="startAutoFill(event, ${idx}, 'name')"></div>
      </td>
      <td class="cell-draggable" style="width: 130px;" data-col="manufacturer" data-row-idx="${idx}">
        <input type="text" class="cell-input" style="width: 100%;"
               value="${escapeHtml(row.manufacturer || '')}"
               placeholder="производитель"
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               oninput="onKpFieldChange(${idx}, 'manufacturer', this.value)">
        <div class="autofill-handle" title="Потяните вниз или вверх, чтобы скопировать производителя" onmousedown="startAutoFill(event, ${idx}, 'manufacturer')" ontouchstart="startAutoFill(event, ${idx}, 'manufacturer')"></div>
      </td>
      <td class="cell-draggable" style="width: 60px;" data-col="weight_g" data-row-idx="${idx}">
        <input type="text" inputmode="decimal" class="cell-input mono cell-center"
               value="${row.weight_g !== null && row.weight_g !== undefined ? row.weight_g : ''}"
               placeholder=""
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               oninput="onKpNumChange(${idx}, 'weight_g', this.value)">
        <div class="autofill-handle" title="Потяните вниз или вверх, чтобы скопировать вес" onmousedown="startAutoFill(event, ${idx}, 'weight_g')" ontouchstart="startAutoFill(event, ${idx}, 'weight_g')"></div>
      </td>
      <td class="cell-draggable" style="width: 50px;" data-col="pcs_per_box" data-row-idx="${idx}">
        <input type="text" inputmode="decimal" class="cell-input mono cell-center"
               value="${row.pcs_per_box !== null && row.pcs_per_box !== undefined ? row.pcs_per_box : ''}"
               placeholder=""
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               oninput="onKpNumChange(${idx}, 'pcs_per_box', this.value)">
        <div class="autofill-handle" title="Потяните вниз или вверх, чтобы скопировать шт/кор" onmousedown="startAutoFill(event, ${idx}, 'pcs_per_box')" ontouchstart="startAutoFill(event, ${idx}, 'pcs_per_box')"></div>
      </td>
      <td class="cell-center">${vatSelect(idx, vatRate, "kp")}</td>
      <td style="width: 105px;">
        <input type="text" inputmode="decimal" class="cell-input cell-kp-price-vat mono" style="text-align: right;"
               value="${priceSaleWithVatStr}" placeholder=""
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               onfocus="moveCursorToEnd(this)"
               onmouseup="moveCursorToEnd(this)"
               oninput="onKpPriceSaleWithVatInput(${idx}, this)"
               onblur="onKpPriceSaleWithVatBlur(${idx}, this)"
               onkeydown="handleKpPriceKey(event, ${idx}, 'price_sale_with_vat')">
      </td>
      <td style="width: 105px;">
        <input type="text" inputmode="decimal" class="cell-input cell-kp-price mono ${priceEmptyClass}" style="text-align: right;"
               value="${priceSaleNoVatStr}" placeholder=""
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               onfocus="moveCursorToEnd(this)"
               onmouseup="moveCursorToEnd(this)"
               oninput="onKpPriceSaleNoVatInput(${idx}, this)"
               onblur="onKpPriceSaleNoVatBlur(${idx}, this)"
               onkeydown="handleKpPriceKey(event, ${idx}, 'price_sale_no_vat')">
      </td>
      <td class="cell-formula" id="kp-box-with-vat-${idx}" style="width: 105px;">${boxWithVatStr}</td>
      <td class="cell-formula" id="kp-box-no-vat-${idx}" style="width: 105px;">${boxNoVatStr}</td>
      <td style="width: 95px;">
        <input type="text" inputmode="decimal" class="cell-input cell-kp-cost mono ${costEmptyClass}" style="text-align: right;"
               value="${costVatDisplay}" placeholder=""
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               onfocus="moveCursorToEnd(this)"
               onmouseup="moveCursorToEnd(this)"
               oninput="onKpCostVatInput(${idx}, this)"
               onblur="onKpCostVatBlur(${idx}, this)"
               onkeydown="handleKpPriceKey(event, ${idx}, 'cost_with_vat')">
      </td>
      <td style="width: 85px;">
        <input type="text" inputmode="decimal" class="cell-input cell-kp-markup mono" id="kp-markup-${idx}"
               style="text-align: center; font-weight: 600; color: ${markupColor};"
               value="${markupStr}" placeholder="—"
               autocomplete="off"
               autocorrect="off"
               autocapitalize="off"
               spellcheck="false"
               data-lpignore="true"
               onfocus="moveCursorToEnd(this)"
               onmouseup="moveCursorToEnd(this)"
               oninput="onKpMarkupInput(${idx}, this)"
               onblur="onKpMarkupBlur(${idx}, this)"
               onkeydown="handleKpPriceKey(event, ${idx}, 'markup')">
      </td>
      <td style="text-align: center; width: 28px;">
        <button class="btn btn-secondary btn-sm" onclick="removeKpRow(${idx})" title="Удалить позицию">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  labelGrid('kp-tbody','kp-thead');
  checkKpIncompleteWarning();
}

function onKpFieldChange(idx, field, val) {
  kpRows[idx][field] = val;
  checkKpIncompleteWarning();
}

function onKpNumChange(idx, field, val) {
  const num = parseRuNum(val);
  kpRows[idx][field] = num;
  recalcKpRow(idx);
  checkKpIncompleteWarning();
}

function onKpVatChange(idx, val) {
  kpRows[idx].vat_rate = val === '' ? null : Number(val);
  recalcKpRow(idx, 'vat_change');
  renderKpGrid();
}

function onKpPriceSaleNoVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  kpRows[idx].price_sale_no_vat = val;
  if (val !== null) {
    inputEl.classList.remove('field-required-empty');
  }

  // Если ставка НДС уже указана — автоматически вычисляем цену с НДС
  const hasVat = (kpRows[idx].vat_rate !== null && kpRows[idx].vat_rate !== undefined);
  if (hasVat && val !== null) {
    kpRows[idx].price_sale_with_vat = roundMoney(val * (1 + kpRows[idx].vat_rate));
  } else {
    kpRows[idx].price_sale_with_vat = null;
  }
  // При ручном вводе цены сбрасываем зафиксированную желаемую наценку
  kpRows[idx].markup_pct = null;
  recalcKpRow(idx, 'from_no_vat');
  checkKpIncompleteWarning();
}

function onKpPriceSaleNoVatBlur(idx, inputEl) {
  const val = kpRows[idx].price_sale_no_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onKpPriceSaleWithVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  kpRows[idx].price_sale_with_vat = val;

  // Если ставка НДС указана — автоматически вычисляем цену без НДС
  const hasVat = (kpRows[idx].vat_rate !== null && kpRows[idx].vat_rate !== undefined);
  if (hasVat && val !== null) {
    kpRows[idx].price_sale_no_vat = roundMoney(val / (1 + kpRows[idx].vat_rate));
  } else {
    kpRows[idx].price_sale_no_vat = null;
  }
  // При ручном вводе цены сбрасываем зафиксированную желаемую наценку
  kpRows[idx].markup_pct = null;
  recalcKpRow(idx, 'from_with_vat');
  checkKpIncompleteWarning();
}

function onKpPriceSaleWithVatBlur(idx, inputEl) {
  const val = kpRows[idx].price_sale_with_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onKpCostVatInput(idx, inputEl) {
  const val = parsePrice(inputEl.value);
  kpRows[idx].cost_with_vat = val;
  if (val !== null) {
    inputEl.classList.remove('field-required-empty');
  }

  // Если уже задана желаемая наценка — автоматически рассчитываем отпускную цену
  if (val !== null && val > 0 && kpRows[idx].markup_pct !== null && kpRows[idx].markup_pct !== undefined) {
    const newPriceWithVat = roundMoney(val * (1 + kpRows[idx].markup_pct / 100.0));
    kpRows[idx].price_sale_with_vat = newPriceWithVat;
    const hasVat = (kpRows[idx].vat_rate !== null && kpRows[idx].vat_rate !== undefined);
    if (hasVat) {
      kpRows[idx].price_sale_no_vat = roundMoney(newPriceWithVat / (1 + kpRows[idx].vat_rate));
    }
    recalcKpRow(idx, 'from_markup');
  } else {
    recalcKpRow(idx, 'from_cost');
  }
  checkKpIncompleteWarning();
}

function onKpCostVatBlur(idx, inputEl) {
  const val = kpRows[idx].cost_with_vat;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 2);
  }
}

function onKpMarkupInput(idx, inputEl) {
  const val = parseRuNum(inputEl.value);
  kpRows[idx].markup_pct = val;

  const cost = kpRows[idx].cost_with_vat;
  if (cost !== null && cost > 0 && val !== null) {
    // Отпускная цена с НДС = Себестоимость с НДС * (1 + Наценка / 100)
    const newPriceWithVat = roundMoney(cost * (1 + val / 100.0));
    kpRows[idx].price_sale_with_vat = newPriceWithVat;

    const hasVat = (kpRows[idx].vat_rate !== null && kpRows[idx].vat_rate !== undefined);
    if (hasVat) {
      kpRows[idx].price_sale_no_vat = roundMoney(newPriceWithVat / (1 + kpRows[idx].vat_rate));
    }
    recalcKpRow(idx, 'from_markup');
  } else if (!cost && val !== null) {
    const rowEl = document.querySelectorAll('#kp-tbody tr')[idx];
    if (rowEl) {
      const costInput = rowEl.querySelector('.cell-kp-cost');
      if (costInput) costInput.focus();
    }
  } else {
    recalcKpRow(idx, 'from_markup');
  }
  checkKpIncompleteWarning();
}

function onKpMarkupBlur(idx, inputEl) {
  const val = kpRows[idx].markup_pct;
  if (val !== null && val !== undefined) {
    inputEl.value = formatRuNum(val, 1);
  } else {
    const row = kpRows[idx];
    if (row.price_sale_with_vat !== null && row.cost_with_vat !== null && row.cost_with_vat > 0) {
      const diff = ((row.price_sale_with_vat - row.cost_with_vat) / row.cost_with_vat) * 100;
      inputEl.value = formatRuNum(diff, 1);
    } else {
      inputEl.value = '';
    }
  }
}

function recalcKpRow(idx, triggerSource = null) {
  const row = kpRows[idx];
  const pcs = row.pcs_per_box;
  const hasVat = (row.vat_rate !== null && row.vat_rate !== undefined);
  const vatRate = hasVat ? row.vat_rate : null;
  if (!hasVat && triggerSource === 'vat_change') row.price_sale_with_vat = null;

  // Синхронизация цен при смене НДС или кванта
  if (hasVat) {
    if (triggerSource === 'vat_change') {
      if (row.price_sale_no_vat !== null) {
        row.price_sale_with_vat = roundMoney(row.price_sale_no_vat * (1 + vatRate));
      } else if (row.price_sale_with_vat !== null) {
        row.price_sale_no_vat = roundMoney(row.price_sale_with_vat / (1 + vatRate));
      }
    }
  }

  const pSaleNoVat = row.price_sale_no_vat;
  const pSaleWithVat = row.price_sale_with_vat;

  // Обновляем инпуты цен, если они изменились в результате пересчёта
  const rowEl = document.querySelectorAll('#kp-tbody tr')[idx];
  if (rowEl) {
    const inputNoVat = rowEl.querySelector('.cell-kp-price');
    const inputWithVat = rowEl.querySelector('.cell-kp-price-vat');
    const inputMarkup = rowEl.querySelector('.cell-kp-markup');

    if (triggerSource === 'from_with_vat' && inputNoVat) {
      inputNoVat.value = formatRuNum(pSaleNoVat, 2);
      inputNoVat.classList.remove('field-required-empty');
    }
    if (triggerSource === 'from_no_vat' && inputWithVat) {
      inputWithVat.value = formatRuNum(pSaleWithVat, 2);
    }
    if (triggerSource === 'from_markup') {
      if (inputNoVat && pSaleNoVat !== null) {
        inputNoVat.value = formatRuNum(pSaleNoVat, 2);
        inputNoVat.classList.remove('field-required-empty');
      }
      if (inputWithVat && pSaleWithVat !== null) {
        inputWithVat.value = formatRuNum(pSaleWithVat, 2);
      }
    }
    if (triggerSource === 'vat_change') {
      if (inputNoVat && pSaleNoVat !== null) inputNoVat.value = formatRuNum(pSaleNoVat, 2);
      if (inputWithVat && pSaleWithVat !== null) inputWithVat.value = formatRuNum(pSaleWithVat, 2);
    }
  }

  const boxNoVatEl = document.getElementById(`kp-box-no-vat-${idx}`);
  const boxWithVatEl = document.getElementById(`kp-box-with-vat-${idx}`);
  const markupInputEl = document.getElementById(`kp-markup-${idx}`);

  if (pSaleNoVat !== null && pSaleNoVat !== undefined && pcs) {
    if (boxNoVatEl) boxNoVatEl.textContent = formatRuNum(pSaleNoVat * pcs, 2);
  } else {
    if (boxNoVatEl) boxNoVatEl.textContent = '';
  }

  if (pSaleWithVat !== null && pSaleWithVat !== undefined && pcs) {
    if (boxWithVatEl) boxWithVatEl.textContent = formatRuNum(pSaleWithVat * pcs, 2);
  } else {
    if (boxWithVatEl) boxWithVatEl.textContent = '';
  }

  if (markupInputEl) {
    if (pSaleWithVat !== null && row.cost_with_vat !== null && row.cost_with_vat > 0) {
      const diff = ((pSaleWithVat - row.cost_with_vat) / row.cost_with_vat) * 100;
      if (triggerSource !== 'from_markup') {
        markupInputEl.value = formatRuNum(diff, 1);
        row.markup_pct = diff;
      }
      markupInputEl.style.color = diff >= 0 ? 'var(--status-green)' : 'var(--status-red)';
    } else if (row.markup_pct !== null && row.markup_pct !== undefined) {
      if (triggerSource !== 'from_markup') {
        markupInputEl.value = formatRuNum(row.markup_pct, 1);
      }
      markupInputEl.style.color = row.markup_pct >= 0 ? 'var(--status-green)' : 'var(--status-red)';
    } else {
      if (triggerSource !== 'from_markup') {
        markupInputEl.value = '';
      }
      markupInputEl.style.color = 'var(--text-subtle)';
    }
  }
  updateTotals();
}

function handleKpPriceKey(e, idx, field) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const inputEl = e.target;
    if (field === 'price_sale_no_vat') {
      onKpPriceSaleNoVatBlur(idx, inputEl);
    } else if (field === 'price_sale_with_vat') {
      onKpPriceSaleWithVatBlur(idx, inputEl);
    } else if (field === 'markup') {
      onKpMarkupBlur(idx, inputEl);
    } else {
      onKpCostVatBlur(idx, inputEl);
    }

    if (idx === kpRows.length - 1) {
      addKpRow();
    } else {
      setTimeout(() => {
        const rows = document.querySelectorAll('#kp-tbody tr');
        if (rows[idx + 1]) {
          const nextPrice = rows[idx + 1].querySelector('.cell-kp-price');
          if (nextPrice) {
            nextPrice.focus();
            moveCursorToEnd(nextPrice);
          }
        }
      }, 50);
    }
  }
}

/* ========================================================================= */
/* ПРОТЯГИВАНИЕ ЗНАЧЕНИЙ (AUTOFILL HANDLE) КАК В EXCEL                      */
/* ========================================================================= */

let autoFillState = null;

function startAutoFill(e, sourceRowIdx, field) {
  e.preventDefault();
  e.stopPropagation();

  const sourceVal = kpRows[sourceRowIdx][field];
  autoFillState = {
    sourceRowIdx,
    targetRowIdx: sourceRowIdx,
    field,
    sourceVal,
  };

  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'crosshair';

  window.addEventListener('mousemove', onAutoFillMouseMove);
  window.addEventListener('mouseup', onAutoFillMouseUp);
  window.addEventListener('touchmove', onAutoFillMouseMove, { passive: false });
  window.addEventListener('touchend', onAutoFillMouseUp);
}

function onAutoFillMouseMove(e) {
  if (!autoFillState) return;

  const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
  if (clientY === undefined) return;

  // Ищем строку по вертикальной координате курсора относительно строк таблицы
  const rows = document.querySelectorAll('#kp-tbody tr');
  if (!rows.length) return;

  let foundIdx = null;
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      foundIdx = parseInt(r.dataset.rowIdx, 10);
      break;
    }
  }

  // Если мышь выше первой строки
  if (foundIdx === null && clientY < rows[0].getBoundingClientRect().top) {
    foundIdx = 0;
  }
  // Если мышь ниже последней строки
  if (foundIdx === null && clientY > rows[rows.length - 1].getBoundingClientRect().bottom) {
    foundIdx = rows.length - 1;
  }

  if (foundIdx !== null && !isNaN(foundIdx)) {
    autoFillState.targetRowIdx = foundIdx;
    highlightAutoFillRange();
  }
}

function highlightAutoFillRange() {
  if (!autoFillState) return;
  const { sourceRowIdx, targetRowIdx, field } = autoFillState;
  const minIdx = Math.min(sourceRowIdx, targetRowIdx);
  const maxIdx = Math.max(sourceRowIdx, targetRowIdx);

  const allCells = document.querySelectorAll(`td[data-col="${field}"]`);
  allCells.forEach(cell => {
    const rIdx = parseInt(cell.dataset.rowIdx, 10);
    if (rIdx >= minIdx && rIdx <= maxIdx) {
      cell.classList.add('cell-drag-selected');
    } else {
      cell.classList.remove('cell-drag-selected');
    }
  });
}

function onAutoFillMouseUp() {
  if (!autoFillState) return;

  window.removeEventListener('mousemove', onAutoFillMouseMove);
  window.removeEventListener('mouseup', onAutoFillMouseUp);
  window.removeEventListener('touchmove', onAutoFillMouseMove);
  window.removeEventListener('touchend', onAutoFillMouseUp);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  const { sourceRowIdx, targetRowIdx, field, sourceVal } = autoFillState;
  const minIdx = Math.min(sourceRowIdx, targetRowIdx);
  const maxIdx = Math.max(sourceRowIdx, targetRowIdx);

  // Очищаем подсветку
  const allCells = document.querySelectorAll(`td[data-col="${field}"]`);
  allCells.forEach(cell => cell.classList.remove('cell-drag-selected'));

  autoFillState = null;

  if (minIdx === maxIdx) return;

  for (let r = minIdx; r <= maxIdx; r++) {
    kpRows[r][field] = sourceVal;
    if (field === 'vat_rate') {
      recalcKpRow(r, 'vat_change');
    }
  }

  renderKpGrid();

  const colNames = {
    name: '«Наименование»',
    manufacturer: '«Производитель»',
    weight_g: '«Вес, г»',
    pcs_per_box: '«Шт/Кор»',
    vat_rate: '«Ставка НДС»',
  };
  const label = colNames[field] || `«${field}»`;
  BoardUINotification.show({
    title: 'Значение скопировано',
    description: `Поле ${label} протянуто на строки ${minIdx + 1}–${maxIdx + 1}`,
    status: 'success',
  });
}

function handleKpNameKey(e, idx) {
  const box = document.getElementById('spec-global-autocomplete');
  if (e.key === 'Escape' && box) {
    box.style.display = 'none';
  }
}

function selectProductForKpRow(idx, item) {
  const box = document.getElementById('spec-global-autocomplete');
  if (box) box.style.display = 'none';

  kpRows[idx].name = item.name;
  kpRows[idx].manufacturer = item.supplier || '';
  kpRows[idx].weight_g = item.weight_g;
  kpRows[idx].pcs_per_box = item.pcs_per_box || null;
  kpRows[idx].vat_rate = item.vat_rate ?? null;
  if (item.suggested_price) {
    const vat = item.vat_rate ?? null;
    kpRows[idx].cost_with_vat = roundMoney(item.suggested_price * (1 + vat));
  }
  renderKpGrid();

  setTimeout(() => {
    const rows = document.querySelectorAll('#kp-tbody tr');
    if (rows[idx]) {
      const pInput = rows[idx].querySelector('input.cell-kp-price');
      if (pInput) {
        pInput.focus();
        moveCursorToEnd(pInput);
      }
    }
  }, 50);
}

async function downloadKpExcel() { await downloadKp('/api/kp/generate-excel','btn-download-kp-excel'); }
async function downloadOkkDocx() { await downloadKp('/api/kp/generate-docx','btn-download-kp-docx'); }
async function downloadKp(path, button) {
  const problem=getKpIncompleteDetails();
  if (problem) return notifyProblem(problem);
  await downloadExport(path,{items:kpRows.filter(kpStarted),meta:{
    supplier:document.getElementById('kp-meta-supplier').value,
    date:document.getElementById('kp-meta-date').value}},button);
}

/* ========================================================================= */
/* BOARDUI NOTIFICATION COMPONENT (Floating message / toast)                 */
/* ========================================================================= */

const BoardUINotification = {
  show({ title, description, status = 'information', timestamp = '', duration = 4500 }) {
    const viewport = document.getElementById('boardui-notification-viewport');
    if (!viewport) return null;

    const card = document.createElement('div');
    card.className = 'boardui-notification-card';
    card.setAttribute('role', status === 'error' ? 'alert' : 'status');

    let iconSvg = '';
    if (status === 'warning') {
      iconSvg = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
      `;
    } else if (status === 'error') {
      iconSvg = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
        </svg>
      `;
    } else {
      iconSvg = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      `;
    }

    card.innerHTML = `
      <span class="boardui-notification-visual status-${status}">
        ${iconSvg}
      </span>
      <div class="boardui-notification-content">
        <div class="boardui-notification-header">
          <p class="boardui-notification-title">${escapeHtml(title)}</p>
          ${timestamp ? `<span class="boardui-notification-timestamp">${escapeHtml(timestamp)}</span>` : ''}
        </div>
        ${description ? `<p class="boardui-notification-desc">${escapeHtml(description)}</p>` : ''}
      </div>
      <button class="boardui-notification-close" title="Закрыть" aria-label="Закрыть">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      ${duration > 0 ? '<span class="boardui-notification-progress"></span>' : ''}
    `;

    card.querySelector('.boardui-notification-close').onclick = () => dismiss();

    function dismiss() {
      card.classList.remove('is-visible');
      card.classList.add('is-leaving');
      setTimeout(() => card.remove(), 200);
    }

    viewport.appendChild(card);
    requestAnimationFrame(() => {
      card.classList.add('is-visible');
    });

    if (duration > 0) {
      setTimeout(() => {
        dismiss();
      }, duration);
    }
    return card;
  }
};



/* Source-only demo adaptation: manual fields and a single download transport. */
function labelGrid(tbodyId, theadId) {
  const headers=[...document.getElementById(theadId).querySelectorAll('th')].map(el=>el.textContent.replace(/\s+/g,' ').trim());
  document.getElementById(tbodyId).querySelectorAll('tr').forEach((row,index)=>{
    [...row.cells].forEach((cell,col)=>cell.querySelectorAll('input,select,button').forEach(control=>{
      if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label',`${headers[col] || control.title || 'Удалить'}, строка ${index+1}`);
    }));
  });
}
function positive(n) { return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1000000000; }
function validVat(v) { return [0, 0.1, 0.2, 0.22].includes(v); }
function specStarted(r) {
  return Boolean(r.article || r.name || r.barcode || r.weight_g !== null || r.boxes_per_pallet !== null ||
    r.boxes_per_row !== null || r.vat_rate !== null || r.pcs_per_box !== 1 ||
    r.price_no_vat !== null || r.price_with_vat != null || r.new_price_no_vat !== null);
}
function kpStarted(r) {
  return Boolean(r.name || r.manufacturer || r.weight_g !== null || r.pcs_per_box !== null ||
    r.vat_rate !== null || r.price_sale_no_vat !== null || r.price_sale_with_vat !== null || r.cost_with_vat !== null);
}
function validateGrid(rows, kind, supplier) {
  if (!(supplier?.value || '').trim()) {
    supplier?.classList.add('field-required-empty'); supplier?.focus();
    return 'Укажите поставщика свободным вводом перед скачиванием.';
  }
  const active = rows.filter(kind === 'spec' ? specStarted : kpStarted);
  if (!active.length) return 'Заполните хотя бы одну строку.';
  if (active.length > 500) return 'Не более 500 строк. Разделите документ; строки не обрезаются.';
  for (const [idx, row] of rows.entries()) {
    if (!(kind === 'spec' ? specStarted(row) : kpStarted(row))) continue;
    const missing = [];
    if (!(row.name || '').trim()) missing.push('наименование');
    if (kind === 'spec' && !(row.article || '').trim()) missing.push('артикул');
    if (!validVat(row.vat_rate)) missing.push('НДС (0, 10, 20 или 22%)');
    if (!Number.isInteger(row.pcs_per_box) || !positive(row.pcs_per_box)) missing.push('положительное целое Шт/Кор');
    if (!positive(kind === 'spec' ? row.price_no_vat : row.price_sale_no_vat)) missing.push('положительная цена');
    if (kind === 'spec' && specMode === 'change' && !positive(row.new_price_no_vat)) missing.push('новая положительная цена');
    if (kind === 'kp' && !positive(row.cost_with_vat)) missing.push('положительная себестоимость');
    if (missing.length) return `Строка ${idx+1}: заполните ${missing.join(', ')}.`;
  }
  return null;
}
function vatSelect(idx, rate, kind) {
  const handler = kind === 'spec' ? 'onSpecVatChange' : 'onKpVatChange';
  return `<select class="vat-select" aria-label="НДС, строка ${idx+1}" onchange="${handler}(${idx},this.value)">
    <option value="" ${rate === null ? 'selected' : ''}>—</option>
    ${[0,0.1,0.2,0.22].map(v=>`<option value="${v}" ${rate === v ? 'selected' : ''}>${Math.round(v*100)}%</option>`).join('')}
  </select>`;
}
function specFieldInput(idx, field, value, numeric=false) {
  const labels={weight_g:'Вес, г',barcode:'Штрихкод',pcs_per_box:'Шт/Кор',boxes_per_pallet:'Кор/Пал',boxes_per_row:'Кор/Ряд'};
  return `<input class="cell-input ${numeric?'mono':''}" aria-label="${labels[field]}, строка ${idx+1}" type="text"
    ${numeric?'inputmode="decimal"':''} autocomplete="off" value="${escapeHtml(value ?? '')}"
    oninput="onSpecFieldChange(${idx},'${field}',this.value)">`;
}
function onSpecFieldChange(idx, field, value) {
  const row=specRows[idx];
  row[field] = field === 'barcode' ? value : parseRuNum(value);
  if (specMode === 'change') recalcChangeRow(idx);
  else {
    for (const [id,price] of [['row-box-with-vat',row.price_with_vat],['row-box-no-vat',row.price_no_vat]]) {
      const el=document.getElementById(`${id}-${idx}`);
      if (el) el.textContent=positive(price) && positive(row.pcs_per_box) ? formatRuNum(price*row.pcs_per_box) : '';
    }
  }
  updateTotals();
}
function onSpecVatChange(idx, value) {
  const row=specRows[idx]; row.vat_rate=value==='' ? null : Number(value);
  for (const [net,gross] of [['price_no_vat','price_with_vat'],['new_price_no_vat','new_price_with_vat']]) {
    if (!validVat(row.vat_rate)) row[gross]=null;
    else if (row[net] !== null) row[gross]=roundMoney(row[net]*(1+row.vat_rate));
    else if (row[gross] != null) row[net]=roundMoney(row[gross]/(1+row.vat_rate));
  }
  row.old_price_with_vat=row.price_with_vat;
  renderSpecGrid();
}
function syncSpecMoney(row) {
  for (const [net,gross] of [['price_no_vat','price_with_vat'],['new_price_no_vat','new_price_with_vat']]) {
    if (validVat(row.vat_rate) && row[net] != null) row[gross] = roundMoney(row[net]*(1+row.vat_rate));
  }
  row.old_price_with_vat = row.price_with_vat;
}
function updateTotals() {
  for (const [id, rows, kind] of [['spec-totals',specRows,'spec'],['kp-totals',kpRows,'kp']]) {
    const el=document.getElementById(id); if (!el) continue;
    const active=rows.filter(kind==='spec'?specStarted:kpStarted);
    let net=0,gross=0,ready=0;
    for (const r of active) {
      const n=kind==='kp'?r.price_sale_no_vat:(specMode==='change'?r.new_price_no_vat:r.price_no_vat);
      const g=kind==='kp'?r.price_sale_with_vat:(specMode==='change'?r.new_price_with_vat:r.price_with_vat);
      if (!validVat(r.vat_rate) || !positive(n) || !positive(g) || !positive(r.pcs_per_box)) continue;
      net+=Math.round(n*100)*r.pcs_per_box; gross+=Math.round(g*100)*r.pcs_per_box; ready++;
    }
    el.textContent=`Готовых строк: ${ready}/${active.length} · По одной коробке каждой позиции${kind==='spec' && specMode==='change'?' (новые цены)':''}: без НДС ${formatRuNum(net/100)} ₽ · с НДС ${formatRuNum(gross/100)} ₽`;
  }
}
function notifyProblem(message) {
  BoardUINotification.show({title:'Скачивание заблокировано',description:message,status:'error',duration:8000});
}
async function downloadExport(path, payload, buttonId) {
  const button=document.getElementById(buttonId); if (button) button.disabled=true;
  try {
    const res=await fetch(`${API_BASE}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Panel-Request':'1'},body:JSON.stringify(payload)});
    if (!res.ok) {
      const data=await res.json();
      const detail=typeof data.detail==='string'?data.detail:'Проверьте заполнение полей и количество строк.';
      throw new Error(detail);
    }
    const match=(res.headers.get('Content-Disposition')||'').match(/filename\*=UTF-8''([^;]+)/i);
    const filename=match?decodeURIComponent(match[1]):'document';
    const url=URL.createObjectURL(await res.blob());
    const link=document.createElement('a');link.href=url;link.download=filename;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    BoardUINotification.show({title:'Документ сформирован',description:filename,status:'success'});
  } catch (err) {
    BoardUINotification.show({title:'Не удалось скачать',description:err.message||'Проверьте локальный сервер и повторите запрос.',status:'error',duration:8000});
  } finally { if (button) button.disabled=false; }
}
async function loadDemoRows(kind) {
  const existing=(kind==='spec'?specRows.filter(specStarted):kpRows.filter(kpStarted));
  if (existing.length && !confirm('Заменить текущие строки синтетическим примером?')) return;
  try {
    const res=await fetch('/api/catalog/search');if (!res.ok) throw new Error('Каталог недоступен');
    const items=await res.json();
    if (kind==='spec') {
      specRows=items.map(item=>({...createEmptyRow(),...item,price_with_vat:roundMoney(item.price_no_vat*(1+item.vat_rate)),new_price_no_vat:roundMoney(item.price_no_vat*1.1)}));
      for (const row of specRows) { row.old_price_with_vat=row.price_with_vat;row.new_price_with_vat=roundMoney(row.new_price_no_vat*(1+row.vat_rate)); }
      document.getElementById('meta-supplier').value='Демонстрационный поставщик';renderSpecGrid();
    } else {
      kpRows=items.map(item=>({...createEmptyKpRow(),name:item.name,manufacturer:item.manufacturer,weight_g:item.weight_g,pcs_per_box:item.pcs_per_box,vat_rate:item.vat_rate,
        price_sale_no_vat:item.price_no_vat,price_sale_with_vat:roundMoney(item.price_no_vat*(1+item.vat_rate)),cost_with_vat:roundMoney(item.price_no_vat*.8)}));
      document.getElementById('kp-meta-supplier').value='Демонстрационный поставщик';renderKpGrid();
    }
  } catch(err) { notifyProblem(err.message); }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
