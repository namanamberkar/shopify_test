const API_BASE = window.APP_CONFIG?.API_BASE_URL || '';
const TOKEN_KEY = 'auth_token';

let allProducts = [];
let allCollections = [];
let boardData = { products: [], columns: [], unassigned: [] };
let skuCheckTimer = null;

// Currently uploaded preview Object URLs for the New Saree form
let newProductPreviewUrls = [];
// Existing images loaded for the edit modal (array of {id, src, alt})
let editProductImages = [];
// New image previews for the edit modal
let editNewPreviewUrls = [];

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = 'login.html';
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ─── Image Gallery Helpers ───────────────────────────────────────────────────

function renderPreviewStrip(containerEl, previewUrls, onRemove = null) {
  containerEl.innerHTML = '';
  if (!previewUrls.length) return;
  previewUrls.forEach((url, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb-wrap';

    const img = document.createElement('img');
    img.src = url;
    img.className = 'preview-thumb';
    img.alt = `Photo ${i + 1}`;

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'preview-thumb-remove';
    rm.textContent = '×';
    rm.title = 'Remove';
    rm.addEventListener('click', () => {
      previewUrls.splice(i, 1);
      URL.revokeObjectURL(url);
      renderPreviewStrip(containerEl, previewUrls, onRemove);
      if (onRemove) {
        onRemove();
      } else {
        refreshVariantImagePickers('#variants-list .variant-row');
      }
    });

    wrap.appendChild(img);
    wrap.appendChild(rm);
    containerEl.appendChild(wrap);
  });
}

function attachImagePickerToVariantRow(row, previewUrls) {
  let picker = row.querySelector('.variant-image-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.className = 'variant-image-picker';
    row.appendChild(picker);
  }
  picker.innerHTML = '';
  if (!previewUrls.length) {
    picker.innerHTML = '<span class="meta-note" style="font-size:11px;">Upload images above to assign one to this variant</span>';
    return;
  }
  previewUrls.forEach((url, i) => {
    const thumb = document.createElement('img');
    thumb.src = url;
    thumb.className = 'variant-image-thumb';
    const isSelected = Number(row.dataset.imageSrcIndex) === i;
    thumb.classList.toggle('selected', isSelected);
    thumb.title = 'Tap to assign this photo to variant';
    thumb.addEventListener('click', () => {
      const alreadySelected = Number(row.dataset.imageSrcIndex) === i;
      row.dataset.imageSrcIndex = alreadySelected ? '-1' : String(i);
      picker.querySelectorAll('.variant-image-thumb').forEach((t, ti) => {
        t.classList.toggle('selected', !alreadySelected && ti === i);
      });
    });
    picker.appendChild(thumb);
  });
}

function refreshVariantImagePickers(rowsSelector) {
  document.querySelectorAll(rowsSelector).forEach(row => {
    attachImagePickerToVariantRow(row, newProductPreviewUrls);
  });
}

function refreshEditVariantImagePickers() {
  // Merge existing shopify image URLs + new preview URLs for edit modal
  const allUrls = [
    ...editProductImages.map(img => img.src),
    ...editNewPreviewUrls
  ];
  document.querySelectorAll('#edit-variants-list .variant-row').forEach(row => {
    let picker = row.querySelector('.variant-image-picker');
    if (!picker) {
      picker = document.createElement('div');
      picker.className = 'variant-image-picker';
      row.appendChild(picker);
    }
    picker.innerHTML = '';
    if (!allUrls.length) {
      picker.innerHTML = '<span class="meta-note" style="font-size:11px;">No images found for this product</span>';
      return;
    }
    allUrls.forEach((url, i) => {
      const thumb = document.createElement('img');
      thumb.src = url;
      thumb.className = 'variant-image-thumb';
      thumb.classList.toggle('selected', Number(row.dataset.imageSrcIndex) === i);
      thumb.title = 'Tap to assign to variant';
      thumb.addEventListener('click', () => {
        const already = Number(row.dataset.imageSrcIndex) === i;
        row.dataset.imageSrcIndex = already ? '-1' : String(i);
        picker.querySelectorAll('.variant-image-thumb').forEach((t, ti) => {
          t.classList.toggle('selected', !already && ti === i);
        });
      });
      picker.appendChild(thumb);
    });
  });
}

function renderEditImagesGallery() {
  const container = document.getElementById('edit-images-list');
  if (!container) return;
  if (!editProductImages.length) {
    container.innerHTML = '<p class="meta-note">No existing photos.</p>';
    return;
  }
  container.innerHTML = '';
  editProductImages.forEach(img => {
    const card = document.createElement('div');
    card.className = 'edit-image-card';
    card.dataset.imageId = img.id;
    card.innerHTML = `
      <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || '')}">
      <label class="delete-image-toggle">
        <input type="checkbox" class="edit-image-delete">
        <span>Remove</span>
      </label>
    `;
    container.appendChild(card);
  });
}

