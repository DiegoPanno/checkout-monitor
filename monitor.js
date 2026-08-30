const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURACIÓN Y CONSTANTES
// ==========================================
const BASE_URL = 'https://www.pintureriasambito.com';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Términos para auditar buscador y catálogo
const SEARCH_TERMS = ['latex', 'impermeabilizante', 'pincel'];

// Escenarios de prueba para Checkout
const SCENARIOS = [
  {
    productName: 'Látex Denver 20 Lts',
    url: `${BASE_URL}/latex-interior-denver-20-lts/p`,
    zoneName: 'Mar del Plata',
    postalCode: '7600'
  },
  {
    productName: 'Látex Denver 20 Lts',
    url: `${BASE_URL}/latex-interior-denver-20-lts/p`,
    zoneName: 'La Florida (Buenos Aires)',
    postalCode: '1879'
  },
  {
    productName: 'Látex Tersuave Antimanchas 20 Lts',
    url: `${BASE_URL}/latex-interior-tersuave-lavable-antimanchas-20-lts/p`,
    zoneName: 'Mar del Plata',
    postalCode: '7600'
  },
  {
    productName: 'Látex Tersuave Antimanchas 20 Lts',
    url: `${BASE_URL}/latex-interior-tersuave-lavable-antimanchas-20-lts/p`,
    zoneName: 'La Florida (Buenos Aires)',
    postalCode: '1879'
  }
];

// ==========================================
// UTILIDADES DE NOTIFICACIÓN (TELEGRAM)
// ==========================================
async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML'
  });

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

async function sendTelegramPhoto(imagePath, caption) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !fs.existsSync(imagePath)) return;
  
  const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substring(2);
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  
  const fileData = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);

  let body = [];
  body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}\r\n`));
  body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
  body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`));
  body.push(fileData);
  body.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const totalLength = body.reduce((acc, cur) => acc + cur.length, 0);

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': totalLength
      }
    }, () => resolve());
    req.on('error', () => resolve());
    for (const b of body) req.write(b);
    req.end();
  });
}

// ==========================================
// MÓDULO 1: AUDITORÍA DE BÚSQUEDA
// ==========================================
async function auditSearch(page) {
  console.log('🔎 --- MÓDULO 1: Auditoría de Búsqueda y Catálogo ---');
  for (const term of SEARCH_TERMS) {
    try {
      console.log(`Buscando término: "${term}"...`);
      await page.goto(`${BASE_URL}/${term}`, { waitUntil: 'networkidle', timeout: 25000 });
      
      const productElements = page.locator('.vtex-search-result-3-x-galleryItem, .vtex-product-summary-2-x-container');
      await productElements.first().waitFor({ state: 'visible', timeout: 10000 });
      const count = await productElements.count();
      
      console.log(`  ✓ Búsqueda "${term}" OK (${count} productos listados).`);
    } catch (err) {
      console.log(`  ❌ Fallo en búsqueda "${term}": ${err.message}`);
      await sendTelegramMessage(`⚠️ <b>Alerta Búsqueda</b>: Sin resultados para término <code>${term}</code>.`);
    }
  }
}

