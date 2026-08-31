import 'dotenv/config';
import { chromium } from 'playwright';
import https from 'https';
import fs from 'fs';
import path from 'path';

// ==========================================
// CONFIGURACIÓN Y CONSTANTES
// ==========================================
const BASE_URL = 'https://www.pintureriasambito.com';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE || '5492236764618';
const WHATSAPP_APIKEY = process.env.WHATSAPP_APIKEY || process.env.WHATSAPP_API_KEY;

const SEARCH_TERMS = ['latex', 'impermeabilizante', 'pincel'];

const SCENARIOS = [
  // --- Látex Denver Premium Lavable 4 Lts ---
  {
    productName: 'Látex Denver 4 Lts',
    url: `${BASE_URL}/latex-interior-denver-premium-lavable-4-lts/p`,
    zoneName: 'Mar del Plata',
    postalCode: '7600'
  },
  {
    productName: 'Látex Denver 4 Lts',
    url: `${BASE_URL}/latex-interior-denver-premium-lavable-4-lts/p`,
    zoneName: 'La Florida (Buenos Aires)',
    postalCode: '1879'
  },

  // --- Látex Antihongo Denver Interior/Exterior 4 Lts ---
  {
    productName: 'Látex Antihongo Denver 4 Lts',
    url: `${BASE_URL}/latex-antihongo-denver-interior-exterior-4-lts/p`,
    zoneName: 'Mar del Plata',
    postalCode: '7600'
  },
  {
    productName: 'Látex Antihongo Denver 4 Lts',
    url: `${BASE_URL}/latex-antihongo-denver-interior-exterior-4-lts/p`,
    zoneName: 'La Florida (Buenos Aires)',
    postalCode: '1879'
  }
];

// ==========================================
// UTILIDADES DE NOTIFICACIÓN
// ==========================================
async function sendWhatsAppMessage(text) {
  if (!WHATSAPP_PHONE || !WHATSAPP_APIKEY) return;
  const encoded = encodeURIComponent(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${WHATSAPP_PHONE}&text=${encoded}&apikey=${WHATSAPP_APIKEY}`;
  
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) console.log('📲 Notificación enviada a WhatsApp.');
      resolve();
    }).on('error', () => resolve());
  });
}

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
      await page.goto(`${BASE_URL}/${term}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      
      const productElements = page.locator('.vtex-search-result-3-x-galleryItem, .vtex-product-summary-2-x-container');
      await productElements.first().waitFor({ state: 'visible', timeout: 10000 });
      const count = await productElements.count();
      
      console.log(`  ✓ Búsqueda "${term}" OK (${count} productos listados).`);
    } catch (err) {
      console.log(`  ❌ Fallo en búsqueda "${term}": ${err.message}`);
      const msg = `⚠️ <b>Alerta Búsqueda</b>: Sin resultados para el término <code>${term}</code>.`;
      await sendTelegramMessage(msg);
      await sendWhatsAppMessage(`⚠️ Alerta Búsqueda: Sin resultados para "${term}" en Ámbito.`);
    }
  }
}