// ────────────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.add('hidden'));
  document.getElementById(`panel-${tab}`).classList.remove('hidden');

  if (tab === 'products') loadProducts();
  if (tab === 'new') loadCollectionsForForm('new-collections');
  if (tab === 'collections') loadCollectionsBoard();
}

async function checkShopStatus() {
  const el = document.getElementById('shop-status');
  try {
    const data = await api('/api/health');
    el.textContent = data.shop || 'Connected';
    el.className = 'status-pill ok';
  } catch {
    el.textContent = 'Offline';
    el.className = 'status-pill err';
  }
}

function renderProducts(products) {
  const container = document.getElementById('products-list');
  if (!products.length) {
    container.innerHTML = '<p class="meta-note">No products found.</p>';
    return;
  }

  container.innerHTML = products.map(p => `
    <article class="product-card" data-id="${p.id}">
      ${p.image
      ? `<img class="product-card-img" src="${escapeHtml(p.image)}" alt="">`
      : '<div class="product-card-img"></div>'}
      <div class="product-card-body">
        <span class="status-badge ${p.status}">${p.status}</span>
        <h3 class="product-card-title">${escapeHtml(p.title)}</h3>
        <p class="product-card-sku">${escapeHtml(p.sku || 'No SKU')}</p>
        <p class="product-card-meta">₹${p.price || '0'} · ${p.inventory ?? 0} in stock</p>
        <div class="inventory-inline">
          <input type="number" min="0" value="${p.inventory ?? 0}" data-variant-id="${p.variant_id}" class="inv-input">
          <button class="btn sync-btn inv-save-btn" data-variant-id="${p.variant_id}">Set qty</button>
        </div>
        <div class="product-card-actions">
          <button class="btn sync-btn edit-btn" data-id="${p.id}">Edit</button>
          <a class="btn sync-btn" href="${p.admin_url}" target="_blank" rel="noopener">Shopify</a>
        </div>
      </div>
    </article>
  `).join('');

  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });

  container.querySelectorAll('.inv-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.product-card');
      const input = card.querySelector('.inv-input');
      try {
        await api('/api/inventory', {
          method: 'PUT',
          body: JSON.stringify({
            variant_id: btn.dataset.variantId,
            quantity: Number(input.value)
          })
        });
        showToast('Inventory updated');
        loadProducts();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

function filterProducts() {
  const search = document.getElementById('product-search').value.trim().toLowerCase();
  const status = document.getElementById('product-filter-status').value;
  let filtered = [...allProducts];
  if (status) filtered = filtered.filter(p => p.status === status);
  if (search) {
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(search) ||
      (p.sku || '').toLowerCase().includes(search) ||
      (p.tags || '').toLowerCase().includes(search)
    );
  }
  renderProducts(filtered);
}

async function loadProducts() {
  const container = document.getElementById('products-list');
  container.innerHTML = Array(8).fill(0).map(() => `
    <article class="product-card skeleton-card">
      <div class="product-card-img skeleton-shimmer"></div>
      <div class="product-card-body">
        <div class="skeleton-badge skeleton-shimmer" style="margin-bottom: 8px;"></div>
        <div class="skeleton-text title skeleton-shimmer" style="margin-bottom: 8px;"></div>
        <div class="skeleton-text sku skeleton-shimmer" style="margin-bottom: 8px;"></div>
        <div class="skeleton-text meta skeleton-shimmer" style="margin-bottom: 12px;"></div>
        <div class="skeleton-input-row" style="margin-bottom: 12px;">
          <div class="skeleton-input skeleton-shimmer" style="border-radius: 0;"></div>
          <div class="skeleton-button skeleton-shimmer" style="border-radius: 0;"></div>
        </div>
        <div class="product-card-actions">
          <div class="skeleton-button skeleton-shimmer" style="border-radius: 0; flex: 1;"></div>
          <div class="skeleton-button skeleton-shimmer" style="border-radius: 0; flex: 1;"></div>
        </div>
      </div>
    </article>
  `).join('');
  try {
    const data = await api('/api/products');
    allProducts = data.products || [];
    filterProducts();
  } catch (err) {
    container.innerHTML = `<p class="meta-note">${escapeHtml(err.message)}</p>`;
  }
}