// ==========================================
// MÓDULO 2 Y 3: AUDITORÍA DE CHECKOUT
// ==========================================
async function auditCheckoutScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  const scenarioTitle = `${scenario.productName} [${scenario.zoneName}]`;
  console.log(`🛒 --- MÓDULO 2 & 3: PDP + Checkout para ${scenarioTitle} ---`);

  try {
    // 1. Navegar a PDP
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 2. Click en botón Comprar / Agregar al Carrito
    const buyButton = page.locator('.vtex-add-to-cart-button-0-x-buttonText, button:has-text("Comprar"), button:has-text("Agregar al carrito")').first();
    await buyButton.waitFor({ state: 'visible', timeout: 15000 });
    await buyButton.click();

    // 3. Ir al Checkout si no redirige automáticamente
    await page.waitForTimeout(2000);
    if (!page.url().includes('/checkout')) {
      const cartButton = page.locator('#proceed-to-checkout, a[href*="/checkout"]').first();
      if (await cartButton.isVisible()) {
        await cartButton.click();
      } else {
        await page.goto(`${BASE_URL}/checkout/#/cart`, { waitUntil: 'domcontentloaded' });
      }
    }

    // 4. Pasar del carrito a Identificación
    const toOrderButton = page.locator('#cart-to-orderform').first();
    if (await toOrderButton.isVisible()) {
      await toOrderButton.click();
    }

    // 5. Completar Formulario de Identificación (Paso 1)
    await page.waitForSelector('#client-email', { state: 'visible', timeout: 20000 });
    await page.fill('#client-email', 'auditoria_monitor@ingacot.com.ar');
    
    // Rellenar resto de datos de contacto
    const fnInput = page.locator('#client-first-name');
    if (await fnInput.isVisible()) await fnInput.fill('Auditor');

    const lnInput = page.locator('#client-last-name');
    if (await lnInput.isVisible()) await lnInput.fill('Sistema');

    const phoneInput = page.locator('#client-phone');
    if (await phoneInput.isVisible()) await phoneInput.fill('2234000000');

    const docInput = page.locator('#client-document');
    if (await docInput.isVisible()) await docInput.fill('32123456');

    // 6. Click en "IR PARA DATOS DE ENVÍO"
    const btnGoShipping = page.locator('#go-to-shipping, #btn-client-pre-email, button:has-text("IR PARA DATOS DE ENVÍO"), button:has-text("Continuar")').first();
    await btnGoShipping.waitFor({ state: 'visible', timeout: 10000 });
    await btnGoShipping.click();

    // 7. Completar y calcular Código Postal en Envío (Paso 2)
    const postalInput = page.locator('#ship-postalCode, input[name="postalCode"]').first();
    await postalInput.waitFor({ state: 'visible', timeout: 15000 });
    await postalInput.fill(scenario.postalCode);

    const calcButton = page.locator('#shipping-calculate-link, button:has-text("Calcular")').first();
    if (await calcButton.isVisible()) {
      await calcButton.click();
    }

    // 8. Validar disponibilidad de opciones de flete/retiro
    await page.waitForTimeout(3000);
    
    // Verificar si aparece cartel de bloqueo de código postal
    const alertMsg = page.locator('.vtex-omnishipping-1-x-alert, .alert-warning, text="El siguiente ítem no puede enviarse"');
    if (await alertMsg.isVisible()) {
      throw new Error(`Ítem bloqueado para CP ${scenario.postalCode} ("No puede enviarse a este código postal")`);
    }

    // Validar que se liste la sección de entrega
    await page.waitForSelector('.vtex-omnishipping-1-x-shippingSectionTitle, .shipping-data, .vtex-omnishipping-1-x-deliveryGroup', { state: 'visible', timeout: 15000 });
    console.log(`  ✓ Checkout OK para ${scenarioTitle}`);

  } catch (err) {
    console.log(`❌ Error en Checkout (${scenarioTitle}): ${err.message}`);
    
    const screenshotPath = `error_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const errorCaption = `🚨 <b>Fallo en Checkout Ámbito</b>\n\n<b>Producto:</b> ${scenario.productName}\n<b>Zona:</b> ${scenario.zoneName} (${scenario.postalCode})\n<b>Error:</b> ${err.message}`;
    
    await sendTelegramPhoto(screenshotPath, errorCaption);
    console.log('📸 Captura enviada a Telegram.');

    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
  } finally {
    await context.close();
  }
}

// ==========================================
// EJECUCIÓN PRINCIPAL
// ==========================================
(async () => {
  const now = new Date().toLocaleTimeString('es-AR');
  console.log(`⏰ [${now}] Iniciando Suite Robusta de Auditoría...`);

  const browser = await chromium.launch({ headless: true });

  try {
    const searchPage = await browser.newPage();
    await auditSearch(searchPage);
    await searchPage.close();

    for (const scenario of SCENARIOS) {
      await auditCheckoutScenario(browser, scenario);
    }
  } catch (globalErr) {
    console.error('Error global en la ejecución:', globalErr);
  } finally {
    await browser.close();
    console.log('🏁 Suite de auditoría completada.');
  }
})();