// ==========================================
// MÓDULO 2, 3 Y 4: CHECKOUT + LOGÍSTICA + PAGOS
// ==========================================
async function auditCheckoutScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();
  const scenarioTitle = `${scenario.productName} [${scenario.zoneName}]`;
  console.log(`🛒 --- MÓDULO 2, 3 & 4: PDP + Logística + Pagos para ${scenarioTitle} ---`);

  try {
    // 1. Navegar a PDP
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 2. Click Comprar
    const buyButton = page.locator('.vtex-add-to-cart-button-0-x-buttonText, button:has-text("Comprar"), button:has-text("Agregar al carrito")').first();
    await buyButton.waitFor({ state: 'visible', timeout: 15000 });

    const orderFormPromise = page.waitForResponse(res => res.url().includes('/items') && res.status() === 200, { timeout: 15000 }).catch(() => null);
    await buyButton.click();
    await orderFormPromise;

    // 3. Ir a Carrito y esperar a que VTEX termine de cargar
    await page.goto(`${BASE_URL}/checkout/#/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof window.vtexjs !== 'undefined' && window.vtexjs.checkout, { timeout: 20000 });
    await page.waitForTimeout(2000);

    // 4. Click en Proceder al pago vía evaluate (sin bloqueos por capas de carga)
    await page.evaluate(() => {
      const btn = document.querySelector('#cart-to-orderform, .btn-place-order');
      if (btn) {
        btn.click();
      } else if (window.location.hash !== '#/shipping' && window.location.hash !== '#/payment') {
        window.location.hash = '#/orderform';
      }
    });
    await page.waitForTimeout(2500);

    // 5. Completar pre-email si aparece
    const preEmailInput = page.locator('#client-pre-email').first();
    if (await preEmailInput.isVisible({ timeout: 2500 }).catch(() => false)) {
      await preEmailInput.fill('auditoria_monitor@ingacot.com.ar');
      await page.locator('#btn-client-pre-email').click().catch(() => null);
      await page.waitForTimeout(2000);
    }

    // 6. Completar datos de perfil si aparece el formulario
    const firstName = page.locator('#client-first-name').first();
    if (await firstName.isVisible({ timeout: 2500 }).catch(() => false)) {
      await firstName.fill('Auditor');
      await page.locator('#client-last-name').fill('Sistema').catch(() => null);
      await page.locator('#client-document').fill('32123456').catch(() => null);
      await page.locator('#client-phone').fill('2234000000').catch(() => null);

      const btnGoShipping = page.locator('#go-to-shipping, button:has-text("IR PARA DATOS DE ENVÍO")').first();
      if (await btnGoShipping.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btnGoShipping.click();
        await page.waitForTimeout(2500);
      }
    }

    // 7. Completar Código Postal en la pantalla de Envío
    const postalInput = page.locator('#ship-postalCode, input[name="postalCode"]').first();
    if (await postalInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await postalInput.fill(scenario.postalCode);
      await postalInput.press('Enter');
      await page.waitForTimeout(3000);
    }

    // 8. Validar que no haya bloqueo por código postal
    const alertWarning = page.getByText(/El siguiente ítem no puede enviarse|no puede enviarse a este código postal/i);
    if (await alertWarning.isVisible()) {
      throw new Error(`Ítem bloqueado para CP ${scenario.postalCode} ("No puede enviarse a este código postal")`);
    }

    // 9. Validar opciones logísticas y avanzar a Pago
    const btnGoToPayment = page.locator('#btn-go-to-payment, button:has-text("IR PARA EL PAGO"), button:has-text("Continuar")').first();
    if (await btnGoToPayment.isVisible({ timeout: 8000 }).catch(() => false)) {
      await btnGoToPayment.click();
      await page.waitForTimeout(3000);
    }

    // 10. AUDITORÍA DE PASARELAS DE PAGO
    console.log(`  💳 Validando disponibilidad de Pasarelas de Pago...`);
    const paymentBlock = page.locator('#payment-data, .payment-data, #iframe-placeholder-creditCardPaymentGroup, .payment-group-list-btn, #payment-group-creditCardPaymentGroup').first();
    await paymentBlock.waitFor({ state: 'attached', timeout: 15000 });

    const paymentOptions = page.locator('.payment-group-item, button[id*="payment-group"], a[id*="payment-group"]');
    const paymentCount = await paymentOptions.count();

    console.log(`  ✓ Checkout, Logística y Pasarelas OK para ${scenarioTitle} (${paymentCount} medios de pago detectados).`);
    return true;

  } catch (err) {
    console.log(`❌ Error en Checkout (${scenarioTitle}): ${err.message}`);

    const screenshotPath = `error_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

    const errorCaption = `🚨 <b>Fallo en Checkout / Pagos Ámbito</b>\n\n<b>Producto:</b> ${scenario.productName}\n<b>Zona:</b> ${scenario.zoneName} (${scenario.postalCode})\n<b>Error:</b> ${err.message}`;

    await sendTelegramPhoto(screenshotPath, errorCaption);
    await sendWhatsAppMessage(`🚨 Fallo en Checkout/Pagos Ámbito\n\nProducto: ${scenario.productName}\nZona: ${scenario.zoneName} (${scenario.postalCode})\nError: ${err.message}`);
    console.log('📸 Captura enviada a Telegram.');

    if (fs.existsSync(screenshotPath)) {
      fs.unlinkSync(screenshotPath);
    }
    return false;
  } finally {
    await context.close();
  }
}

// ==========================================
// EJECUCIÓN PRINCIPAL
// ==========================================
(async () => {
  const now = new Date().toLocaleTimeString('es-AR');
  console.log(`⏰ [${now}] Iniciando Suite Integral de Auditoría...`);

  const browser = await chromium.launch({ headless: true });
  let globalSuccess = true;

  try {
    const searchContext = await browser.newContext();
    const searchPage = await searchContext.newPage();
    await auditSearch(searchPage);
    await searchContext.close();

    for (const scenario of SCENARIOS) {
      const ok = await auditCheckoutScenario(browser, scenario);
      if (!ok) globalSuccess = false;
      await new Promise(r => setTimeout(r, 2000));
    }

    // Notificación horaria de estado OK (cada 60 minutos)
    if (globalSuccess) {
      const hourlyText = `✅ *Monitor Ámbito: Todo Operativo*\n\n` +
        `• Búsqueda y catálogo OK\n` +
        `• Fletes y retiros (MdP y La Florida) OK\n` +
        `• Pasarelas de pago disponibles OK\n` +
        `• Hora: ${now}`;

      await sendWhatsAppMessage(hourlyText);
      await sendTelegramMessage(`✅ <b>Monitor Ámbito: Todo Operativo</b>\n\n• Búsqueda y catálogo OK\n• Fletes y retiros (MdP y La Florida) OK\n• Pasarelas de pago disponibles OK\n• Hora: ${now}`);
    }

  } catch (globalErr) {
    console.error('Error global en la ejecución:', globalErr);
  } finally {
    await browser.close();
    console.log('🏁 Suite de auditoría completada.');
  }
})();