async function loadCollectionsForForm(containerId, selectedIds = []) {
  const container = document.getElementById(containerId);
  try {
    if (!allCollections.length) {
      const data = await api('/api/collections');
      allCollections = data.collections || [];
    }
    const custom = allCollections.filter(c => c.type === 'custom');
    if (!custom.length) {
      container.innerHTML = '<p class="meta-note">No custom collections.</p>';
      return;
    }
    container.innerHTML = custom.map(c => `
      <label>
        <input type="checkbox" name="collection" value="${c.id}"
          ${selectedIds.includes(String(c.id)) ? 'checked' : ''}>
        ${escapeHtml(c.title)}
      </label>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p class="meta-note">${escapeHtml(err.message)}</p>`;
  }
}

function getSelectedCollections(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[name="collection"]:checked`)]
    .map(el => el.value);
}

async function checkSkuAvailability(inputId, statusId, excludeProductId = null) {
  const input = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  const code = input.value.trim();
  if (!code) {
    statusEl.textContent = '';
    statusEl.className = 'sku-status';
    return null;
  }

  statusEl.textContent = 'Checking...';
  statusEl.className = 'sku-status checking';

  try {
    const params = new URLSearchParams({ code });
    if (excludeProductId) params.set('exclude_product_id', excludeProductId);
    const data = await api(`/api/sku/check?${params}`);
    if (data.available) {
      statusEl.textContent = 'Available';
      statusEl.className = 'sku-status available';
    } else {
      statusEl.textContent = `Used on: ${data.duplicate?.product_title || 'another product'}`;
      statusEl.className = 'sku-status taken';
    }
    return data;
  } catch {
    statusEl.textContent = '';
    statusEl.className = 'sku-status';
    return null;
  }
}

function setupSkuLiveCheck(inputId, statusId, excludeProductId = null) {
  const input = document.getElementById(inputId);
  input.addEventListener('input', () => {
    clearTimeout(skuCheckTimer);
    skuCheckTimer = setTimeout(
      () => checkSkuAvailability(inputId, statusId, excludeProductId?.() ?? null),
      400
    );
  });
}

async function handleNewSareeSubmit(e) {
  e.preventDefault();
  const skuCheck = await checkSkuAvailability('new-sku', 'new-sku-status');
  if (skuCheck && !skuCheck.available) {
    showToast('Saree code is already in use', true);
    return;
  }

  const files = document.getElementById('new-images').files;
  const imagesBase64 = [];

  // Convert preview URL array to base64
  for (const url of newProductPreviewUrls) {
    const blob = await fetch(url).then(r => r.blob());
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    imagesBase64.push(b64);
  }

  // Also handle any files not yet previewed
  for (let i = 0; i < files.length; i++) {
    const reader = new FileReader();
    await new Promise((resolve, reject) => {
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        imagesBase64.push(base64);
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(files[i]);
    });
  }

  const payload = {
    title: document.getElementById('new-title').value.trim(),
    sku: document.getElementById('new-sku').value.trim(),
    body_html: document.getElementById('new-description').value,
    status: document.getElementById('new-status').value,
    published: document.getElementById('new-published').checked,
    vendor: document.getElementById('new-vendor').value,
    product_type: document.getElementById('new-type').value,
    tags: document.getElementById('new-tags').value,
    images_base64: imagesBase64,
    collection_ids: getSelectedCollections('new-collections'),
    metafields: {
      specifications: document.getElementById('mf-specifications').value,
      fabric: document.getElementById('mf-fabric').value,
      care: document.getElementById('mf-care').value,
      zari: document.getElementById('mf-zari').value,
      fabric_weight: document.getElementById('mf-fabric-weight').value,
      blouse_piece: document.getElementById('mf-blouse-piece').value,
      length: document.getElementById('mf-length').value,
      origin: document.getElementById('mf-origin').value,
      weave_style: document.getElementById('mf-weave-style').value,
      disclosures: document.getElementById('mf-disclosures').value,
      instagram_url: document.getElementById('mf-instagram-url').value
    }
  };

  const useVariants = document.getElementById('enable-variants').checked;
  if (!useVariants) {
    payload.price = document.getElementById('new-price').value;
    payload.compare_at_price = document.getElementById('new-compare-price').value;
    payload.inventory_quantity = document.getElementById('new-inventory').value;
  } else {
    payload.options = [{ name: document.getElementById('option-name').value || 'Color' }];
    payload.variants = [];
    payload.variant_image_indices = [];
    const variantRows = document.querySelectorAll('#variants-list .variant-row');
    variantRows.forEach((row, i) => {
      const val = row.querySelector('.var-val').value.trim();
      if (!val) return;
      payload.variants.push({
        sku: payload.sku + '-' + (i + 1),
        option1: val,
        price: row.querySelector('.var-price').value || document.getElementById('new-price').value,
        compare_at_price: document.getElementById('new-compare-price').value || '',
        inventory_quantity: row.querySelector('.var-qty').value || '1'
      });
      payload.variant_image_indices.push(Number(row.dataset.imageSrcIndex ?? '-1'));
    });
  }

  const btn = document.getElementById('new-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Saree created successfully');
    document.getElementById('new-saree-form').reset();
    document.getElementById('new-vendor').value = 'Naari';
    document.getElementById('new-type').value = 'Saree';
    document.getElementById('new-inventory').value = '1';
    document.getElementById('new-sku-status').textContent = '';
    // Clear previews
    newProductPreviewUrls.forEach(u => URL.revokeObjectURL(u));
    newProductPreviewUrls = [];
    document.getElementById('new-images-preview').innerHTML = '';
    document.getElementById('variants-list').innerHTML = '';
    switchTab('products');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create saree';
  }
}

async function openEditModal(productId) {
  try {
    const data = await api(`/api/products/${productId}`);
    const p = data.product;
    const v = p.variants?.[0] || {};

    document.getElementById('edit-id').value = p.id;
    document.getElementById('edit-variant-id').value = v.id || '';
    document.getElementById('edit-title').value = p.title || '';
    document.getElementById('edit-sku').value = v.sku || '';

    // Convert breaks to newlines and strip other HTML
    let desc = p.body_html || '';
    desc = desc.replace(/<br\s*[/]?>/gi, '\n');
    desc = desc.replace(/<\/p>/gi, '\n\n');
    desc = desc.replace(/<[^>]+>/g, '');
    document.getElementById('edit-description').value = desc.trim();

    document.getElementById('edit-price').value = v.price || '';
    document.getElementById('edit-inventory').value = v.inventory_quantity ?? 0;
    document.getElementById('edit-status').value = p.status || 'draft';
    document.getElementById('edit-new-images').value = '';
    document.getElementById('edit-sku-status').textContent = '';

    // Load existing images into the gallery
    editProductImages = (p.images || []).map(img => ({ id: img.id, src: img.src, alt: img.alt || '' }));
    editNewPreviewUrls = [];
    renderEditImagesGallery();

    const editList = document.getElementById('edit-variants-list');
    editList.innerHTML = '';

    if (p.variants && p.variants.length > 0) {
      p.variants.forEach((v, index) => {
        const row = document.createElement('div');
        row.className = 'variant-row';
        row.dataset.id = v.id;
        const imgIndex = p.images ? p.images.findIndex(img => img.id === v.image_id) : -1;
        row.dataset.imageSrcIndex = imgIndex >= 0 ? String(imgIndex) : '-1';
        row.innerHTML = `
          <div class="variant-field">
            <span class="variant-field-label">Option / Name</span>
            <input type="text" class="field-input" disabled value="${escapeHtml(v.title || v.option1 || '')}">
          </div>
          <div class="variant-fields-meta">
            <div class="variant-field">
              <span class="variant-field-label">SKU</span>
              <input type="text" class="field-input var-sku" value="${escapeHtml(v.sku || '')}">
            </div>
            <div class="variant-field">
              <span class="variant-field-label">Price</span>
              <input type="number" step="0.01" class="field-input var-price" value="${v.price || ''}">
            </div>
            <div class="variant-field">
              <span class="variant-field-label">Compare at</span>
              <input type="number" step="0.01" class="field-input var-compare" value="${v.compare_at_price || ''}">
            </div>
            <div class="variant-field">
              <span class="variant-field-label">Qty</span>
              <input type="number" class="field-input var-qty" value="${v.inventory_quantity ?? 0}">
            </div>
          </div>
        `;
        editList.appendChild(row);
      });
      // Attach image pickers after all rows rendered
      refreshEditVariantImagePickers();
    } else {
      editList.innerHTML = '<p class="meta-note">No variants found.</p>';
    }

    document.getElementById('edit-published').checked = Boolean(p.published);

    // Populate metafields in edit modal
    const mf = p.metafields || {};
    document.getElementById('em-specifications').value = mf.specifications || '';
    document.getElementById('em-fabric').value = mf.fabric || '';
    document.getElementById('em-care').value = mf.care || '';
    document.getElementById('em-zari').value = mf.zari || '';
    document.getElementById('em-fabric-weight').value = mf.fabric_weight || '';
    document.getElementById('em-blouse-piece').value = mf.blouse_piece || '';
    document.getElementById('em-length').value = mf.length || '';
    document.getElementById('em-origin').value = mf.origin || '';
    document.getElementById('em-weave-style').value = mf.weave_style || '';
    document.getElementById('em-disclosures').value = mf.disclosures || '';
    document.getElementById('em-instagram-url').value = mf.instagram_url || '';

    await loadCollectionsForForm('edit-collections', p.collection_ids || []);
    document.getElementById('edit-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const productId = document.getElementById('edit-id').value;
  const variantId = document.getElementById('edit-variant-id').value;

  const skuCheck = await checkSkuAvailability('edit-sku', 'edit-sku-status', productId);
  if (skuCheck && !skuCheck.available) {
    showToast('Saree code is already in use', true);
    return;
  }

  const files = document.getElementById('edit-new-images').files;
  const newImagesBase64 = [];

  // Convert new preview URLs to base64
  for (const url of editNewPreviewUrls) {
    const blob = await fetch(url).then(r => r.blob());
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    newImagesBase64.push(b64);
  }

  // Collect images to delete from existing gallery
  const imagesToDelete = [];
  document.querySelectorAll('#edit-images-list .edit-image-card').forEach(card => {
    if (card.querySelector('.edit-image-delete')?.checked) {
      imagesToDelete.push(card.dataset.imageId);
    }
  });

  const updatedVariants = [];
  document.querySelectorAll('#edit-variants-list .variant-row').forEach(row => {
    const imgIndex = Number(row.dataset.imageSrcIndex ?? '-1');
    let imageId = undefined;
    let newImageIndex = undefined;

    if (imgIndex >= 0) {
      if (imgIndex < editProductImages.length) {
        imageId = editProductImages[imgIndex].id;
      } else {
        newImageIndex = imgIndex - editProductImages.length;
      }
    } else if (imgIndex === -1) {
      imageId = null;
    }

    updatedVariants.push({
      id: row.dataset.id,
      sku: row.querySelector('.var-sku').value,
      price: row.querySelector('.var-price').value,
      compare_at_price: row.querySelector('.var-compare')?.value || '',
      inventory_quantity: row.querySelector('.var-qty').value,
      image_id: imageId,
      new_image_index: newImageIndex
    });
  });

  const payload = {
    title: document.getElementById('edit-title').value.trim(),
    body_html: document.getElementById('edit-description').value,
    status: document.getElementById('edit-status').value,
    published: document.getElementById('edit-published').checked,
    collection_ids: getSelectedCollections('edit-collections'),
    new_images_base64: newImagesBase64,
    images_to_delete: imagesToDelete,
    variants: updatedVariants,
    metafields: {
      specifications: document.getElementById('em-specifications').value,
      fabric: document.getElementById('em-fabric').value,
      care: document.getElementById('em-care').value,
      zari: document.getElementById('em-zari').value,
      fabric_weight: document.getElementById('em-fabric-weight').value,
      blouse_piece: document.getElementById('em-blouse-piece').value,
      length: document.getElementById('em-length').value,
      origin: document.getElementById('em-origin').value,
      weave_style: document.getElementById('em-weave-style').value,
      disclosures: document.getElementById('em-disclosures').value,
      instagram_url: document.getElementById('em-instagram-url').value
    }
  };

  try {
    await api(`/api/products/${productId}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast('Product updated');
    closeEditModal();
    loadProducts();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleDeleteProduct() {
  const productId = document.getElementById('edit-id').value;
  if (!confirm('Delete this product from Shopify? This cannot be undone.')) return;
  try {
    await api(`/api/products/${productId}`, { method: 'DELETE' });
    showToast('Product deleted');
    closeEditModal();
    loadProducts();
  } catch (err) {
    showToast(err.message, true);
  }
}

function productCardHtml(product) {
  return `
    <div class="board-card" data-product-id="${product.id}" title="Drag to a collection. Right-click or Double-click to manage collections.">
      ${product.image ? `<img class="board-card-img" src="${escapeHtml(product.image)}" alt="">` : ''}
      <div>${escapeHtml(product.title)}</div>
      <div class="board-card-sku">${escapeHtml(product.sku || 'No SKU')}</div>
    </div>
  `;
}

function getProductById(id) {
  return boardData.products.find(p => String(p.id) === String(id));
}

async function handleBoardDrop(productId, fromColumnId, toColumnId) {
  if (fromColumnId === toColumnId) return;

  try {
    if (fromColumnId !== 'unassigned') {
      await api(`/api/collections/${fromColumnId}/products/${productId}`, { method: 'DELETE' });
    }
    if (toColumnId !== 'unassigned') {
      await api(`/api/collections/${toColumnId}/products`, {
        method: 'POST',
        body: JSON.stringify({ product_id: productId })
      });
    }
    showToast('Collection updated');
  } catch (err) {
    showToast(err.message, true);
    loadCollectionsBoard();
  }
}

function initSortable(listEl, columnId) {
  if (!window.Sortable) return;
  Sortable.create(listEl, {
    group: 'collections',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onAdd: async (evt) => {
      const productId = evt.item.dataset.productId;
      const fromColumnId = evt.from.dataset.columnId;
      const toColumnId = columnId;
      await handleBoardDrop(productId, fromColumnId, toColumnId);
    }
  });
}

function renderCollectionsBoard() {
  const board = document.getElementById('collections-board');
  const products = boardData.products || [];
  const productMap = Object.fromEntries(products.map(p => [String(p.id), p]));
  const columns = boardData.columns || [];

  board.innerHTML = `
    <div class="board-column" style="border: 2px dashed var(--outline-variant); background: #faf8f7;">
      <div class="board-column-header">
        All Shop Products (Drag from here)
        <span class="board-column-count">${products.length} items</span>
      </div>
      <div class="board-column-list" data-column-id="all-products" id="all-products-pool">
        ${products.map(p => productCardHtml(p)).join('')}
      </div>
    </div>
    
    <div class="board-container-vertical">
      ${columns.map(col => `
        <div class="board-column" data-column-id="${col.id}">
          <div class="board-column-header">
            ${escapeHtml(col.title)}
            <div style="display:flex; gap:8px;">
               <span class="board-column-count">${(col.product_ids || []).length} items</span>
               <button class="remove-btn" style="padding: 2px 6px; font-size: 10px;" onclick="deleteCollection('${col.id}')">Delete</button>
            </div>
          </div>
          <div class="board-column-list" data-column-id="${col.id}">
            ${(col.product_ids || []).map(id => {
    const p = productMap[String(id)];
    return p ? productCardHtml(p) : '';
  }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  if (window.Sortable) {
    Sortable.create(document.getElementById('all-products-pool'), {
      group: { name: 'collections', pull: 'clone', put: false },
      animation: 150,
      ghostClass: 'sortable-ghost',
      sort: false,
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 8
    });

    board.querySelectorAll('.board-container-vertical .board-column-list').forEach(list => {
      Sortable.create(list, {
        group: 'collections',
        animation: 150,
        ghostClass: 'sortable-ghost',
        delay: 300,
        delayOnTouchOnly: true,
        touchStartThreshold: 8,
        onAdd: async (evt) => {
          const productId = evt.item.dataset.productId;
          const toColumnId = list.dataset.columnId;
          try {
            await handleBoardDrop(productId, 'unassigned', toColumnId);
          } catch (e) {
            evt.item.remove(); // revert drop
          }
        }
      });
    });
  }

  // Handle right-click/double-click on cards to manually manage collections
  board.querySelectorAll('.board-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCollectionsModal(card.dataset.productId);
    });
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      openCollectionsModal(card.dataset.productId);
    });

    // Custom touch-based long press detection for mobile
    let touchStartTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let longPressed = false;

    card.addEventListener('touchstart', (e) => {
      longPressed = false;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      clearTimeout(touchStartTimer);
      touchStartTimer = setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        openCollectionsModal(card.dataset.productId);
      }, 620);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!touchStartTimer) return;
      const touch = e.touches[0];
      const diffX = Math.abs(touch.clientX - touchStartX);
      const diffY = Math.abs(touch.clientY - touchStartY);
      if (diffX > 10 || diffY > 10) {
        clearTimeout(touchStartTimer);
        touchStartTimer = null;
      }
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      clearTimeout(touchStartTimer);
      touchStartTimer = null;
      if (longPressed) {
        e.preventDefault();
      }
    });

    card.addEventListener('touchcancel', () => {
      clearTimeout(touchStartTimer);
      touchStartTimer = null;
    });
  });

  const smartEl = document.getElementById('smart-collections');
  const smart = boardData.smart_collections || [];
  if (smart.length) {
    smartEl.classList.remove('hidden');
    smartEl.innerHTML = `
      <h3>Smart collections (read-only)</h3>
      <ul>${smart.map(c => `<li>${escapeHtml(c.title)}</li>`).join('')}</ul>
    `;
  } else {
    smartEl.classList.add('hidden');
  }
}

window.deleteCollection = async (id) => {
  if (!confirm('Are you sure you want to delete this custom collection entirely from Shopify?')) return;
  try {
    await api(`/api/collections/${id}`, { method: 'DELETE' });
    showToast('Collection deleted');
    loadCollectionsBoard();
  } catch (err) {
    showToast(err.message, true);
  }
};

let currentCollectionsModalProductId = null;
let originalCollectionIds = [];
let selectedCollectionIds = [];

function openCollectionsModal(productId) {
  const p = getProductById(productId);
  if (!p) return;

  currentCollectionsModalProductId = productId;

  // Render product info
  const infoEl = document.getElementById('collections-modal-product-info');
  infoEl.innerHTML = `
    ${p.image
      ? `<img src="${escapeHtml(p.image)}" alt="">`
      : '<div class="no-img-placeholder"></div>'}
    <div class="modal-product-details">
      <div class="modal-product-title">${escapeHtml(p.title)}</div>
      <div class="modal-product-sku">${escapeHtml(p.sku || 'No SKU')}</div>
    </div>
  `;

  // Get active collections for this product
  originalCollectionIds = getCollectionsForProduct(productId);
  selectedCollectionIds = [...originalCollectionIds];

  // Render collections checklist
  renderCollectionsModalList();

  // Clear search field
  document.getElementById('collections-modal-search').value = '';

  // Show modal
  document.getElementById('collections-modal').classList.remove('hidden');
}

function closeCollectionsModal() {
  document.getElementById('collections-modal').classList.add('hidden');
  currentCollectionsModalProductId = null;
  originalCollectionIds = [];
  selectedCollectionIds = [];
}

function getCollectionsForProduct(productId) {
  const assigned = [];
  if (boardData && boardData.columns) {
    boardData.columns.forEach(col => {
      const ids = (col.product_ids || []).map(String);
      if (ids.includes(String(productId))) {
        assigned.push(String(col.id));
      }
    });
  }
  return assigned;
}

function renderCollectionsModalList() {
  const container = document.getElementById('collections-modal-list');
  const searchVal = document.getElementById('collections-modal-search').value.trim().toLowerCase();

  if (!boardData || !boardData.columns || !boardData.columns.length) {
    container.innerHTML = '<p class="meta-note">No collections found.</p>';
    return;
  }

  // Filter columns based on search
  const filtered = boardData.columns.filter(col =>
    col.title.toLowerCase().includes(searchVal)
  );

  if (!filtered.length) {
    container.innerHTML = '<p class="meta-note">No matching collections.</p>';
    return;
  }

  container.innerHTML = filtered.map(col => {
    const isChecked = selectedCollectionIds.includes(String(col.id));
    return `
      <label>
        <input type="checkbox" name="modal-collection" value="${col.id}" ${isChecked ? 'checked' : ''}>
        <span class="collection-item-label">${escapeHtml(col.title)}</span>
      </label>
    `;
  }).join('');
}

async function handleCollectionsModalSave() {
  if (!currentCollectionsModalProductId) return;

  const saveBtn = document.getElementById('collections-modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  // Get currently selected checkbox values
  const checked = [...document.querySelectorAll('#collections-modal-list input[name="modal-collection"]:checked')]
    .map(el => String(el.value));

  try {
    // Identify collections to add and remove
    const toAdd = checked.filter(id => !originalCollectionIds.includes(id));
    const toRemove = originalCollectionIds.filter(id => !checked.includes(id));

    // Perform API requests
    const promises = [];

    // Add product to custom collections
    toAdd.forEach(colId => {
      promises.push(
        api(`/api/collections/${colId}/products`, {
          method: 'POST',
          body: JSON.stringify({ product_id: currentCollectionsModalProductId })
        })
      );
    });

    // Remove product from custom collections
    toRemove.forEach(colId => {
      promises.push(
        api(`/api/collections/${colId}/products/${currentCollectionsModalProductId}`, {
          method: 'DELETE'
        })
      );
    });

    await Promise.all(promises);
    showToast('Collections updated');
    closeCollectionsModal();
    loadCollectionsBoard();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
  }
}

async function loadCollectionsBoard() {
  const board = document.getElementById('collections-board');
  board.innerHTML = `
    <div class="collections-board-vertical skeleton-board" style="width: 100%;">
      <div class="board-column skeleton-column" style="border: 2px dashed var(--outline-variant); background: #faf8f7;">
        <div class="board-column-header skeleton-shimmer"></div>
        <div class="board-column-list">
          <div class="board-card skeleton-board-card"><div class="board-card-img skeleton-shimmer"></div><div class="skeleton-text title skeleton-shimmer"></div><div class="skeleton-text sku skeleton-shimmer"></div></div>
          <div class="board-card skeleton-board-card"><div class="board-card-img skeleton-shimmer"></div><div class="skeleton-text title skeleton-shimmer"></div><div class="skeleton-text sku skeleton-shimmer"></div></div>
          <div class="board-card skeleton-board-card"><div class="board-card-img skeleton-shimmer"></div><div class="skeleton-text title skeleton-shimmer"></div><div class="skeleton-text sku skeleton-shimmer"></div></div>
        </div>
      </div>
      <div class="board-container-vertical">
        <div class="board-column skeleton-column">
          <div class="board-column-header skeleton-shimmer"></div>
          <div class="board-column-list">
            <div class="board-card skeleton-board-card"><div class="board-card-img skeleton-shimmer"></div><div class="skeleton-text title skeleton-shimmer"></div><div class="skeleton-text sku skeleton-shimmer"></div></div>
            <div class="board-card skeleton-board-card"><div class="board-card-img skeleton-shimmer"></div><div class="skeleton-text title skeleton-shimmer"></div><div class="skeleton-text sku skeleton-shimmer"></div></div>
          </div>
        </div>
        <div class="board-column skeleton-column">
          <div class="board-column-header skeleton-shimmer"></div>
          <div class="board-column-list">
            <div class="board-card skeleton-board-card"><div class="board-card-img skeleton-shimmer"></div><div class="skeleton-text title skeleton-shimmer"></div><div class="skeleton-text sku skeleton-shimmer"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;
  try {
    boardData = await api('/api/collections/board');
    renderCollectionsBoard();
  } catch (err) {
    board.innerHTML = `<p class="meta-note">${escapeHtml(err.message)}</p>`;
  }
}


function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = 'login.html';
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('refresh-products-btn').addEventListener('click', loadProducts);
  document.getElementById('product-search').addEventListener('input', filterProducts);
  document.getElementById('product-filter-status').addEventListener('change', filterProducts);

  document.getElementById('new-saree-form').addEventListener('submit', handleNewSareeSubmit);
  setupSkuLiveCheck('new-sku', 'new-sku-status');
  setupSkuLiveCheck('edit-sku', 'edit-sku-status', () => document.getElementById('edit-id').value);

  // Live image preview for new saree
  document.getElementById('new-images').addEventListener('change', (e) => {
    const previewEl = document.getElementById('new-images-preview');
    for (const file of e.target.files) {
      const url = URL.createObjectURL(file);
      newProductPreviewUrls.push(url);
    }
    renderPreviewStrip(previewEl, newProductPreviewUrls);
    refreshVariantImagePickers('#variants-list .variant-row');
    // Reset input so same file can be chosen again
    e.target.value = '';
  });

  // Live image preview for edit modal new uploads
  document.getElementById('edit-new-images').addEventListener('change', (e) => {
    const previewEl = document.getElementById('edit-new-images-preview');
    for (const file of e.target.files) {
      const url = URL.createObjectURL(file);
      editNewPreviewUrls.push(url);
    }
    renderPreviewStrip(previewEl, editNewPreviewUrls, refreshEditVariantImagePickers);
    refreshEditVariantImagePickers();
    e.target.value = '';
  });

  document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
  document.getElementById('edit-delete-btn').addEventListener('click', handleDeleteProduct);
  document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
  document.getElementById('edit-modal-overlay').addEventListener('click', closeEditModal);

  document.getElementById('create-collection-btn').addEventListener('click', async () => {
    const input = document.getElementById('new-collection-title');
    const title = input.value.trim();
    if (!title) return showToast('Collection title needed', true);
    document.getElementById('create-collection-btn').disabled = true;
    try {
      await api('/api/collections', { method: 'POST', body: JSON.stringify({ title }) });
      input.value = '';
      showToast('Collection created!');
      loadCollectionsBoard();
    } catch (e) {
      showToast(e.message, true);
    } finally {
      document.getElementById('create-collection-btn').disabled = false;
    }
  });

  document.getElementById('enable-variants').addEventListener('change', (e) => {
    document.getElementById('variants-panel').style.display = e.target.checked ? 'block' : 'none';
  });

  document.getElementById('add-variant-btn').addEventListener('click', () => {
    const list = document.getElementById('variants-list');
    const row = document.createElement('div');
    row.className = 'variant-row';
    row.dataset.imageSrcIndex = '-1';
    row.innerHTML = `
      <div class="variant-field">
        <span class="variant-field-label">Option Value (e.g. Red, XL)</span>
        <input type="text" class="field-input var-val" placeholder="Value">
      </div>
      <div class="variant-fields-meta">
        <div class="variant-field">
           <span class="variant-field-label">Price (₹)</span>
           <input type="number" class="field-input var-price" placeholder="Price">
        </div>
        <div class="variant-field">
           <span class="variant-field-label">Qty</span>
           <input type="number" class="field-input var-qty" placeholder="Qty">
        </div>
        <button type="button" class="remove-btn" onclick="this.closest('.variant-row').remove()">Delete</button>
      </div>
    `;
    // Attach image picker using current previews
    attachImagePickerToVariantRow(row, newProductPreviewUrls);
    list.appendChild(row);
  });
  document.getElementById('add-variant-btn').click(); // add first default row

  document.getElementById('refresh-collections-btn').addEventListener('click', loadCollectionsBoard);

  // Collections modal events
  document.getElementById('collections-modal-close').addEventListener('click', closeCollectionsModal);
  document.getElementById('collections-modal-overlay').addEventListener('click', closeCollectionsModal);
  document.getElementById('collections-modal-cancel').addEventListener('click', closeCollectionsModal);
  document.getElementById('collections-modal-save').addEventListener('click', handleCollectionsModalSave);
  document.getElementById('collections-modal-search').addEventListener('input', renderCollectionsModalList);
  document.getElementById('collections-modal-list').addEventListener('change', (e) => {
    if (e.target && e.target.name === 'modal-collection') {
      const colId = String(e.target.value);
      if (e.target.checked) {
        if (!selectedCollectionIds.includes(colId)) {
          selectedCollectionIds.push(colId);
        }
      } else {
        selectedCollectionIds = selectedCollectionIds.filter(id => id !== colId);
      }
    }
  });

  checkShopStatus();
  loadProducts();
});
